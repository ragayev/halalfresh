import { guarded } from "@/lib/api";
import { cancelByCustomer } from "@/server/orders";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return guarded(req, "cancel", 10, 600, async () => {
    await cancelByCustomer(token);
    return { ok: true };
  });
}
