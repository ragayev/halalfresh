import { createHash } from "node:crypto";
import { assertMockAllowed } from "@/lib/env";
import type { CaptureResult, PaymentProvider } from "./provider";

/**
 * Local stand-in for PayPal (dev, tests, e2e). Stateless so it behaves the same across separately bundled routes:
 * the order id encodes the amount and is derived from the request id, which also makes create idempotent like
 * `PayPal-Request-Id`. `mockControl` lets unit tests steer outcomes. Refused when NODE_ENV=production.
 */
export const mockControl = {
  nextCapture: "COMPLETED" as CaptureResult["status"],
  webhookValid: true,
  created: [] as { id: string; amountCents: number; requestId: string }[],
};

const idFor = (amountCents: number, requestId: string) => `MOCK-${amountCents}-${createHash("sha1").update(requestId).digest("hex").slice(0, 12)}`;

export const mockProvider: PaymentProvider = {
  name: "mock",
  async createOrder(a) {
    assertMockAllowed();
    const id = idFor(a.amountCents, a.requestId);
    if (!mockControl.created.some((c) => c.id === id)) mockControl.created.push({ id, amountCents: a.amountCents, requestId: a.requestId });
    return { providerOrderId: id, raw: { id, mock: true, links: [{ rel: "payer-action", href: `${a.returnUrl}?token=${id}` }] } };
  },
  async captureOrder(providerOrderId) {
    assertMockAllowed();
    const m = /^MOCK-(\d+)-/.exec(providerOrderId);
    if (!m) throw new Error("unknown mock order");
    return { status: mockControl.nextCapture, captureId: `MOCK-CAP-${providerOrderId}`, amountCents: Number(m[1]), raw: { mock: true } };
  },
  async verifyWebhook() {
    assertMockAllowed();
    return mockControl.webhookValid;
  },
};
