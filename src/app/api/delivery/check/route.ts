import { NextResponse } from "next/server";
import { isValidPostcode, normalizePostcode } from "@/domain/delivery";
import { checkDelivery } from "@/server/delivery-service";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/** GET /api/delivery/check?postcode=XXXXX -> zone, mode, terms and the next concrete delivery slot. */
export async function GET(req: Request) {
  const rl = await rateLimit(`pc:${clientIp(req.headers)}`, 60, 60);
  if (!rl.ok) return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, { status: 429 });
  const postcode = normalizePostcode(new URL(req.url).searchParams.get("postcode") ?? "");
  if (!isValidPostcode(postcode)) return NextResponse.json({ error: { code: "VALIDATION", message: "Invalid postcode" } }, { status: 400 });
  return NextResponse.json(await checkDelivery(postcode), { headers: { "Cache-Control": "no-store" } });
}
