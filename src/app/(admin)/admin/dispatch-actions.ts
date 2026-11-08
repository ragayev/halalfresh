"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/server/auth";
import { AppError } from "@/server/errors";
import { audit } from "@/server/orders";
import { parsePriceToCents } from "@/domain/money";
import type { ActionResult } from "./actions";

/** Stores the final weighed amount Kevser reported over WhatsApp. Informational: payment still follows the recorded weights. */
export async function setReportedFinalAction(orderId: string, raw: string): Promise<ActionResult> {
  const a = await requireAdmin();
  try {
    const trimmed = raw.trim();
    const cents = trimmed === "" ? null : parsePriceToCents(trimmed);
    if (trimmed !== "" && (cents == null || cents <= 0)) throw new AppError("VALIDATION", "Ungültiger Betrag", 400);
    await db.order.update({ where: { id: orderId }, data: { reportedFinalCents: cents } });
    await audit(a.email, "order.reported_final", "Order", orderId, { cents });
    revalidatePath("/admin/dispatch");
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true, message: "Gespeichert" };
  } catch (e) {
    return { ok: false, message: e instanceof AppError ? e.message : "Fehler beim Speichern" };
  }
}
