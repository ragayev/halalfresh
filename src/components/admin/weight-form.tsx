"use client";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { exceedsTolerance, finalizeOrder } from "@/domain/pricing";
import { formatMoney } from "@/domain/money";
import { weightsAction } from "@/app/(admin)/admin/actions";
import { cn } from "@/lib/utils";

export interface WeightLine {
  id: string;
  name: string;
  requestedGrams: number;
  unitPricePerKgCents: number;
  actualGrams: number | null;
}

/** One integer-grams input per line, live line totals, cap warning, sticky totals footer. */
export function WeightForm({
  orderId,
  lines,
  toleranceBps,
  estimatedTotalCents,
  maxTotalCents,
  deliveryFeeCents,
  correction,
}: {
  orderId: string;
  lines: WeightLine[];
  toleranceBps: number;
  estimatedTotalCents: number;
  maxTotalCents: number;
  deliveryFeeCents: number;
  correction: boolean;
}) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, l.actualGrams != null ? String(l.actualGrams) : ""])));
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const parsed = lines.map((l) => (/^\d+$/.test(vals[l.id] ?? "") ? Number(vals[l.id]) : null));
  const complete = parsed.every((g) => g !== null);
  const fin = useMemo(
    () =>
      finalizeOrder(
        lines.map((l, i) => ({ pricePerKgCents: l.unitPricePerKgCents, actualGrams: parsed[i] ?? 0 })),
        maxTotalCents - deliveryFeeCents,
        deliveryFeeCents,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vals],
  );

  const submit = () =>
    start(async () => {
      setErr(null);
      const r = await weightsAction(orderId, lines.map((l, i) => ({ itemId: l.id, actualGrams: parsed[i]! })));
      if (r.ok) setOk(true);
      else setErr(r.message ?? "Fehler");
    });

  return (
    <section id="gewichte" aria-labelledby="gw-h" className="space-y-3">
      <h2 id="gw-h" className="text-xl font-semibold">
        {correction ? "Gewichte korrigieren" : "Gewichte eingeben"}
      </h2>
      {correction && <Notice tone="warning">Nach dem Speichern wird der alte PayPal-Auftrag ungültig und der Kunde erhält den neuen Endbetrag.</Notice>}
      <ul className="space-y-2">
        {lines.map((l, i) => {
          const g = parsed[i];
          const over = g != null && exceedsTolerance(l.requestedGrams, g, toleranceBps);
          return (
            <li key={l.id} className={cn("rounded-[var(--radius-md)] border bg-surface p-3", over ? "border-warning border-2" : "border-border")}>
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={`g-${l.id}`} className="font-medium">
                  {l.name}
                </label>
                <span className="t-small text-text-muted tabular">bestellt {l.requestedGrams} g</span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <input
                  id={`g-${l.id}`}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={vals[l.id]}
                  onChange={(e) => setVals({ ...vals, [l.id]: e.target.value.replace(/\D/g, "") })}
                  className="t-price h-14 w-32 rounded-[var(--radius-md)] border border-border-strong bg-surface px-3 text-right"
                  aria-describedby={over ? `w-${l.id}` : undefined}
                />
                <span className="text-text-muted">g</span>
                <span className="t-price ml-auto">{g == null ? "–" : g === 0 ? "nicht verfügbar" : formatMoney(fin.lineFinals[i], "de")}</span>
              </div>
              {over && (
                <p id={`w-${l.id}`} className="t-small mt-2 flex items-center gap-2 text-warning">
                  <AlertTriangle className="size-4" aria-hidden /> Mehr als bestellt + {toleranceBps / 100} %
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {complete && fin.cappedAmountCents > 0 && (
        <Notice tone="danger">
          Gedeckelt: Der Kunde zahlt maximal {formatMoney(maxTotalCents, "de")}. {formatMoney(fin.cappedAmountCents, "de")} trägt der Verkäufer.
        </Notice>
      )}
      <div className="sticky bottom-16 z-10 space-y-2 rounded-[var(--radius-lg)] border border-border bg-surface p-3 shadow-lg lg:bottom-4">
        <dl className="t-small grid grid-cols-3 gap-2 tabular">
          <div>
            <dt className="text-text-muted">Geschätzt</dt>
            <dd className="font-semibold">{formatMoney(estimatedTotalCents, "de")}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Maximal</dt>
            <dd className="font-semibold">{formatMoney(maxTotalCents, "de")}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Endbetrag</dt>
            <dd className="t-price">{complete ? formatMoney(fin.finalTotalCents, "de") : "–"}</dd>
          </div>
        </dl>
        <Button full disabled={!complete} loading={pending} onClick={submit}>
          {correction ? "Korrektur speichern & Kunde informieren" : "Speichern & Kunde informieren"}
        </Button>
        {ok && <p role="status" className="t-small font-medium text-fresh">Gespeichert.</p>}
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </section>
  );
}
