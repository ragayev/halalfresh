"use client";
import { Badge } from "@/components/ui";
import type { AccountStatus } from "@/server/payments/gateway";

export function StripePanel({ status, error }: { status: AccountStatus | null; error: string }) {
  if (!status) return <p className="text-danger">{error}</p>;
  const ready = status.connected && status.chargesEnabled && status.sepaDebitEnabled;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <Badge tone="gray">Mode: {status.mode}</Badge>
        <Badge tone={status.connected ? "green" : "red"}>
          {status.connected ? `Account ${status.accountId ?? ""}` : "STRIPE_SECRET_KEY missing"}
        </Badge>
        <Badge tone={status.chargesEnabled ? "green" : "amber"}>Charges {status.chargesEnabled ? "enabled" : "disabled"}</Badge>
        <Badge tone={status.sepaDebitEnabled ? "green" : "red"}>SEPA debit {status.sepaDebitEnabled ? "active" : "not active"}</Badge>
        <Badge tone={status.payoutsEnabled ? "green" : "amber"}>Payouts {status.payoutsEnabled ? "enabled" : "disabled"}</Badge>
      </div>
      {!ready && <p className="rounded-xl bg-warn p-3 font-medium text-warn-ink">Checkout is disabled until the seller&apos;s connected account can accept SEPA Direct Debit charges.</p>}
      <p className="text-muted">
        V1 checkout offers SEPA Direct Debit only (set in code, not in the Dashboard). Charges are direct charges on the seller&apos;s connected account.
      </p>
    </div>
  );
}
