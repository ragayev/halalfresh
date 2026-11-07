"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { OrderStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { login, logout, requireAdmin } from "@/server/auth";
import { AppError } from "@/server/errors";
import { addNote, audit, recordWeights, transitionOrder } from "@/server/orders";
import { notifyCustomer } from "@/server/notifications/notify";
import { getMerchant } from "@/server/settings";
import { buildKevserMessage, normalizeWhatsappNumber, whatsappLink } from "@/domain/whatsapp";
import type { BundleItem } from "@/domain/bundles";
import { parsePriceToCents } from "@/domain/money";
import { PRODUCT_STATUSES, SELLING_UNITS } from "@/domain/product-rules";
import { applyCsvImport, planCsvImport, type CsvPlan } from "@/server/catalog-csv";
import { createProduct, parseSkuList, setAvailability, setFlag, setStatus, setSupplierSkus, updateProduct, type ProductInput } from "@/server/product-service";

export type ActionResult = { ok: boolean; message?: string; url?: string };
const fail = (e: unknown): ActionResult => ({
  ok: false,
  message: e instanceof AppError ? e.message : "Something went wrong",
});

export async function loginAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const ok = await login(String(fd.get("email") ?? ""), String(fd.get("password") ?? ""));
    if (!ok) return { ok: false, message: "Invalid email or password" };
  } catch (e) {
    return fail(e);
  }
  redirect("/admin");
}

export async function logoutAction() {
  await logout();
  redirect("/admin/login");
}

// ---- Orders ----
const afterOrderChange = (orderId: string) => {
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
};

export async function transitionAction(orderId: string, to: string, reason?: string): Promise<ActionResult> {
  const a = await requireAdmin();
  try {
    const target = z.nativeEnum(OrderStatus).parse(to);
    await transitionOrder(orderId, target, { actor: "admin", actorId: a.email, reason: reason?.trim() || null });
    afterOrderChange(orderId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export interface WeightsResult extends ActionResult {
  finalTotalCents?: number;
  cappedAmountCents?: number;
}

export async function weightsAction(orderId: string, weights: { itemId: string; actualGrams: number }[]): Promise<WeightsResult> {
  const a = await requireAdmin();
  try {
    const r = await recordWeights(orderId, weights, { actor: "admin", actorId: a.email });
    afterOrderChange(orderId);
    return { ok: true, finalTotalCents: r.finalTotalCents, cappedAmountCents: r.cappedAmountCents };
  } catch (e) {
    return fail(e);
  }
}

/** Builds the wa.me link with Kevser's Turkish order template. Logged so the admin can see it was forwarded. */
export async function kevserWhatsappAction(orderId: string): Promise<ActionResult> {
  const a = await requireAdmin();
  try {
    const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: { orderBy: { id: "asc" } }, customer: true, merchant: true } });
    if (!o.merchant.whatsappNumber) throw new AppError("VALIDATION", "Set Kevser's WhatsApp number in Einstellungen first");
    const message = buildKevserMessage({
      number: o.number,
      firstName: o.customer.firstName,
      lastName: o.customer.lastName,
      phone: o.customer.phoneE164,
      street: o.street,
      postalCode: o.postalCode,
      city: o.city,
      deliveryDate: o.deliveryDate.toISOString().slice(0, 10),
      slotStartTime: o.slotStartTime,
      slotEndTime: o.slotEndTime,
      paymentMethod: o.paymentMethod,
      items: o.items.map((i) => ({ productName: i.productName, requestedGrams: i.requestedGrams })),
      estimatedTotalCents: o.estimatedTotalCents,
      maxTotalCents: o.maxTotalCents,
      notes: o.deliveryNotes,
    });
    await audit(a.email, "order.whatsapp_kevser", "Order", orderId);
    return { ok: true, url: whatsappLink(o.merchant.whatsappNumber, message) };
  } catch (e) {
    return fail(e);
  }
}

export async function saveNoteAction(orderId: string, note: string): Promise<ActionResult> {
  const a = await requireAdmin();
  try {
    await addNote(orderId, note, a.email);
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true, message: "Gespeichert" };
  } catch (e) {
    return fail(e);
  }
}

export async function resendNotificationAction(orderId: string, template: string): Promise<ActionResult> {
  const a = await requireAdmin();
  try {
    const t = z.enum(["order_created", "accepted", "weighed", "out_for_delivery", "cancelled", "payment_overdue"]).parse(template);
    await notifyCustomer(orderId, t, { force: true });
    await audit(a.email, "order.resend_notification", "Order", orderId, { template: t });
    afterOrderChange(orderId);
    return { ok: true, message: "Gesendet" };
  } catch (e) {
    return fail(e);
  }
}

export async function setBlockedCashAction(customerId: string, blocked: boolean): Promise<ActionResult> {
  const a = await requireAdmin();
  await db.customer.update({ where: { id: customerId }, data: { blockedCash: blocked } });
  await audit(a.email, blocked ? "customer.block_cash" : "customer.unblock_cash", "Customer", customerId);
  revalidatePath("/admin/customers");
  return { ok: true };
}

// ---- Products ----
// Validation lives here (shape of the form); business rules live in src/domain/product-rules.ts and are enforced by
// src/server/product-service.ts, the only writer of product state.
const euro = z
  .string()
  .transform((s) => parsePriceToCents(s))
  .pipe(z.number().int().min(0).max(10_000_000));
const grams = z.coerce.number().int().min(50).max(100000);
const productSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/)
    .max(80),
  description: z.string().trim().min(2).max(2000),
  categoryId: z.string().min(1),
  price: euro,
  sellingUnit: z.enum(SELLING_UNITS),
  status: z.enum(PRODUCT_STATUSES),
  stepGrams: grams,
  minGrams: grams,
  maxGrams: grams,
  origin: z.string().trim().max(120).optional(),
  halalCertification: z.string().trim().max(300).optional(),
  allergenInfo: z.string().trim().max(600).optional(),
  nameDe: z.string().trim().max(120).optional(),
  descDe: z.string().trim().max(2000).optional(),
  nameTr: z.string().trim().max(120).optional(),
  descTr: z.string().trim().max(2000).optional(),
  /** Supplier article numbers, separated by comma, space or newline. Present on every edit form. */
  supplierSkus: z.string().max(2000).optional(),
  /** Bundles only: one component per line, "grams | Deutsch | Türkçe | English | catalogue-slug (optional)". */
  bundleItems: z.string().max(4000).optional(),
});

function parseBundleLines(text: string): BundleItem[] | string {
  const out: BundleItem[] = [];
  for (const [n, line] of text.split("\n").map((l) => l.trim()).filter(Boolean).entries()) {
    const [g, de, tr, en, slug] = line.split("|").map((s) => s.trim());
    const grams = Number(g);
    if (!Number.isInteger(grams) || grams < 50 || grams > 50000 || !de) return `Contents line ${n + 1}: use "grams | Deutsch | Türkçe | English | slug"`;
    out.push({ grams, names: { de, tr: tr || de, en: en || de }, productSlug: slug || undefined });
  }
  return out.length ? out : "A bundle needs at least one component";
}

export async function saveProductAction(id: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await requireAdmin();
  const parsed = productSchema.safeParse(Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")));
  if (!parsed.success)
    return {
      ok: false,
      message: `Check fields: ${Object.keys(parsed.error.flatten().fieldErrors).join(", ")}`,
    };
  const v = parsed.data;
  let bundleItems: BundleItem[] | undefined;
  if (v.bundleItems !== undefined) {
    const items = parseBundleLines(v.bundleItems);
    if (typeof items === "string") return { ok: false, message: items };
    bundleItems = items;
  }
  try {
    const skus = v.supplierSkus !== undefined ? parseSkuList(v.supplierSkus) : null;
    const input: ProductInput = {
      name: v.name,
      slug: v.slug,
      description: v.description,
      categoryId: v.categoryId,
      priceCents: v.price,
      priceConfirmed: fd.get("priceConfirmed") === "on",
      sellingUnit: v.sellingUnit,
      stepGrams: v.stepGrams,
      minGrams: v.minGrams,
      maxGrams: v.maxGrams,
      origin: v.origin,
      halalCertification: v.halalCertification,
      allergenInfo: v.allergenInfo,
      isFeatured: fd.get("isFeatured") === "on",
      isAvailable: fd.get("isAvailable") === "on",
      preorderEligible: fd.get("preorderEligible") === "on",
      status: v.status,
      translations: { de: { name: v.nameDe, description: v.descDe }, tr: { name: v.nameTr, description: v.descTr } },
      bundleItems,
    };
    const p = id === "new" ? await createProduct(input, a.email) : await updateProduct(id, input, a.email);
    if (skus) await setSupplierSkus(p.id, skus, a.email);
    const file = fd.get("image");
    if (file instanceof File && file.size > 0) {
      if (file.size > 2_000_000) return { ok: false, message: "Image must be under 2 MB" };
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return { ok: false, message: "Use JPEG, PNG or WebP" };
      // Database-backed upload (the only runtime-writable storage on Vercel). Replaces the current image(s).
      await db.productImage.deleteMany({ where: { productId: p.id } });
      await db.productImage.create({
        data: { productId: p.id, data: Buffer.from(await file.arrayBuffer()), mimeType: file.type, alt: v.name },
      });
      await audit(a.email, "product.image.upload", "Product", p.id);
    }
    revalidatePath("/admin/products");
  } catch (e) {
    return fail(e);
  }
  redirect("/admin/products");
}

export async function toggleProductAction(
  id: string,
  field: "isAvailable" | "isFeatured" | "preorderEligible",
  value: boolean,
): Promise<ActionResult> {
  const a = await requireAdmin();
  try {
    if (field === "isAvailable") await setAvailability(id, value, a.email);
    else await setFlag(id, field, value, a.email);
    revalidatePath("/admin/products");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setProductStatusAction(id: string, to: string): Promise<ActionResult> {
  const a = await requireAdmin();
  try {
    await setStatus(id, z.enum(PRODUCT_STATUSES).parse(to), a.email);
    revalidatePath("/admin/products");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---- CSV price / availability import ----
export type CsvPreview = ActionResult & { plan?: CsvPlan };

async function readCsv(fd: FormData): Promise<string | null> {
  const f = fd.get("file");
  if (f instanceof File && f.size > 0) return f.size > 2_000_000 ? null : await f.text();
  const t = fd.get("text");
  return typeof t === "string" && t.trim() ? t : null;
}

export async function previewCsvAction(_: CsvPreview | null, fd: FormData): Promise<CsvPreview> {
  await requireAdmin();
  const text = await readCsv(fd);
  if (!text) return { ok: false, message: "Choose a CSV file (UTF-8, up to 2 MB) or paste its content" };
  const plan = await planCsvImport(text);
  return { ok: !plan.errors.length && !plan.counts.reject, plan, message: plan.errors[0] };
}

/** Explicit second step: the server re-plans from the submitted text, so a stale or edited preview cannot widen the change. */
export async function applyCsvAction(_: CsvPreview | null, fd: FormData): Promise<CsvPreview> {
  const a = await requireAdmin();
  const text = await readCsv(fd);
  if (!text) return { ok: false, message: "Nothing to import" };
  try {
    const plan = await applyCsvImport(text, a.email);
    revalidatePath("/admin/products");
    return { ok: true, plan, message: `Applied: ${plan.counts.update} updated, ${plan.counts.skip} unchanged` };
  } catch (e) {
    return fail(e);
  }
}

// ---- Settings ----
const merchantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(160).optional(),
  addressLine: z.string().trim().max(200).optional(),
  postalCode: z.string().trim().max(10).optional(),
  city: z.string().trim().max(80).optional(),
  contactEmail: z.string().trim().email().or(z.literal("")).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  whatsappNumber: z.string().trim().max(30).optional(),
});

export async function saveMerchantAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await requireAdmin();
  const p = merchantSchema.safeParse(Object.fromEntries(fd.entries()));
  if (!p.success)
    return {
      ok: false,
      message: `Check fields: ${Object.keys(p.error.flatten().fieldErrors).join(", ")}`,
    };
  const v = p.data;
  let wa: string | null = null;
  if (v.whatsappNumber) {
    wa = normalizeWhatsappNumber(v.whatsappNumber);
    if (!wa)
      return {
        ok: false,
        message: "WhatsApp number must be in international format, e.g. +49 151 2345678",
      };
  }
  const m = await getMerchant();
  await db.$transaction([
    db.merchant.update({
      where: { id: m.id },
      data: {
        name: v.name,
        legalName: v.legalName || null,
        addressLine: v.addressLine || null,
        postalCode: v.postalCode || null,
        city: v.city || null,
        contactEmail: v.contactEmail || null,
        contactPhone: v.contactPhone || null,
        whatsappNumber: wa,
      },
    }),
  ]);
  await audit(a.email, "merchant.update", "Merchant", m.id);
  revalidatePath("/admin/settings");
  return { ok: true, message: "Saved" };
}

// ---- Operating settings ----
const operatingSchema = z.object({
  toleranceBps: z.coerce.number().int().min(0).max(5000),
  paymentOverdueHours: z.coerce.number().int().min(1).max(240),
  tokenExpiryDays: z.coerce.number().int().min(1).max(365),
  telegramChatId: z.string().trim().max(64).optional(),
});

export async function saveOperatingSettingsAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await requireAdmin();
  const p = operatingSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { ok: false, message: "Bitte Eingaben prüfen" };
  const { setSetting } = await import("@/server/app-settings");
  for (const [k, v] of Object.entries(p.data)) await setSetting(k as never, v ?? "");
  // The halal badge is only ever shown after the operator explicitly verifies the certificate.
  await setSetting("halalCertificateVerified", fd.get("halalCertificateVerified") === "on");
  await audit(a.email, "settings.update", "Setting", undefined, p.data);
  revalidatePath("/admin/settings");
  return { ok: true, message: "Gespeichert" };
}
