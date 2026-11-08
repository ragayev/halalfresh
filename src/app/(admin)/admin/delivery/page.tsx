import { requireAdmin } from "@/server/auth";
import { BLACKOUT_DATES, CORE_WEEKDAYS, CUTOFF_TIME, MIN_ORDER_FINAL_TOLERANCE_BPS, SECTORS, SHOP, SLOTS, TIERS } from "@/config/delivery";
import { allZones, POSTCODE_ATTRIBUTION } from "@/domain/delivery-zones";
import { SECTOR_LABEL } from "@/domain/dispatch";
import { formatMoney } from "@/domain/money";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";
const DAYS = ["", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

/** Read-only: delivery rules live in src/config/delivery.ts and src/data/delivery/. */
export default async function DeliveryOverview() {
  await requireAdmin();
  const zones = allZones();
  const review = zones.filter((z) => z.needsReview);
  const count = (f: (z: (typeof zones)[number]) => boolean) => zones.filter(f).length;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Lieferung</h1>
      <Card className="space-y-2 p-4">
        <p>
          Ausgang: {SHOP.name}, {SHOP.address}. Bestellschluss {CUTOFF_TIME} Uhr am Werktag vor der Lieferung. Zeitfenster: {SLOTS.map((s) => `${s.start}–${s.end}`).join(", ")}.
        </p>
        <p className="t-small text-text-muted">
          Regeln ändern: <code>src/config/delivery.ts</code>. Manuelle Korrekturen: <code>src/data/delivery/overrides.ts</code>. Gesperrte Tage: {BLACKOUT_DATES.length ? BLACKOUT_DATES.join(", ") : "keine"}. Nach Wiegen
          wird eine Bestellung bis {MIN_ORDER_FINAL_TOLERANCE_BPS / 100} % unter dem Mindestwert akzeptiert.
        </p>
      </Card>
      <Card className="p-4">
        <table className="tabular w-full text-sm">
          <thead className="text-left text-text-muted">
            <tr>
              <th className="py-1 font-medium">Gruppe</th>
              <th className="py-1 font-medium">Liefertag</th>
              <th className="py-1 text-right font-medium">Mindestwert</th>
              <th className="py-1 text-right font-medium">PLZ</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <td className="py-1">Kern (bis {TIERS[0].maxKm} km)</td>
              <td>{CORE_WEEKDAYS.map((d) => DAYS[d].slice(0, 2)).join(", ")}</td>
              <td className="text-right">{formatMoney(TIERS[0].minOrderCents, "de")}</td>
              <td className="text-right">{count((z) => z.tier === "core")}</td>
            </tr>
            {TIERS.slice(1).flatMap((t) =>
              SECTORS.map((s) => (
                <tr key={`${t.tier}-${s.sector}`} className="border-t border-border">
                  <td className="py-1">
                    bis {t.maxKm} km · {SECTOR_LABEL[s.sector]}
                  </td>
                  <td>{DAYS[s.weekday]}</td>
                  <td className="text-right">{formatMoney(t.minOrderCents, "de")}</td>
                  <td className="text-right">{count((z) => z.tier === t.tier && z.sector === s.sector)}</td>
                </tr>
              )),
            )}
            <tr className="border-t border-border">
              <td className="py-1">Warteliste</td>
              <td>–</td>
              <td className="text-right">–</td>
              <td className="text-right">{count((z) => z.tier === "waitlist")}</td>
            </tr>
          </tbody>
        </table>
      </Card>
      {review.length > 0 && (
        <Card className="p-4">
          <h2 className="font-semibold">Zu prüfen</h2>
          <ul className="t-small">
            {review.map((z) => (
              <li key={z.postcode}>
                {z.postcode} {z.place} · {z.distanceKm.toFixed(1)} km · {z.bearingDeg.toFixed(0)}° · {z.tier}
                {z.sector ? `/${z.sector}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="t-small text-text-muted">{POSTCODE_ATTRIBUTION}</p>
    </div>
  );
}
