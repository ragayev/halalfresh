import { assertMockAllowed } from "@/lib/env";
import type { CaptureResult, PaymentProvider } from "./provider";

/**
 * Local stand-in for PayPal (dev and tests). Behaviour is controlled by `mockControl`.
 * Refused when NODE_ENV=production.
 */
export const mockControl = {
  nextCapture: "COMPLETED" as CaptureResult["status"],
  webhookValid: true,
  created: [] as { id: string; amountCents: number; requestId: string }[],
  captured: new Map<string, number>(),
};

let seq = 0;
const requestIds = new Map<string, string>();

export const mockProvider: PaymentProvider = {
  name: "mock",
  async createOrder(a) {
    assertMockAllowed();
    // Idempotent on the request id, like PayPal-Request-Id.
    const existing = requestIds.get(a.requestId);
    const links = (id: string) => [{ rel: "payer-action", href: `${a.returnUrl}?token=${id}` }];
    if (existing) return { providerOrderId: existing, raw: { id: existing, mock: true, links: links(existing) } };
    const id = `MOCK-ORDER-${++seq}`;
    requestIds.set(a.requestId, id);
    mockControl.created.push({ id, amountCents: a.amountCents, requestId: a.requestId });
    return { providerOrderId: id, raw: { id, mock: true, links: links(id) } };
  },
  async captureOrder(providerOrderId) {
    assertMockAllowed();
    const order = mockControl.created.find((c) => c.id === providerOrderId);
    if (!order) throw new Error("unknown mock order");
    const n = (mockControl.captured.get(providerOrderId) ?? 0) + 1;
    mockControl.captured.set(providerOrderId, n);
    return { status: mockControl.nextCapture, captureId: `MOCK-CAP-${providerOrderId}`, amountCents: order.amountCents, raw: { mock: true } };
  },
  async verifyWebhook() {
    assertMockAllowed();
    return mockControl.webhookValid;
  },
};
