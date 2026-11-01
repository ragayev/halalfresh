"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FulfillmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { login, logout, requireAdmin } from "@/server/auth";
import { AppError } from "@/server/errors";
import { addNote, audit, cancelOrder, prepareWhatsapp, refundOrder, transitionFulfillment } from "@/server/orders";
import { getMerchant } from "@/server/settings";
import { normalizeWhatsappNumber } from "@/domain/whatsapp";

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
export async function setFulfillmentAction(orderId: string, to: string): Promise<ActionResult> {
  const a = await requireAdmin();
  try {
    await transitionFulfillment(orderId, z.nativeEnum(FulfillmentStatus).parse(to), a.email);
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function whatsappAction(orderId: string): Promise<ActionResult> {
  const a = await requireAdmin();
  try {
    const { url } = await prepareWhatsapp(orderId, a.email);
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true, url };
  } catch (e) {
    return fail(e);
  }
}

export async function saveNoteAction(orderId: string, note: string): Promise<ActionResult> {
  const a = await requireAdmin();
  try {
    await addNote(orderId, note, a.email);
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true, message: "Saved" };
  } catch (e) {
    return fail(e);
  }
}

export async function refundAction(orderId: string, amountCents: number): Promise<ActionResult> {
  const a = await requireAdmin();
  try {
    await refundOrder(orderId, amountCents, { actor: a.email });
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true, message: "Refund issued" };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelAction(orderId: string): Promise<ActionResult> {
  const a = await requireAdmin();
  try {
    await cancelOrder(orderId, a.email);
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true, message: "Order cancelled" };
  } catch (e) {
    return fail(e);
  }
}

// ---- Products ----
const euro = z
  .string()
  .transform((s) => Math.round(parseFloat(s.replace(",", ".")) * 100))
  .pipe(z.number().int().min(1).max(100000));
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
  nameAr: z.string().trim().max(120).optional(),
  descAr: z.string().trim().max(2000).optional(),
});

export async function saveProductAction(id: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await requireAdmin();
  const parsed = productSchema.safeParse(Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")));
  if (!parsed.success)
    return {
      ok: false,
      message: `Check fields: ${Object.keys(parsed.error.flatten().fieldErrors).join(", ")}`,
    };
  const v = parsed.data;
  if (v.minGrams % v.stepGrams !== 0 || v.maxGrams < v.minGrams)
    return {
      ok: false,
      message: "Min must be a multiple of the step, and max ≥ min",
    };
  try {
    const merchant = await getMerchant();
    const data = {
      name: v.name,
      slug: v.slug,
      description: v.description,
      categoryId: v.categoryId,
      pricePerKgCents: v.price,
      stepGrams: v.stepGrams,
      minGrams: v.minGrams,
      maxGrams: v.maxGrams,
      origin: v.origin || null,
      halalCertification: v.halalCertification || null,
      allergenInfo: v.allergenInfo || null,
      isAvailable: fd.get("isAvailable") === "on",
      isFeatured: fd.get("isFeatured") === "on",
      isHidden: fd.get("isHidden") === "on",
      preorderEligible: fd.get("preorderEligible") === "on",
      translations: {
        de: { name: v.nameDe, description: v.descDe },
        tr: { name: v.nameTr, description: v.descTr },
        ar: { name: v.nameAr, description: v.descAr },
      },
    };
    const p =
      id === "new"
        ? await db.product.create({
            data: { ...data, merchantId: merchant.id },
          })
        : await db.product.update({ where: { id }, data });
    const file = fd.get("image");
    if (file instanceof File && file.size > 0) {
      if (file.size > 2_000_000) return { ok: false, message: "Image must be under 2 MB" };
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return { ok: false, message: "Use JPEG, PNG or WebP" };
      await db.productImage.deleteMany({ where: { productId: p.id } });
      await db.productImage.create({
        data: {
          productId: p.id,
          data: Buffer.from(await file.arrayBuffer()),
          mimeType: file.type,
          alt: v.name,
        },
      });
    }
    await audit(a.email, id === "new" ? "product.create" : "product.update", "Product", p.id);
    revalidatePath("/admin/products");
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error && e.message.includes("Unique") ? "Slug already in use" : "Could not save product",
    };
  }
  redirect("/admin/products");
}

export async function toggleProductAction(
  id: string,
  field: "isAvailable" | "isFeatured" | "isHidden" | "preorderEligible",
  value: boolean,
) {
  const a = await requireAdmin();
  await db.product.update({ where: { id }, data: { [field]: value } });
  await audit(a.email, `product.${field}`, "Product", id, { value });
  revalidatePath("/admin/products");
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
