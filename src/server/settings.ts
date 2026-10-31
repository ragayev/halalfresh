import { db } from "@/lib/db";
import { AppError } from "./errors";

export async function getMerchant() {
  const m = await db.merchant.findFirst({
    orderBy: { createdAt: "asc" },
    include: { settings: true },
  });
  if (!m || !m.settings) throw new AppError("CHECKOUT_UNAVAILABLE", "Store is not configured", 503);
  return m as typeof m & { settings: NonNullable<typeof m.settings> };
}
