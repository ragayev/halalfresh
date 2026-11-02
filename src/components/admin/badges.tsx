import { Badge } from "@/components/ui";
export const PaymentBadge = ({ s, sepa }: { s: string; sepa?: boolean }) =>
  s === "PENDING_PAYMENT" && sepa ? (
    <Badge tone="amber">sepa processing</Badge>
  ) : (
    <Badge tone={s === "PAID" ? "green" : s === "PENDING_PAYMENT" ? "amber" : s.includes("REFUND") ? "blue" : "red"}>
      {s.replace(/_/g, " ").toLowerCase()}
    </Badge>
  );
export const FulfillmentBadge = ({ s }: { s: string }) => (
  <Badge tone={s === "DELIVERED" ? "green" : s === "CANCELLED" ? "red" : s === "AWAITING_FORWARDING" ? "amber" : "blue"}>
    {s.replace(/_/g, " ").toLowerCase()}
  </Badge>
);
