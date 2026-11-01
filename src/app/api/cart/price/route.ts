import { NextResponse } from "next/server";
import { z } from "zod";
import { LOCALES } from "@/i18n/config";
import { normalizePostcode } from "@/domain/delivery";
import { cartView } from "@/server/cart-view";
import { errorBody } from "@/server/errors";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const body = z.object({
  locale: z.enum(LOCALES).default("de"),
  postcode: z.string().max(10).transform(normalizePostcode).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1).max(64),
        grams: z.number().int().positive().max(1_000_000),
      }),
    )
    .max(50),
});

export async function POST(req: Request) {
  try {
    const rl = await rateLimit(`cartprice:${clientIp(req.headers)}`, 120, 60);
    if (!rl.ok) return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, { status: 429 });
    const parsed = body.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION", message: "Invalid cart" } }, { status: 400 });
    if (!parsed.data.lines.length) return NextResponse.json({ lines: [], totals: null });
    return NextResponse.json(await cartView(parsed.data.lines, parsed.data.locale, parsed.data.postcode));
  } catch (e) {
    const { status, body } = errorBody(e);
    return NextResponse.json(body, { status });
  }
}
