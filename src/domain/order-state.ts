import type { OrderStatus, PaymentMethod } from "@prisma/client";

export type Actor = "customer" | "admin" | "system" | "webhook";

/** Explicit transition table. Anything not listed is rejected. Payment-method rules are in `methodGuard`. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  NEW: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["PREPARING", "CANCELLED"],
  PREPARING: ["WEIGHED", "CANCELLED"],
  WEIGHED: ["PAID", "OUT_FOR_DELIVERY", "PAYMENT_OVERDUE", "CANCELLED"],
  PAYMENT_OVERDUE: ["PAID", "CANCELLED"],
  PAID: ["OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "DELIVERED_UNPAID", "REFUSED_AT_DOOR", "CANCELLED"],
  DELIVERED_UNPAID: ["CASH_COLLECTED", "CANCELLED"],
  DELIVERED: [],
  CASH_COLLECTED: [],
  REFUSED_AT_DOOR: [],
  CANCELLED: [],
};

export const TERMINAL_STATUSES: readonly OrderStatus[] = ["DELIVERED", "CASH_COLLECTED", "REFUSED_AT_DOOR", "CANCELLED"];
export const CUSTOMER_CANCELLABLE: readonly OrderStatus[] = ["NEW", "ACCEPTED"];

export type TransitionErrorCode = "INVALID_TRANSITION" | "METHOD_MISMATCH" | "CUSTOMER_CANNOT_CANCEL" | "REASON_REQUIRED";

export class TransitionError extends Error {
  constructor(
    public code: TransitionErrorCode,
    public from: OrderStatus,
    public to: OrderStatus,
    message?: string,
  ) {
    super(message ?? `${code}: ${from} -> ${to}`);
    this.name = "TransitionError";
  }
}

export function isTerminal(s: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(s);
}

/** PayPal orders are paid before dispatch; cash orders are collected at the door. */
function methodGuard(to: OrderStatus, from: OrderStatus, method: PaymentMethod): boolean {
  if (to === "PAID" || to === "PAYMENT_OVERDUE" || to === "DELIVERED") return method === "PAYPAL";
  if (to === "DELIVERED_UNPAID" || to === "CASH_COLLECTED") return method === "CASH";
  if (from === "WEIGHED" && to === "OUT_FOR_DELIVERY") return method === "CASH";
  return true;
}

/** Statuses an order may move to next (before actor/reason checks). */
export function allowedNext(from: OrderStatus, method: PaymentMethod): OrderStatus[] {
  return TRANSITIONS[from].filter((to) => methodGuard(to, from, method));
}

/** Throws a typed TransitionError when the move is not allowed. */
export function assertTransition(opts: {
  from: OrderStatus;
  to: OrderStatus;
  method: PaymentMethod;
  actor: Actor;
  reason?: string | null;
}): void {
  const { from, to, method, actor, reason } = opts;
  if (!TRANSITIONS[from].includes(to)) throw new TransitionError("INVALID_TRANSITION", from, to);
  if (!methodGuard(to, from, method)) throw new TransitionError("METHOD_MISMATCH", from, to, `${to} is not valid for ${method} orders`);
  if (to === "CANCELLED") {
    if (actor === "customer" && !CUSTOMER_CANCELLABLE.includes(from)) throw new TransitionError("CUSTOMER_CANNOT_CANCEL", from, to);
    if (actor !== "customer" && !reason?.trim()) throw new TransitionError("REASON_REQUIRED", from, to, "A cancellation reason is required");
  }
}

export function orderNumberLabel(n: number): string {
  return `HF-${String(n).padStart(6, "0")}`;
}
