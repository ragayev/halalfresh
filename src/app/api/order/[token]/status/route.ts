import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Tiny polling endpoint for the guest tracking page. Auth is the unguessable token itself.
 * Returns statuses only (no names, addresses, contact data) and is never cached.
 */
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer" };

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20 || token.length > 128) return NextResponse.json({ error: "not found" }, { status: 404, headers: NO_STORE });
  // Generous (page polls at most every 3-60 s) but stops token-guessing and runaway tabs.
  const rl = await rateLimit(`order-status:${clientIp(req.headers)}`, 120, 60);
  if (!rl.ok) return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "30" } });
  const o = await db.order.findUnique({
    where: { accessToken: token },
    select: { paymentStatus: true, fulfillmentStatus: true, sepaInitiatedAt: true, updatedAt: true },
  });
  if (!o) return NextResponse.json({ error: "not found" }, { status: 404, headers: NO_STORE });
  return NextResponse.json(
    {
      paymentStatus: o.paymentStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      sepaInitiated: !!o.sepaInitiatedAt,
      version: o.updatedAt.getTime(),
    },
    { headers: NO_STORE },
  );
}
