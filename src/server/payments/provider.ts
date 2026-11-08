import { paymentProviderName } from "@/lib/env";

export interface PaymentLine {
  name: string;
  amountCents: number;
}

export interface CreateProviderOrder {
  amountCents: number;
  /** Idempotency key, sent as PayPal-Request-Id. */
  requestId: string;
  orderNumberLabel: string;
  sellerName: string;
  lines: PaymentLine[];
  returnUrl: string;
  cancelUrl: string;
}

export interface CreatedProviderOrder {
  providerOrderId: string;
  raw: unknown;
}

export type CaptureStatus = "COMPLETED" | "PENDING" | "DECLINED";

export interface CaptureResult {
  status: CaptureStatus;
  captureId: string | null;
  amountCents: number | null;
  raw: unknown;
}

/**
 * Payment provider abstraction. The MVP implements PayPal Orders v2 with intent=CAPTURE; a later
 * authorize-then-capture flow and marketplace fees (platform_fees) add methods here without schema changes.
 */
export interface PaymentProvider {
  name: "paypal" | "mock";
  createOrder(args: CreateProviderOrder): Promise<CreatedProviderOrder>;
  captureOrder(providerOrderId: string, requestId: string): Promise<CaptureResult>;
  /** Verifies a webhook with the provider. Must be called before acting on any webhook. */
  verifyWebhook(headers: Headers, rawBody: string): Promise<boolean>;
}

export async function getProvider(): Promise<PaymentProvider> {
  if (paymentProviderName() === "mock") return (await import("./mock")).mockProvider;
  return (await import("./paypal")).paypalProvider;
}
