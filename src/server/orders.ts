import type { Order, OrderStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertTransition, isTerminal, TransitionError, type Actor } from "@/domain/order-state";
import { exceedsTolerance, finalizeOrder } from "@/domain/pricing";
import { AppError } from "./errors";
import { getSetting } from "./app-settings";
import { notifyAdmin, notifyCustomer } from "./notifications/notify";

export async function audit(
  actor: string,
  action: string,
  entity?: string,
  entityId?: string,
  detail?: Prisma.InputJsonValue,
  client: Prisma.TransactionClient = db,
) {
  await client.auditLog.create({ data: { actor, action, entity, entityId, detail } });
}

const FULL_INCLUDE = {
  items: { orderBy: { id: "asc" as const } },
  customer: true,
  merchant: true,
  payments: { orderBy: { createdAt: "asc" as const } },
  events: { orderBy: { createdAt: "asc" as const } },
  notifications: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.OrderInclude;

export async function getOrderForAdmin(id: string) {
  return db.order.findUnique({ where: { id }, include: FULL_INCLUDE });
}

export type PublicOrder = NonNullable<Awaited<ReturnType<typeof getOrderByToken>>>["order"];

/**
 * Guest tracking link. Returns `expired` when the order has been terminal longer than `tokenExpiryDays`.
 * Internal notes, the idempotency key and the customer's phone never leave the server through this query.
 */
export async function getOrderByToken(token: string, now = new Date()) {
  if (!token || token.length < 20) return null;
  const order = await db.order.findUnique({
    where: { publicToken: token },
    omit: { publicToken: true, adminNotes: true, requestId: true, commissionBps: true, commissionCents: true },
    include: {
      items: { orderBy: { id: "asc" } },
      customer: { select: { firstName: true } },
      merchant: { select: { name: true, legalName: true, addressLine: true, postalCode: true, city: true, contactEmail: true, contactPhone: true } },
      events: { select: { toStatus: true, createdAt: true, reason: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) return null;
  const days = await getSetting("tokenExpiryDays");
  const expired = !!order.terminalAt && now.getTime() > order.terminalAt.getTime() + days * 86400_000;
  return { order, expired };
}

async function lockOrder(tx: Prisma.TransactionClient, orderId: string): Promise<Order> {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  const o = await tx.order.findUnique({ where: { id: orderId } });
  if (!o) throw new AppError("NOT_FOUND", "Order not found", 404);
  return o;
}

export interface TransitionOpts {
  actor: Actor;
  /** Identifier shown in the log, e.g. admin email. Stored in metadata. */
  actorId?: string;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue;
  /** Extra column updates applied atomically with the status change. */
  patch?: Prisma.OrderUpdateInput;
  /** Skip customer/admin notifications (used by tests and bulk repairs). */
  silent?: boolean;
}

const SIDE_EFFECT: Partial<Record<OrderStatus, () => (id: string) => Promise<void>>> = {
  ACCEPTED: () => (id) => notifyCustomer(id, "accepted"),
  WEIGHED: () => (id) => notifyCustomer(id, "weighed"),
  OUT_FOR_DELIVERY: () => (id) => notifyCustomer(id, "out_for_delivery"),
  CANCELLED: () => (id) => notifyCustomer(id, "cancelled"),
  PAYMENT_OVERDUE: () => (id) => notifyCustomer(id, "payment_overdue"),
  PAID: () => (id) => notifyAdmin(id, "paid"),
};

/**
 * The only way an order changes status. Locks the row, validates against the transition table, writes the
 * append-only event, then fires notifications after commit. Throws TransitionError (typed) when not allowed.
 * Idempotent callers can pass `idempotentIfAt` to treat "already there" as a no-op.
 */
export async function transitionOrder(orderId: string, to: OrderStatus, opts: TransitionOpts & { idempotentIfAt?: boolean }) {
  const result = await db.$transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    if (opts.idempotentIfAt && o.status === to) return { order: o, changed: false };
    assertTransition({ from: o.status, to, method: o.paymentMethod, actor: opts.actor, reason: opts.reason });
    const now = new Date();
    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        ...opts.patch,
        status: to,
        ...(to === "ACCEPTED" ? { acceptedAt: now } : {}),
        ...(to === "WEIGHED" ? { weighedAt: now } : {}),
        ...(to === "PAID" ? { paidAt: now } : {}),
        ...(to === "CANCELLED" ? { cancelReason: opts.reason ?? null } : {}),
        ...(to === "REFUSED_AT_DOOR" ? { refusedAt: now } : {}),
        ...(isTerminal(to) ? { terminalAt: now } : {}),
      },
    });
    if (to === "REFUSED_AT_DOOR") await tx.customer.update({ where: { id: o.customerId }, data: { refusedCount: { increment: 1 } } });
    // A cancelled order must not leave a payable PayPal order behind.
    if (to === "CANCELLED") await tx.payment.updateMany({ where: { orderId, status: { in: ["CREATED", "APPROVED"] } }, data: { status: "VOIDED" } });
    await tx.orderEvent.create({
      data: {
        orderId,
        fromStatus: o.status,
        toStatus: to,
        actor: opts.actor,
        reason: opts.reason ?? null,
        metadata: { ...(opts.actorId ? { actorId: opts.actorId } : {}), ...((opts.metadata as object | undefined) ?? {}) },
      },
    });
    return { order: updated, changed: true };
  });
  if (result.changed && !opts.silent) await SIDE_EFFECT[to]?.()(orderId);
  return result.order;
}

/** Customer cancel from the public link. Enforces NEW/ACCEPTED only. */
export async function cancelByCustomer(token: string) {
  const o = await db.order.findUnique({ where: { publicToken: token }, select: { id: true } });
  if (!o) throw new AppError("NOT_FOUND", "Order not found", 404);
  try {
    return await transitionOrder(o.id, "CANCELLED", { actor: "customer", reason: "Vom Kunden storniert" });
  } catch (e) {
    if (e instanceof TransitionError) throw new AppError("INVALID_TRANSITION", "This order can no longer be cancelled", 409);
    throw e;
  }
}

export interface WeightInput {
  itemId: string;
  actualGrams: number;
}

export interface WeighResult {
  order: Order;
  finalTotalCents: number;
  cappedAmountCents: number;
  lineWarnings: string[];
}

/**
 * Weight entry (PREPARING -> WEIGHED) and weight correction (WEIGHED, unpaid, status unchanged).
 * Recomputes the final total from snapshotted unit prices and the order's own tolerance cap.
 */
export async function recordWeights(orderId: string, weights: WeightInput[], opts: { actor: Actor; actorId?: string }): Promise<WeighResult> {
  const out = await db.$transaction(async (tx) => {
    const o = await lockOrder(tx, orderId);
    const correction = o.status === "WEIGHED" || o.status === "PAYMENT_OVERDUE";
    if (o.status !== "PREPARING" && !correction) throw new TransitionError("INVALID_TRANSITION", o.status, "WEIGHED");
    if (correction && o.paidAt) throw new AppError("INVALID_TRANSITION", "Paid orders cannot be re-weighed", 409);
    const items = await tx.orderItem.findMany({ where: { orderId }, orderBy: { id: "asc" } });
    const byId = new Map(weights.map((w) => [w.itemId, w.actualGrams]));
    if (byId.size !== weights.length || items.some((i) => !byId.has(i.id)) || weights.some((w) => !items.some((i) => i.id === w.itemId)))
      throw new AppError("VALIDATION", "A weight is required for every order line", 400);
    for (const w of weights) if (!Number.isInteger(w.actualGrams) || w.actualGrams < 0 || w.actualGrams > 100_000) throw new AppError("VALIDATION", "Invalid weight", 400);

    const maxItems = o.maxTotalCents - o.deliveryFeeCents;
    const fin = finalizeOrder(items.map((i) => ({ pricePerKgCents: i.unitPricePerKgCents, actualGrams: byId.get(i.id)! })), maxItems, o.deliveryFeeCents);
    for (const [idx, i] of items.entries()) await tx.orderItem.update({ where: { id: i.id }, data: { actualGrams: byId.get(i.id)!, finalCents: fin.lineFinals[idx] } });
    const warnings = items.filter((i) => exceedsTolerance(i.requestedGrams, byId.get(i.id)!, o.toleranceBps)).map((i) => i.productName);
    const now = new Date();
    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        finalTotalCents: fin.finalTotalCents,
        cappedAmountCents: fin.cappedAmountCents > 0 ? fin.cappedAmountCents : null,
        weighedAt: now,
        ...(correction ? {} : { status: "WEIGHED" as const }),
      },
    });
    if (correction) {
      // The old PayPal order is for the old amount: it must never be captured.
      await tx.payment.updateMany({ where: { orderId, status: { in: ["CREATED", "APPROVED", "PENDING"] } , NOT: { amountCents: fin.finalTotalCents } }, data: { status: "VOIDED" } });
    }
    await tx.orderEvent.create({
      data: {
        orderId,
        fromStatus: o.status,
        toStatus: correction ? o.status : "WEIGHED",
        actor: opts.actor,
        reason: correction ? "weight_correction" : "weighed",
        metadata: { ...(opts.actorId ? { actorId: opts.actorId } : {}), finalTotalCents: fin.finalTotalCents, cappedAmountCents: fin.cappedAmountCents, previousFinalTotalCents: o.finalTotalCents },
      },
    });
    return { order: updated, fin, warnings, correction };
  });
  await notifyCustomer(orderId, out.correction ? "weight_corrected" : "weighed", { force: out.correction });
  return { order: out.order, finalTotalCents: out.fin.finalTotalCents, cappedAmountCents: out.fin.cappedAmountCents, lineWarnings: out.warnings };
}

export async function addNote(orderId: string, note: string, actor: string) {
  await db.$transaction([
    db.order.update({ where: { id: orderId }, data: { adminNotes: note } }),
    db.auditLog.create({ data: { actor, action: "ORDER_NOTE", entity: "Order", entityId: orderId, detail: { note } } }),
  ]);
}

/** Orders in WEIGHED (PayPal) unpaid for longer than `paymentOverdueHours`. For list highlighting. */
export async function overdueThreshold(now = new Date()) {
  const hours = await getSetting("paymentOverdueHours");
  return new Date(now.getTime() - hours * 3600_000);
}
