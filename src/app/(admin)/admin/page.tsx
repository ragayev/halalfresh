import { requireAdmin } from "@/server/auth";
import { computeMetrics } from "@/server/metrics";
import { formatMoney } from "@/domain/money";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

const num = (v: number | null, suffix = "") => (v == null ? "–" : `${v.toLocaleString("de-DE")}${suffix}`);

export default async function Metrics() {
  await requireAdmin();
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const m = await computeMetrics(since);
  const tiles: [string, string][] = [
    ["Bestellungen (90 Tage)", String(m.orders)],
    ["Ø geschätzt", m.avgEstimatedCents == null ? "–" : formatMoney(m.avgEstimatedCents, "de")],
    ["Ø Endbetrag", m.avgFinalCents == null ? "–" : formatMoney(m.avgFinalCents, "de")],
    ["Gedeckelt", num(m.cappedPct, " %")],
    ["Neu → Angenommen", num(m.avgMinutesNewToAccepted, " min")],
    ["Vorbereitung → Gewogen", num(m.avgMinutesPreparingToWeighed, " min")],
    ["Stornoquote", num(m.cancellationPct, " %")],
    ["Verweigerungsquote", num(m.refusedPct, " %")],
    ["Zahlung überfällig", num(m.overduePct, " %")],
    ["Stammkunden", num(m.repeatCustomerPct, " %")],
  ];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Kennzahlen</h1>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tiles.map(([k, v]) => (
          <Card key={k} className="p-4">
            <dt className="t-small text-text-muted">{k}</dt>
            <dd className="t-price-lg tabular">{v}</dd>
          </Card>
        ))}
      </dl>
      <Card className="p-4">
        <h2 className="mb-2 text-lg font-semibold">Bestellungen pro Woche</h2>
        <ul className="t-small tabular space-y-1">
          {m.perWeek.map((w) => (
            <li key={w.week}>{w.week}: <strong>{w.count}</strong></li>
          ))}
          {m.perWeek.length === 0 && <li className="text-text-muted">Noch keine Daten.</li>}
        </ul>
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 text-lg font-semibold">Ø Abweichung Gewicht je Produkt</h2>
        <ul className="t-small tabular space-y-1">
          {m.perProductDeviation.map((p) => (
            <li key={p.product}>{p.product}: <strong>{p.avgDeviationPct > 0 ? "+" : ""}{p.avgDeviationPct} %</strong> ({p.lines} Positionen)</li>
          ))}
          {m.perProductDeviation.length === 0 && <li className="text-text-muted">Noch keine Daten.</li>}
        </ul>
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 text-lg font-semibold">Bestellungen pro Tag</h2>
        <ul className="t-small tabular grid gap-1 sm:grid-cols-2">
          {m.perDay.slice(-14).map((d) => (
            <li key={d.day}>{d.day}: <strong>{d.count}</strong></li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
