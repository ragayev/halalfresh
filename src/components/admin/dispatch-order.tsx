"use client";
import { useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { setReportedFinalAction } from "@/app/(admin)/admin/dispatch-actions";

export function CopyMessage({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      setDone(false);
    }
  }
  return (
    <Button type="button" variant="secondary" size="sm" onClick={copy}>
      {done ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {done ? "Kopiert" : "WhatsApp-Text kopieren"}
    </Button>
  );
}

export function ReportedFinalForm({ orderId, initial }: { orderId: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setMsg((await setReportedFinalAction(orderId, value)).message ?? ""));
      }}
    >
      <label className="text-sm">
        Gewogener Endbetrag (€)
        <Input name="final" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="w-32" />
      </label>
      <Button type="submit" size="sm" loading={pending}>
        Speichern
      </Button>
      {msg && <span role="status" className="text-sm text-text-muted">{msg}</span>}
    </form>
  );
}
