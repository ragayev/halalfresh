import { NextResponse } from "next/server";
import { z } from "zod";
import { expandBundle } from "@/server/bundle-expand";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const body = z.object({ slug: z.string().min(1).max(120), packages: z.number().int().min(1).max(5).default(1) });

export async function POST(req: Request) {
  const rl = await rateLimit(`bundle:${clientIp(req.headers)}`, 60, 60);
  if (!rl.ok) return NextResponse.json({ error: { code: "RATE_LIMITED" } }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION" } }, { status: 400 });
  const r = await expandBundle(parsed.data.slug, parsed.data.packages);
  if (!r.ok) return NextResponse.json({ error: { code: r.reason } }, { status: r.reason === "NOT_FOUND" ? 404 : 409 });
  return NextResponse.json(r);
}
