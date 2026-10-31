import { NextResponse } from "next/server";
import { stripeClient } from "@/server/payments/stripe";

/** Platform-account events (e.g. account.updated). Onboarding status is read live from Stripe in the admin, so this only verifies and acknowledges. */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_PLATFORM_WEBHOOK_SECRET;
  const sig = req.headers.get("stripe-signature");
  if (!secret || !sig) return NextResponse.json({ error: "not configured" }, { status: 400 });
  try {
    stripeClient().webhooks.constructEvent(await req.text(), sig, secret);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  return NextResponse.json({ received: true });
}
