import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { isValidPostcode, normalizePostcode } from "@/domain/delivery";
import { LOCALES } from "@/i18n/config";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const body = z.object({
  postcode: z.string().transform(normalizePostcode).refine(isValidPostcode),
  name: z.string().trim().min(2).max(120),
  contact: z
    .string()
    .trim()
    .min(5)
    .max(200)
    .refine((v) => /^\S+@\S+\.\S+$/.test(v) || /^\+?[\d\s()/-]{6,24}$/.test(v)),
  preferredLanguage: z.enum(LOCALES),
  // DSGVO: explicit opt-in, never pre-ticked. The server stamps the time itself.
  consent: z.literal(true),
});

export async function POST(req: Request) {
  const rl = await rateLimit(`waitlist:${clientIp(req.headers)}`, 10, 3600);
  if (!rl.ok) return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION", message: "Invalid input" } }, { status: 400 });
  const v = parsed.data;
  await db.waitlistEntry.create({
    data: { postcode: v.postcode, name: v.name, contact: v.contact, preferredLanguage: v.preferredLanguage, consentGivenAt: new Date() },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
