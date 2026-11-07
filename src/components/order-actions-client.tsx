"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, Notice } from "./ui";
import type { MvpCopy } from "@/content/mvp-copy";

async function post(url: string, body?: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, json: await r.json().catch(() => ({})) };
}

/**
 * Redirect flow: no PayPal script runs on this page. "Pay" creates (or reuses) the PayPal order for the final
 * amount and sends the customer to PayPal; on return we capture server-side.
 */
export function PayButton({ token, c, returnedOrderId }: { token: string; c: MvpCopy; returnedOrderId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(!!returnedOrderId);
  const [err, setErr] = useState<string | null>(null);
  const captured = useRef(false);

  useEffect(() => {
    if (!returnedOrderId || captured.current) return;
    captured.current = true;
    post(`/api/b/${token}/capture`, { orderId: returnedOrderId }).then((r) => {
      if (!r.ok) setErr(r.json?.error?.message ?? "Fehler");
      setBusy(false);
      router.replace(window.location.pathname); // drop PayPal's query params, show the new state
      router.refresh();
    });
  }, [returnedOrderId, token, router]);

  async function start() {
    setBusy(true);
    setErr(null);
    const r = await post(`/api/b/${token}/pay`);
    if (!r.ok || !r.json.approveUrl) {
      setErr(r.json?.error?.message ?? "Fehler");
      setBusy(false);
      return;
    }
    window.location.assign(r.json.approveUrl);
  }

  return (
    <div className="space-y-2">
      <Button size="lg" full loading={busy} onClick={start} data-testid="pay-paypal">
        {returnedOrderId && busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {c.payWithPaypal}
      </Button>
      {err && <Notice tone="danger">{err}</Notice>}
    </div>
  );
}

export function CancelButton({ token, c }: { token: string; c: MvpCopy }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open)
    return (
      <Button variant="secondary" className="text-danger" onClick={() => setOpen(true)} data-testid="cancel-order">
        {c.cancel}
      </Button>
    );
  return (
    <div role="dialog" aria-label={c.cancel} className="space-y-3 rounded-[var(--radius-lg)] border border-danger bg-surface p-4">
      <p className="font-semibold">{c.cancelConfirm}</p>
      <div className="flex gap-2">
        <Button
          variant="danger"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            const r = await post(`/api/b/${token}/cancel`);
            if (!r.ok) setErr(r.json?.error?.message ?? "Fehler");
            setBusy(false);
            if (r.ok) router.refresh();
          }}
        >
          {c.cancelYes}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          {c.back}
        </Button>
      </div>
      {err && <Notice tone="danger">{err}</Notice>}
    </div>
  );
}
