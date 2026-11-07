import { NextResponse } from "next/server";
import { createOrder } from "@/server/checkout";
import { errorBody } from "@/server/errors";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/logger";

export async function POST(req: Request) {
  try {
    const rl = await rateLimit(`checkout:${clientIp(req.headers)}`, 10, 600);
    if (!rl.ok)
      return NextResponse.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many attempts. Please wait a few minutes.",
          },
        },
        { status: 429 },
      );
    const json = await req.json().catch(() => null);
    const r = await createOrder(json);
    return NextResponse.json({ token: r.token, url: `/${r.locale}/b/${r.token}` });
  } catch (e) {
    const { status, body } = errorBody(e);
    if (status >= 500) log.error("checkout.unhandled", { error: e });
    return NextResponse.json(body, { status });
  }
}
