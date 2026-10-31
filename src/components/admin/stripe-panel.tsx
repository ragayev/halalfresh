"use client";
import { Badge } from "@/components/ui";
import type { AccountStatus } from "@/server/payments/gateway";

export function StripePanel({ status, error }: { status: AccountStatus | null; error: string }) {
  if (!status) return <p className="text-danger">{error}</p>;
  const ready = status.connected && status.chargesEnabled;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <Badge tone="gray">Mode: {status.mode}</Badge>
        <Badge tone={status.connected ? "green" : "red"}>
          {status.connected ? `Account ${status.accountId ?? ""}` : "STRIPE_SECRET_KEY missing"}
        </Badge>
        <Badge tone={status.chargesEnabled ? "green" : "amber"}>Charges {status.chargesEnabled ? "enabled" : "disabled"}</Badge>
        <Badge tone={status.payoutsEnabled ? "green" : "amber"}>Payouts {status.payoutsEnabled ? "enabled" : "disabled"}</Badge>
      </div>
      {!ready && <p className="rounded-xl bg-warn p-3 font-medium text-warn-ink">Checkout is disabled until Stripe can accept charges.</p>}
      <p className="text-muted">
        Payment methods (card, PayPal, Apple Pay, Google Pay, Klarna…) are switched on in the Stripe Dashboard → Settings → Payment methods.
      </p>
    </div>
  );
}
