import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizePostcode, POSTCODE_RE } from "@/domain/delivery";
import { cashEligibility, type CashReason } from "@/domain/payment-eligibility";
import { normalizePhone } from "@/domain/phone";
import { estimateOrder } from "@/domain/pricing";
import { LOCALES } from "@/i18n/config";
import { resolveDelivery } from "./delivery-service";
import { AppError } from "./errors";
import { getSettings } from "./app-settings";
import { notifyAdmin, notifyCustomer } from "./notifications/notify";
import { priceCart } from "./pricing-service";
import { getMerchant } from "./settings";

export const checkoutInput = z.object({
  requestId: z.string().uuid(),
  locale: z.enum(LOCALES).default("de"),
  lines: z
    .array(z.object({ productId: z.string().min(1), grams: z.number().int().positive(), bundleId: z.string().max(80).optional() }))
    .min(1)
    .max(50),
  customer: z.object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().trim().toLowerCase().email().max(200),
    phone: z.string().trim().min(6).max(30),
  }),
  address: z.object({
    street: z.string().trim().min(3).max(160),
    postalCode: z.string().transform(normalizePostcode).pipe(z.string().regex(POSTCODE_RE)),
    city: z.string().trim().min(2).max(80),
  }),
  checkedPostcode: z.string().transform(normalizePostcode).pipe(z.string().regex(POSTCODE_RE)).optional(),
  deliveryNotes: z.string().trim().max(500).optional(),
  paymentMethod: z.enum(["PAYPAL", "CASH"]),
  consents: z.object({
    terms: z.literal(true),
    marketing: z.boolean().default(false),
    dataTransfer: z.boolean().default(false),
  }),
});
export type CheckoutInput = z.infer<typeof checkoutInput>;

export interface CashStatus {
  allowed: boolean;
  reason?: CashReason;
}

/** Cash eligibility for a phone number (spec §7.1). Unknown phone = first order = not allowed. */
export async function cashStatusForPhone(rawPhone: string): Promise<CashStatus> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { allowed: false, reason: "FIRST_ORDER" };
  const c = await db.customer.findUnique({ where: { phoneE164: phone } });
  if (!c) return { allowed: false, reason: "FIRST_ORDER" };
  const completedOrders = await db.order.count({ where: { customerId: c.id, status: { in: ["DELIVERED", "CASH_COLLECTED"] } } });
  const r = cashEligibility({ completedOrders, refusedCount: c.refusedCount, blockedCash: c.blockedCash });
  return r.allowed ? { allowed: true } : { allowed: false, reason: r.reason };
}

/** Creates a NEW order. Prices are recomputed from the DB; nothing from the client is trusted for money. */
export async function createOrder(raw: unknown, now = new Date()): Promise<{ token: string; locale: string; orderId: string }> {
  const parsed = checkoutInput.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION", "Please check the highlighted fields", 400, parsed.error.flatten().fieldErrors);
  const input = parsed.data;

  const dup = await db.order.findUnique({ where: { requestId: input.requestId }, select: { publicToken: true, locale: true, id: true } });
  if (dup) return { token: dup.publicToken, locale: dup.locale, orderId: dup.id };

  const phone = normalizePhone(input.customer.phone);
  if (!phone) throw new AppError("VALIDATION", "Please check the highlighted fields", 400, { "customer.phone": ["invalid"] });

  if (input.checkedPostcode && input.checkedPostcode !== input.address.postalCode)
    throw new AppError("POSTCODE_MISMATCH", "The delivery address postcode differs from the postcode you checked", 422);
  const { check, slot, zoneId, routeId } = await resolveDelivery(input.address.postalCode, now);
  if (!check.supported || !zoneId || !routeId) throw new AppError("POSTCODE_UNSUPPORTED", "We don't deliver to this postcode yet", 422);
  if (!slot) throw new AppError("SLOT_INVALID", "No delivery date is available right now", 422);

  const merchant = await getMerchant();
  const settings = await getSettings();
  const { lines, totals } = await priceCart(input.lines, {
    mode: check.mode!,
    minOrderCents: check.minOrderCents,
    deliveryFeeCents: check.deliveryFeeCents,
    freeDeliveryThresholdCents: check.freeDeliveryThresholdCents,
  });
  if (!totals.meetsMinimum)
    throw new AppError("BELOW_MINIMUM", "Minimum order value not reached", 422, { minOrderCents: totals.minOrderCents, shortfallCents: totals.shortfallCents });

  const est = estimateOrder(lines.map((l) => ({ pricePerKgCents: l.pricePerKgCents, requestedGrams: l.grams })), totals.deliveryFeeCents, settings.toleranceBps);
  const token = randomBytes(24).toString("base64url"); // 192 bit

  try {
    const order = await db.$transaction(async (tx) => {
      const existing = await tx.customer.findUnique({ where: { phoneE164: phone } });
      // Cash eligibility is decided inside the transaction against current data, never from the client.
      if (input.paymentMethod === "CASH") {
        const completed = existing ? await tx.order.count({ where: { customerId: existing.id, status: { in: ["DELIVERED", "CASH_COLLECTED"] } } }) : 0;
        const r = cashEligibility({ completedOrders: completed, refusedCount: existing?.refusedCount ?? 0, blockedCash: existing?.blockedCash ?? false });
        if (!r.allowed) throw new AppError("PAYMENT_METHOD_UNAVAILABLE", "Cash payment is not available for this customer", 422, { reason: r.reason });
      }
      const personal = { email: input.customer.email, firstName: input.customer.firstName, lastName: input.customer.lastName };
      const customer = await tx.customer.upsert({ where: { phoneE164: phone }, update: personal, create: { phoneE164: phone, ...personal } });
      await tx.address.create({ data: { customerId: customer.id, ...input.address, notes: input.deliveryNotes || null } });
      const o = await tx.order.create({
        data: {
          publicToken: token,
          requestId: input.requestId,
          merchantId: merchant.id,
          customerId: customer.id,
          street: input.address.street,
          postalCode: input.address.postalCode,
          city: input.address.city,
          deliveryNotes: input.deliveryNotes || null,
          zoneId,
          routeId,
          zoneName: check.zone!.name,
          deliveryMode: check.mode!,
          deliveryDate: new Date(`${slot.date}T00:00:00.000Z`),
          slotStartTime: slot.windowStart,
          slotEndTime: slot.windowEnd,
          locale: input.locale,
          status: "NEW",
          paymentMethod: input.paymentMethod,
          paymentMode: "CAPTURE_AFTER_WEIGH",
          toleranceBps: settings.toleranceBps,
          minOrderCents: check.minOrderCents,
          deliveryFeeCents: totals.deliveryFeeCents,
          estimatedTotalCents: est.estimatedTotalCents,
          maxTotalCents: est.maxTotalCents,
          items: {
            create: lines.map((l, i) => ({
              productId: l.productId,
              productName: l.name,
              productSlug: l.slug,
              unitPricePerKgCents: l.pricePerKgCents,
              requestedGrams: l.grams,
              estimatedCents: est.lineEstimates[i],
              bundleId: l.bundleId,
            })),
          },
          events: { create: { toStatus: "NEW", actor: "customer", reason: "created" } },
        },
      });
      const w = settings.consentWording;
      await tx.consent.createMany({
        data: [
          { customerId: customer.id, orderId: o.id, type: "TERMS", wordingVersion: w.terms.version, granted: true },
          { customerId: customer.id, orderId: o.id, type: "MARKETING", wordingVersion: w.marketing.version, granted: input.consents.marketing },
          { customerId: customer.id, orderId: o.id, type: "DATA_TRANSFER", wordingVersion: w.dataTransfer.version, granted: input.consents.dataTransfer },
        ],
      });
      return o;
    });
    await Promise.all([notifyCustomer(order.id, "order_created"), notifyAdmin(order.id, "new_order")]);
    return { token, locale: input.locale, orderId: order.id };
  } catch (e) {
    // Double submit racing past the first lookup: return the first order.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await db.order.findUnique({ where: { requestId: input.requestId }, select: { publicToken: true, locale: true, id: true } });
      if (again) return { token: again.publicToken, locale: again.locale, orderId: again.id };
    }
    throw e;
  }
}
