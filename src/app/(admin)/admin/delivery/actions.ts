"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/server/auth";
import { audit } from "@/server/orders";
import { getMerchant } from "@/server/settings";
import { parsePostcodeList } from "@/domain/delivery";
import type { ActionResult } from "../actions";

const done = (message = "Saved"): ActionResult => {
  revalidatePath("/admin/delivery");
  return { ok: true, message };
};
const bad = (message: string): ActionResult => ({ ok: false, message });
const fieldsMsg = (e: z.ZodError) => `Check fields: ${Object.keys(e.flatten().fieldErrors).join(", ")}`;

/** "60", "4,90" -> cents. Empty -> null. */
const euroCents = z
  .string()
  .trim()
  .transform((s) => (s === "" ? null : Math.round(parseFloat(s.replace(",", ".")) * 100)))
  .pipe(z.number().int().min(0).max(10_000_000).nullable());
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

// ---- Zones ----
const zoneSchema = z.object({
  name: z.string().trim().min(2).max(80),
  mode: z.enum(["REGULAR", "PREORDER_ONLY"]),
  minOrder: euroCents.refine((v) => v !== null),
  deliveryFee: euroCents.refine((v) => v !== null),
  freeFrom: euroCents,
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
});

export async function saveZoneAction(id: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await requireAdmin();
  const p = zoneSchema.safeParse(Object.fromEntries(fd.entries()));
  if (!p.success) return bad(fieldsMsg(p.error));
  const v = p.data;
  const data = {
    name: v.name,
    mode: v.mode,
    minOrderCents: v.minOrder!,
    deliveryFeeCents: v.deliveryFee!,
    freeDeliveryThresholdCents: v.freeFrom,
    sortOrder: v.sortOrder,
    isActive: fd.get("isActive") === "on",
  };
  const z =
    id === "new"
      ? await db.deliveryZone.create({ data: { ...data, merchantId: (await getMerchant()).id } })
      : await db.deliveryZone.update({ where: { id }, data });
  await audit(a.email, id === "new" ? "zone.create" : "zone.update", "DeliveryZone", z.id);
  return done();
}

export async function deleteZoneAction(id: string): Promise<ActionResult> {
  const a = await requireAdmin();
  if (await db.order.count({ where: { zoneId: id } })) return bad("Zone has orders; deactivate it instead");
  await db.deliveryZone.delete({ where: { id } });
  await audit(a.email, "zone.delete", "DeliveryZone", id);
  return done("Deleted");
}

// ---- Routes ----
export async function saveRouteAction(zoneId: string, id: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await requireAdmin();
  const name = z.string().trim().min(2).max(60).safeParse(fd.get("name"));
  if (!name.success) return bad("Route name required");
  const isActive = fd.get("isActive") === "on" || id === "new";
  const r =
    id === "new"
      ? await db.deliveryRoute.create({ data: { zoneId, name: name.data, isActive } })
      : await db.deliveryRoute.update({ where: { id }, data: { name: name.data, isActive } });
  await audit(a.email, id === "new" ? "route.create" : "route.update", "DeliveryRoute", r.id);
  return done();
}

export async function deleteRouteAction(id: string): Promise<ActionResult> {
  const a = await requireAdmin();
  await db.deliveryRoute.delete({ where: { id } }); // orders keep their snapshot; Order.routeId -> null
  await audit(a.email, "route.delete", "DeliveryRoute", id);
  return done("Deleted");
}

// ---- Postcodes (a postcode belongs to exactly one route) ----
export async function savePostcodesAction(routeId: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await requireAdmin();
  const { postcodes, invalid } = parsePostcodeList(String(fd.get("postcodes") ?? ""));
  if (invalid.length) return bad(`Invalid: ${invalid.slice(0, 8).join(", ")}. Use 5 digits, or ranges like 14467-14482.`);
  const taken = await db.postcodeRoute.findMany({
    where: { postcode: { in: postcodes }, routeId: { not: routeId } },
    include: { route: { select: { name: true } } },
  });
  if (taken.length)
    return bad(
      `Already assigned to another route: ${taken
        .slice(0, 6)
        .map((t) => `${t.postcode} (${t.route.name})`)
        .join(", ")}${taken.length > 6 ? ` +${taken.length - 6} more` : ""}. Remove them there first.`,
    );
  await db.$transaction([
    db.postcodeRoute.deleteMany({ where: { routeId, postcode: { notIn: postcodes } } }),
    db.postcodeRoute.createMany({ data: postcodes.map((postcode) => ({ postcode, routeId })), skipDuplicates: true }),
  ]);
  await audit(a.email, "route.postcodes", "DeliveryRoute", routeId, { count: postcodes.length });
  return done(`${postcodes.length} postcodes saved`);
}

// ---- Schedules ----
const scheduleSchema = z
  .object({
    kind: z.enum(["WEEKLY", "NTH_WEEKDAY_OF_MONTH"]),
    weekday: z.coerce.number().int().min(1).max(7),
    nth: z.coerce.number().int().min(1).max(5).optional(),
    windowStart: time,
    windowEnd: time,
    cutoffHoursBefore: z.coerce
      .number()
      .int()
      .min(0)
      .max(24 * 60),
  })
  .refine((v) => v.windowEnd > v.windowStart, { message: "end after start", path: ["windowEnd"] })
  .refine((v) => v.kind === "WEEKLY" || v.nth !== undefined, { message: "nth required", path: ["nth"] });

export async function saveScheduleAction(routeId: string, id: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await requireAdmin();
  const raw = Object.fromEntries([...fd.entries()].filter(([, v]) => v !== ""));
  const p = scheduleSchema.safeParse(raw);
  if (!p.success) return bad(fieldsMsg(p.error));
  const data = {
    ...p.data,
    nth: p.data.kind === "WEEKLY" ? null : (p.data.nth ?? null),
    isActive: fd.get("isActive") === "on" || id === "new",
  };
  const s =
    id === "new" ? await db.routeSchedule.create({ data: { ...data, routeId } }) : await db.routeSchedule.update({ where: { id }, data });
  await audit(a.email, id === "new" ? "schedule.create" : "schedule.update", "RouteSchedule", s.id);
  return done(p.data.weekday === 7 ? "Saved (note: Sundays are never delivered)" : "Saved");
}

export async function deleteScheduleAction(id: string): Promise<ActionResult> {
  const a = await requireAdmin();
  await db.routeSchedule.delete({ where: { id } });
  await audit(a.email, "schedule.delete", "RouteSchedule", id);
  return done("Deleted");
}

// ---- Blackout dates ----
export async function addBlackoutAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await requireAdmin();
  const p = z
    .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(2).max(120) })
    .safeParse(Object.fromEntries(fd.entries()));
  if (!p.success) return bad(fieldsMsg(p.error));
  const merchant = await getMerchant();
  const date = new Date(`${p.data.date}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return bad("Invalid date");
  await db.deliveryBlackoutDate.upsert({
    where: { merchantId_date: { merchantId: merchant.id, date } },
    update: { reason: p.data.reason },
    create: { merchantId: merchant.id, date, reason: p.data.reason },
  });
  await audit(a.email, "blackout.add", "DeliveryBlackoutDate", p.data.date);
  return done("Added");
}

export async function deleteBlackoutAction(id: string): Promise<ActionResult> {
  const a = await requireAdmin();
  await db.deliveryBlackoutDate.delete({ where: { id } });
  await audit(a.email, "blackout.delete", "DeliveryBlackoutDate", id);
  return done("Removed");
}
