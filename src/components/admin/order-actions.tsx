"use client";
import { useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";
import type { OrderStatus, PaymentMethod } from "@prisma/client";
import { Button, Notice, Textarea } from "@/components/ui";
import { kevserWhatsappAction, resendNotificationAction, saveNoteAction, transitionAction, type ActionResult } from "@/app/(admin)/admin/actions";

interface Next {
  to: OrderStatus;
  label: string;
  primary?: boolean;
  /** Destructive: needs a confirmation sheet with a reason. */
  confirm?: boolean;
}

export function nextActions(status: OrderStatus, method: PaymentMethod): Next[] {
  const cash = method === "CASH";
  const cancel: Next = { to: "CANCELLED", label: "Stornieren", confirm: true };
  switch (status) {
    case "NEW":
      return [{ to: "ACCEPTED", label: "Annehmen", primary: true }, cancel];
    case "ACCEPTED":
      return [{ to: "PREPARING", label: "In Vorbereitung", primary: true }, cancel];
    case "PREPARING":
      return [cancel]; // primary action is the weight form
    case "WEIGHED":
      return cash ? [{ to: "OUT_FOR_DELIVERY", label: "Unterwegs", primary: true }, cancel] : [{ to: "PAYMENT_OVERDUE", label: "Als überfällig markieren + erinnern" }, cancel];
    case "PAYMENT_OVERDUE":
      return [cancel];
    case "PAID":
      return [{ to: "OUT_FOR_DELIVERY", label: "Unterwegs", primary: true }, cancel];
    case "OUT_FOR_DELIVERY":
      return [
        cash ? { to: "DELIVERED_UNPAID", label: "Geliefert (Bargeld offen)", primary: true } : { to: "DELIVERED", label: "Geliefert", primary: true },
        { to: "REFUSED_AT_DOOR", label: "An der Tür verweigert", confirm: true },
        cancel,
      ];
    case "DELIVERED_UNPAID":
      return [{ to: "CASH_COLLECTED", label: "Bar kassiert", primary: true }, cancel];
    default:
      return [];
  }
}

export function OrderActions({ orderId, status, method, scrollToWeights }: { orderId: string; status: OrderStatus; method: PaymentMethod; scrollToWeights: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [confirming, setConfirming] = useState<Next | null>(null);
  const [reason, setReason] = useState("");
  const actions = nextActions(status, method);

  const run = (to: OrderStatus, why?: string) =>
    start(async () => {
      const r = await transitionAction(orderId, to, why);
      setMsg(r.ok ? null : r);
      if (r.ok) {
        setConfirming(null);
        setReason("");
      }
    });

  return (
    <div className="space-y-3">
      {scrollToWeights && (
        <a href="#gewichte" className="inline-flex h-12 w-full items-center justify-center rounded-[var(--radius-md)] bg-primary font-semibold text-text-inverse hover:bg-primary-hover">
          Gewichte eingeben
        </a>
      )}
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={a.to + a.label}
            variant={a.primary ? "primary" : a.confirm ? "secondary" : "secondary"}
            className={a.primary ? "w-full sm:w-auto" : a.confirm ? "text-danger" : ""}
            loading={pending && !a.confirm}
            onClick={() => (a.confirm ? setConfirming(a) : run(a.to))}
          >
            {a.label}
          </Button>
        ))}
      </div>
      {confirming && (
        <div role="dialog" aria-label={confirming.label} className="space-y-3 rounded-[var(--radius-lg)] border border-danger bg-surface p-4 shadow-lg">
          <p className="font-semibold">{confirming.label} — bitte Grund angeben</p>
          <label className="block text-sm">
            Grund (Pflicht)
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <Button variant="danger" loading={pending} disabled={!reason.trim()} onClick={() => run(confirming.to, reason)}>
              {confirming.label}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(null)}>
              Zurück
            </Button>
          </div>
        </div>
      )}
      {msg && !msg.ok && <Notice tone="danger">{msg.message}</Notice>}
    </div>
  );
}

export function WhatsappButtons({ orderId, customerPhone }: { orderId: string; customerPhone: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await kevserWhatsappAction(orderId);
              if (r.ok && r.url) window.open(r.url, "_blank", "noopener");
              else setErr(r.message ?? "Fehler");
            })
          }
        >
          <MessageCircle className="size-5" strokeWidth={1.75} aria-hidden /> An Kevser senden
        </Button>
        <a
          href={`https://wa.me/${customerPhone.replace(/\D/g, "")}`}
          target="_blank"
          rel="noopener"
          className="inline-flex h-12 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-border-strong bg-surface px-5 font-semibold lg:h-11"
        >
          <MessageCircle className="size-5" strokeWidth={1.75} aria-hidden /> Kunde anschreiben
        </a>
      </div>
      {err && <Notice tone="danger">{err}</Notice>}
    </div>
  );
}

export function ResendButton({ orderId, template }: { orderId: string; template: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await resendNotificationAction(orderId, template);
          setDone(r.ok);
        })
      }
    >
      {done ? "Gesendet ✓" : "Benachrichtigung erneut senden"}
    </Button>
  );
}

export function NoteForm({ orderId, initial }: { orderId: string; initial: string }) {
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">
        Interne Notiz
        <Textarea value={v} onChange={(e) => (setV(e.target.value), setSaved(false))} />
      </label>
      <Button variant="secondary" size="sm" loading={pending} onClick={() => start(async () => setSaved((await saveNoteAction(orderId, v)).ok))}>
        {saved ? "Gespeichert ✓" : "Notiz speichern"}
      </Button>
    </div>
  );
}
