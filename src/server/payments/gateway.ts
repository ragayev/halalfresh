import { assertMockAllowed, gatewayName } from "@/lib/env";

export interface CheckoutLine {
  name: string;
  amountCents: number; // total for this line, quantity is always 1
}

export interface CreateCheckoutArgs {
  orderId: string;
  orderNumber: number;
  lines: CheckoutLine[];
  totalCents: number;
  applicationFeeCents?: number;
  customerEmail: string;
  connectedAccountId: string | null;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
  locale: string;
}

export interface RefundArgs {
  paymentIntentId: string;
  amountCents: number;
  connectedAccountId: string | null;
  idempotencyKey: string;
}

export interface AccountStatus {
  accountId: string | null;
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: string[];
  mode: "live" | "test" | "mock";
}

export interface PaymentGateway {
  readonly name: "stripe" | "mock";
  createCheckout(a: CreateCheckoutArgs): Promise<{ sessionId: string; url: string; expiresAt: Date }>;
  expireCheckout(sessionId: string, connectedAccountId: string | null): Promise<void>;
  refund(a: RefundArgs): Promise<{ refundId: string; status: string }>;
  getAccountStatus(accountId: string | null): Promise<AccountStatus>;
}

let cached: PaymentGateway | null = null;

export async function getGateway(): Promise<PaymentGateway> {
  if (cached) return cached;
  if (gatewayName() === "mock") {
    assertMockAllowed();
    cached = (await import("./mock")).mockGateway;
  } else {
    cached = (await import("./stripe")).stripeGateway;
  }
  return cached;
}
