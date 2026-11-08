import { z } from "zod";
import { guarded } from "@/lib/api";
import { AppError } from "@/server/errors";
import { captureForOrder } from "@/server/payments/service";

/** PayPal onApprove -> server-side capture. The browser never sees credentials or decides the amount. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return guarded(req, "capture", 20, 600, async () => {
    const body = z.object({ orderId: z.string().min(1).max(64) }).safeParse(await req.json().catch(() => null));
    if (!body.success) throw new AppError("VALIDATION", "Invalid request", 400);
    return captureForOrder(token, body.data.orderId);
  });
}
