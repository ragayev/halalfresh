/**
 * Prints postcode counts per zone and borderline postcodes (within 1 km of a tier boundary or 5 degrees of a sector boundary).
 * Usage: npx tsx scripts/delivery-report.ts
 */
import { BORDERLINE, SECTORS, TIERS } from "../src/config/delivery";
import { allZones } from "../src/domain/delivery-zones";

const zones = allZones();
const counts = new Map<string, number>();
for (const z of zones) {
  const k = z.sector ? `${z.tier}/${z.sector}` : z.tier;
  counts.set(k, (counts.get(k) ?? 0) + 1);
}
console.log("Postcodes per zone (total " + zones.length + "):");
for (const [k, n] of [...counts].sort()) console.log(`  ${k.padEnd(22)} ${n}`);

const tierEdges = TIERS.map((t) => t.maxKm);
const sectorEdges = SECTORS.map((s) => s.from);
const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
console.log("\nBorderline postcodes:");
for (const z of zones) {
  const notes: string[] = [];
  for (const e of tierEdges) if (Math.abs(z.distanceKm - e) <= BORDERLINE.km) notes.push(`${(z.distanceKm - e >= 0 ? "+" : "") + (z.distanceKm - e).toFixed(2)} km vs ${e} km`);
  // Sector edges only matter where a tour applies (outside core, inside the service area).
  if (z.tier !== "core" && z.tier !== "waitlist")
    for (const e of sectorEdges) if (angDiff(z.bearingDeg, e) <= BORDERLINE.degrees) notes.push(`${angDiff(z.bearingDeg, e).toFixed(1)}° from ${e}°`);
  if (notes.length)
    console.log(`  ${z.postcode} ${z.place.padEnd(34)} ${z.tier}${z.sector ? "/" + z.sector : ""}  ${z.distanceKm.toFixed(2)} km ${z.bearingDeg.toFixed(1)}°  [${notes.join("; ")}]`);
}
