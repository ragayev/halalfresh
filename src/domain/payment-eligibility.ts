import type { PaymentMethod } from "@prisma/client";

export interface CashFacts {
  /** Orders by this phone that were delivered AND paid (DELIVERED or CASH_COLLECTED). */
  completedOrders: number;
  refusedCount: number;
  blockedCash: boolean;
}

export type CashReason = "FIRST_ORDER" | "REFUSED_BEFORE" | "BLOCKED";

/** PayPal is always allowed. Cash needs a completed order, no refusals and no manual block. */
export function cashEligibility(f: CashFacts): { allowed: true } | { allowed: false; reason: CashReason } {
  if (f.blockedCash) return { allowed: false, reason: "BLOCKED" };
  if (f.refusedCount > 0) return { allowed: false, reason: "REFUSED_BEFORE" };
  if (f.completedOrders < 1) return { allowed: false, reason: "FIRST_ORDER" };
  return { allowed: true };
}

export function methodAllowed(method: PaymentMethod, f: CashFacts): boolean {
  return method === "PAYPAL" || cashEligibility(f).allowed;
}
