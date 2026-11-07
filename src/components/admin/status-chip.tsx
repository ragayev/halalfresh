import type { OrderStatus } from "@prisma/client";
import { cn } from "@/lib/utils";

/** Admin status chips (brief §17.11). Colours are the spec's pairs; all meet AA on their own background. */
const STYLE: Record<OrderStatus, { bg: string; fg: string; label: string }> = {
  NEW: { bg: "#E8F1F8", fg: "#1F5F8B", label: "Neu" },
  ACCEPTED: { bg: "#EEF0FB", fg: "#3B4BA8", label: "Angenommen" },
  PREPARING: { bg: "#FDF3E1", fg: "#8A5A12", label: "In Vorbereitung" },
  WEIGHED: { bg: "#F3ECFA", fg: "#6B3FA0", label: "Gewogen" },
  PAYMENT_OVERDUE: { bg: "#FDECEA", fg: "#B42318", label: "Zahlung überfällig" },
  PAID: { bg: "#E7F1EB", fg: "#2F6B4F", label: "Bezahlt" },
  OUT_FOR_DELIVERY: { bg: "#E6F4F4", fg: "#1D6B6B", label: "Unterwegs" },
  DELIVERED_UNPAID: { bg: "#FDF3E1", fg: "#8A5A12", label: "Geliefert, unbezahlt" },
  DELIVERED: { bg: "#EEF2EE", fg: "#3F5A45", label: "Geliefert" },
  CASH_COLLECTED: { bg: "#EEF2EE", fg: "#3F5A45", label: "Bar kassiert" },
  CANCELLED: { bg: "#F1F1F2", fg: "#5F5F66", label: "Storniert" },
  REFUSED_AT_DOOR: { bg: "#FDECEA", fg: "#B42318", label: "Verweigert" },
};

export const STATUS_ORDER = Object.keys(STYLE) as OrderStatus[];
export const statusLabel = (s: OrderStatus) => STYLE[s].label;

export function StatusChip({ status, className }: { status: OrderStatus; className?: string }) {
  const s = STYLE[status];
  return (
    <span className={cn("t-caption inline-flex items-center rounded-[var(--radius-sm)] px-2 py-0.5", className)} style={{ backgroundColor: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}
