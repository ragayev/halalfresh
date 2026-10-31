import type Stripe from "stripe";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { assertMockAllowed } from "@/lib/env";
import { processStripeEvent } from "./webhook";

/** Dev/test only: feeds a synthetic Stripe event through the REAL webhook processor (no signature step). */
export async function simulateMockPayment(sessionId: string, outcome: "paid" | "expired") {
  assertMockAllowed();
  if (process.env.PAYMENT_GATEWAY !== "mock") throw new Error("Mock payments disabled");
  const payment = await db.payment.findUnique({
    where: { stripeCheckoutSessionId: sessionId },
  });
  if (!payment) throw new Error("Unknown session");
  const base = {
    id: sessionId,
    object: "checkout.session",
    amount_total: payment.amountCents,
    currency: "eur",
    metadata: { orderId: payment.orderId },
  };
  const event =
    outcome === "paid"
      ? {
          type: "checkout.session.completed",
          data: {
            object: {
              ...base,
              payment_status: "paid",
              payment_intent: `pi_mock_${randomBytes(8).toString("hex")}`,
            },
          },
        }
      : {
          type: "checkout.session.expired",
          data: { object: { ...base, payment_status: "unpaid" } },
        };
  return processStripeEvent({
    id: `evt_mock_${randomBytes(8).toString("hex")}`,
    object: "event",
    api_version: "mock",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    account: payment.connectedAccountId ?? undefined,
    ...event,
  } as unknown as Stripe.Event);
}
