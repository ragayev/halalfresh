import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripeClient } from "@/server/payments/stripe";
import { processStripeEvent } from "@/server/payments/webhook";
import { log } from "@/lib/logger";

/** Stripe Connect webhook: events for the connected butcher account (payments, refunds). Raw body is required for signature checks. */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get("stripe-signature");
  if (!secret || !sig) return NextResponse.json({ error: "not configured" }, { status: 400 });
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(raw, sig, secret);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  try {
    const result = await processStripeEvent(event);
    return NextResponse.json({ received: true, result });
  } catch (e) {
    log.error("webhook.failed", {
      eventId: event.id,
      type: event.type,
      error: e,
    });
    return NextResponse.json({ error: "processing failed" }, { status: 500 }); // Stripe retries
  }
}
