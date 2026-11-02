import { randomBytes } from "node:crypto";
import { siteUrl } from "@/lib/env";
import type { PaymentGateway } from "./gateway";

/** Local/test-only gateway. Never selectable in production (see gateway.ts). */
export const mockGateway: PaymentGateway = {
  name: "mock",
  async createCheckout(a) {
    const sessionId = `cs_mock_${randomBytes(8).toString("hex")}`;
    const q = new URLSearchParams({
      success: a.successUrl,
      cancel: a.cancelUrl,
    });
    return {
      sessionId,
      url: `${siteUrl()}/en/dev/mock-pay/${sessionId}?${q}`,
      expiresAt: new Date(Date.now() + 31 * 60_000),
    };
  },
  async expireCheckout() {},
  async refund() {
    return {
      refundId: `re_mock_${randomBytes(8).toString("hex")}`,
      status: "succeeded",
    };
  },
  async getAccountStatus(accountId) {
    return {
      accountId: accountId ?? "acct_mock",
      connected: true,
      chargesEnabled: true,
      payoutsEnabled: true,
      sepaDebitEnabled: true,
      detailsSubmitted: true,
      requirementsDue: [],
      mode: "mock",
    };
  },
};
