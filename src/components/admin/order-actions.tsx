"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MessageCircle, AlertTriangle } from "lucide-react";
import { Button, Textarea } from "@/components/ui";
import { RunButton, Msg } from "./forms";
import {
  cancelAction,
  refundAction,
  saveNoteAction,
  setFulfillmentAction,
  whatsappAction,
  type ActionResult,
} from "@/app/(admin)/admin/actions";

export function WhatsappPanel({
  orderId,
  openCount,
  forwardedAt,
  canForward,
  message,
}: {
  orderId: string;
  openCount: number;
  forwardedAt: string | null;
  canForward: boolean;
  message: string;
}) {
  const router = useRouter();
  const [showMsg, setShowMsg] = useState(false);
  return (
    <div className="space-y-3">
      {forwardedAt && (
        <p className="flex items-center gap-2 rounded-xl bg-sage p-3 text-sm font-medium text-forest-dark">
          <AlertTriangle className="size-4" aria-hidden />
          Already marked as forwarded on {forwardedAt}. Check WhatsApp before sending again.
        </p>
      )}
      {!forwardedAt && openCount > 0 && (
        <p className="rounded-xl bg-warn p-3 text-sm font-medium text-warn-ink">
          WhatsApp was opened {openCount}× but not marked as forwarded yet.
        </p>
      )}
      <div className="flex flex-wrap items-start gap-2">
        <RunButton
          variant="primary"
          size="lg"
          disabled={!canForward}
          data-testid="send-whatsapp"
          run={async () => whatsappAction(orderId)}
          onDone={(r) => {
            if (r.ok && r.url) {
              window.open(r.url, "_blank", "noopener");
              router.refresh();
            }
          }}
        >
          <MessageCircle className="size-5" aria-hidden />
          Send to Butcher via WhatsApp
        </RunButton>
        {canForward && !forwardedAt && (
          <RunButton
            variant="secondary"
            size="lg"
            data-testid="mark-forwarded"
            confirm="Confirm you actually sent the WhatsApp message?"
            run={() => setFulfillmentAction(orderId, "FORWARDED")}
            onDone={() => router.refresh()}
          >
            Mark as forwarded
          </RunButton>
        )}
      </div>
      <button type="button" className="text-sm font-medium text-forest hover:underline" onClick={() => setShowMsg((s) => !s)}>
        {showMsg ? "Hide" : "Preview"} message
      </button>
      {showMsg && <pre className="whitespace-pre-wrap rounded-xl bg-neutral-50 p-4 text-sm ring-1 ring-line">{message}</pre>}
    </div>
  );
}

export function StatusButtons({ orderId, options }: { orderId: string; options: { value: string; label: string }[] }) {
  const router = useRouter();
  if (!options.length) return <p className="text-sm text-muted">No further status changes.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <RunButton
          key={o.value}
          variant={o.value === "CANCELLED" ? "danger" : "secondary"}
          data-testid={`status-${o.value}`}
          confirm={o.value === "CANCELLED" ? "Cancel this order? Paid orders are refunded in full." : undefined}
          run={() => (o.value === "CANCELLED" ? cancelAction(orderId) : setFulfillmentAction(orderId, o.value))}
          onDone={(r) => r.ok && router.refresh()}
        >
          {o.label}
        </RunButton>
      ))}
    </div>
  );
}

export function NoteForm({ orderId, initial }: { orderId: string; initial: string }) {
  const [v, setV] = useState(initial);
  const [r, setR] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <Textarea value={v} onChange={(e) => setV(e.target.value)} aria-label="Internal notes" maxLength={4000} />
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setR(await saveNoteAction(orderId, v));
            setBusy(false);
          }}
        >
          Save note
        </Button>
        <Msg r={r} />
      </div>
    </div>
  );
}

export function RefundForm({ orderId, remainingCents }: { orderId: string; remainingCents: number }) {
  const router = useRouter();
  const [amt, setAmt] = useState((remainingCents / 100).toFixed(2));
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        Amount (€)
        <input
          value={amt}
          onChange={(e) => setAmt(e.target.value)}
          inputMode="decimal"
          className="mt-1 block h-11 w-32 rounded-xl border border-line px-3"
        />
      </label>
      <RunButton
        variant="danger"
        confirm="Issue this refund? This cannot be undone."
        data-testid="refund-btn"
        run={() => refundAction(orderId, Math.round(parseFloat(amt.replace(",", ".")) * 100))}
        onDone={(r) => r.ok && router.refresh()}
      >
        Refund
      </RunButton>
    </div>
  );
}
