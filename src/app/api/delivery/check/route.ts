import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidPostcode, normalizePostcode } from "@/domain/delivery";
import { zoneForPostcode } from "@/server/delivery-service";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const body = z.object({
  postcode: z.string().transform(normalizePostcode).refine(isValidPostcode),
});

export async function POST(req: Request) {
  const rl = await rateLimit(`pc:${clientIp(req.headers)}`, 60, 60);
  if (!rl.ok) return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION", message: "Invalid postcode" } }, { status: 400 });
  const { zone } = await zoneForPostcode(parsed.data.postcode);
  return NextResponse.json({ supported: !!zone });
}
