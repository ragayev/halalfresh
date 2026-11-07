import { NextResponse } from "next/server";
import { errorBody } from "@/server/errors";
import { TransitionError } from "@/domain/order-state";
import { clientIp, rateLimit } from "./rate-limit";
import { log } from "./logger";

/** Rate-limits by IP + bucket, runs the handler and maps typed errors to JSON responses. */
export async function guarded(req: Request, bucket: string, limit: number, windowSec: number, run: () => Promise<unknown>) {
  try {
    const rl = await rateLimit(`${bucket}:${clientIp(req.headers)}`, limit, windowSec);
    if (!rl.ok) return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, { status: 429 });
    return NextResponse.json(await run());
  } catch (e) {
    if (e instanceof TransitionError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: 409 });
    const { status, body } = errorBody(e);
    if (status >= 500) log.error(`${bucket}.unhandled`, { error: e });
    return NextResponse.json(body, { status });
  }
}
