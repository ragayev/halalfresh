import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { siteUrl } from "@/lib/env";
import { normalizePostcode, POSTCODE_RE } from "@/domain/delivery";
import { LOCALES } from "@/i18n/config";
import { resolveDelivery } from "./delivery-service";
import { formatWeight } from "@/domain/pricing";
import { AppError } from "./errors";
import { getGateway } from "./payments/gateway";
import { GatewayConfigError } from "./payments/stripe";
import { priceCart } from "./pricing-service";
import { getMerchant } from "./settings";

export const checkoutInput = z.object({
  requestId: z.string().uuid(),
  locale: z.enum(LOCALES).default("de"),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        grams: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(50),
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(200),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[\d\s()/-]{6,24}$/),
  }),
  address: z.object({
    street: z.string().trim().min(3).max(160),
    postalCode: z.string().transform(normalizePostcode).pipe(z.string().regex(POSTCODE_RE)),
    city: z.string().trim().min(2).max(80),
  }),
  /** Postcode the customer saw delivery terms for. The server re-resolves; a different address postcode is rejected. */
  checkedPostcode: z.string().transform(normalizePostcode).pipe(z.string().regex(POSTCODE_RE)).optional(),
  deliveryInstructions: z.string().trim().max(500).optional(),
  acceptTerms: z.literal(true),
});
export type CheckoutInput = z.infer<typeof checkoutInput>;

export async function createCheckout(raw: unknown, now = new Date()): Promise<{ url: string; orderToken: string }> {
  const parsed = checkoutInput.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION", "Please check the highlighted fields", 400, parsed.error.flatten().fieldErrors);
  const input = parsed.data;

  // Double-submit protection: same requestId returns the same checkout.
  const existing = await db.order.findUnique({
    where: { requestId: input.requestId },
    include: { payments: true },
  });
  if (existing) {
    const pay = existing.payments[0];
    if (pay?.checkoutUrl && existing.paymentStatus === "PENDING_PAYMENT") return { url: pay.checkoutUrl, orderToken: existing.accessToken };
    throw new AppError("CONFLICT", "This order was already submitted", 409);
  }

  const gateway = await getGateway();
  const merchant = await getMerchant();
  const status = await gateway.getAccountStatus(merchant.stripeAccountId);
  if (!status.connected || !status.chargesEnabled) {
    throw new AppError("CHECKOUT_UNAVAILABLE", "Online payment is not available yet. Please try again later.", 503);
  }

  // Never trust client terms: resolve zone, terms and slot from the address postcode, right now.
  if (input.checkedPostcode && input.checkedPostcode !== input.address.postalCode)
    throw new AppError("POSTCODE_MISMATCH", "The delivery address postcode differs from the postcode you checked", 422, {
      checkedPostcode: input.checkedPostcode,
      addressPostcode: input.address.postalCode,
    });
  const resolved = await resolveDelivery(input.address.postalCode, now);
  const { check, slot, zoneId, routeId } = resolved;
  if (!check.supported || !zoneId || !routeId) throw new AppError("POSTCODE_UNSUPPORTED", "We don't deliver to this postcode yet", 422);

  const { lines, totals } = await priceCart(input.lines, {
    mode: check.mode!,
    minOrderCents: check.minOrderCents,
    deliveryFeeCents: check.deliveryFeeCents,
    freeDeliveryThresholdCents: check.freeDeliveryThresholdCents,
  });
  if (!totals.meetsMinimum) {
    throw new AppError("BELOW_MINIMUM", "Minimum order value not reached", 422, {
      minOrderCents: totals.minOrderCents,
      shortfallCents: totals.shortfallCents,
    });
  }

  // No slot picking: the customer sees the next delivery date and we assign exactly that slot.
  if (!slot) throw new AppError("SLOT_INVALID", "No delivery date is available right now", 422);
  const applicationFeeCents = 0; // commission is settled outside the platform
  const accessToken = randomBytes(24).toString("base64url");

  const order = await db.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: {
        email: input.customer.email,
        name: input.customer.name,
        phone: input.customer.phone,
        locale: input.locale,
      },
    });
    const address = await tx.address.create({
      data: { customerId: customer.id, ...input.address },
    });
    const o = await tx.order.create({
      data: {
        accessToken,
        requestId: input.requestId,
        merchantId: merchant.id,
        customerId: customer.id,
        addressId: address.id,
        zoneId,
        routeId,
        zoneName: check.zone!.name,
        deliveryMode: check.mode!,
        minOrderCents: check.minOrderCents,
        freeDeliveryThresholdCents: check.freeDeliveryThresholdCents,
        deliveryDate: new Date(`${slot.date}T00:00:00.000Z`),
        slotStartTime: slot.windowStart,
        slotEndTime: slot.windowEnd,
        deliveryInstructions: input.deliveryInstructions || null,
        locale: input.locale,
        subtotalCents: totals.subtotalCents,
        deliveryFeeCents: totals.deliveryFeeCents,
        totalCents: totals.totalCents,
        commissionBps: 0,
        applicationFeeCents,
        items: {
          create: lines.map((l) => ({
            productId: l.productId,
            productName: l.name,
            productSlug: l.slug,
            unitPricePerKgCents: l.pricePerKgCents,
            quantityGrams: l.grams,
            lineTotalCents: l.lineTotalCents,
          })),
        },
        events: {
          create: {
            type: "ORDER_CREATED",
            actor: "customer",
            toStatus: "PENDING_PAYMENT",
          },
        },
      },
    });
    await tx.payment.create({
      data: {
        orderId: o.id,
        provider: gateway.name,
        connectedAccountId: merchant.stripeAccountId,
        idempotencyKey: `checkout_${o.id}`,
        amountCents: o.totalCents,
        applicationFeeCents,
      },
    });
    return o;
  });

  try {
    const base = `${siteUrl()}/${input.locale}`;
    const session = await gateway.createCheckout({
      orderId: order.id,
      orderNumber: order.number,
      lines: [
        ...lines.map((l) => ({
          name: `${l.name} — ${formatWeight(l.grams)}`,
          amountCents: l.lineTotalCents,
        })),
        ...(totals.deliveryFeeCents > 0 ? [{ name: "Delivery", amountCents: totals.deliveryFeeCents }] : []),
      ],
      totalCents: order.totalCents,
      applicationFeeCents,
      customerEmail: input.customer.email,
      connectedAccountId: merchant.stripeAccountId,
      successUrl: `${base}/checkout/success?t=${accessToken}`,
      cancelUrl: `${base}/checkout/cancelled?t=${accessToken}`,
      idempotencyKey: `checkout_${order.id}`,
      locale: input.locale,
    });
    await db.payment.update({
      where: { idempotencyKey: `checkout_${order.id}` },
      data: {
        stripeCheckoutSessionId: session.sessionId,
        checkoutUrl: session.url,
      },
    });
    return { url: session.url, orderToken: accessToken };
  } catch (e) {
    log.error("checkout.create_failed", { orderId: order.id, error: e });
    await db.$transaction([
      db.order.update({
        where: { id: order.id },
        data: { paymentStatus: "CANCELLED", fulfillmentStatus: "CANCELLED" },
      }),
      db.payment.updateMany({
        where: { orderId: order.id },
        data: {
          status: "CANCELLED",
          failureReason: "checkout_creation_failed",
        },
      }),
      db.orderEvent.create({
        data: {
          orderId: order.id,
          type: "PAYMENT_CANCELLED",
          actor: "system",
          note: "Checkout session could not be created",
        },
      }),
    ]);
    if (e instanceof GatewayConfigError)
      throw new AppError("CHECKOUT_UNAVAILABLE", "Online payment is not available yet. Please try again later.", 503);
    throw new AppError("PAYMENT_ERROR", "We couldn't start the payment. Please try again.", 502);
  }
}
