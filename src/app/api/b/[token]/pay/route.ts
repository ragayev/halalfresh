import { guarded } from "@/lib/api";
import { startPayment } from "@/server/payments/service";

/** "Pay with PayPal": returns the PayPal order id for the final amount (reused if already open). */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return guarded(req, "pay", 20, 600, async () => {
    const p = await startPayment(token);
    return { id: p.providerOrderId, approveUrl: p.approveUrl };
  });
}
