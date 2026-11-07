import { NextResponse } from "next/server";
import { cashStatusForPhone } from "@/server/checkout";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Whether cash is offered for this phone. The reason is deliberately collapsed so the endpoint cannot be used to
 * learn whether a number is a known customer or has refused deliveries. The server re-checks at order creation.
 */
export async function GET(req: Request) {
  const rl = await rateLimit(`cashcheck:${clientIp(req.headers)}`, 15, 600);
  if (!rl.ok) return NextResponse.json({ error: { code: "RATE_LIMITED" } }, { status: 429 });
  const phone = new URL(req.url).searchParams.get("phone") ?? "";
  const s = await cashStatusForPhone(phone);
  return NextResponse.json({ allowed: s.allowed });
}
