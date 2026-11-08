import { NextResponse } from "next/server";
import { log } from "@/lib/logger";
import { processWebhook } from "@/server/payments/service";

/** PayPal webhooks. Signature is verified with PayPal before anything is acted on; processing is idempotent. */
export async function POST(req: Request) {
  const raw = await req.text();
  try {
    const outcome = await processWebhook(req.headers, raw);
    if (outcome === "invalid") return NextResponse.json({ error: "invalid signature" }, { status: 400 });
    return NextResponse.json({ ok: true, outcome });
  } catch (e) {
    log.error("paypal.webhook_failed", { error: e });
    // 5xx makes PayPal retry; the processed-event row was removed so the retry is not seen as a duplicate.
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
