/**
 * Builds src/data/delivery/postcodes.generated.json from the GeoNames DE postal code dataset.
 * Source: https://download.geonames.org/export/zip/DE.zip (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/)
 * Keeps Berlin and Brandenburg. Postcodes with several rows get the average of their coordinates.
 * Distance (great circle, km) and bearing (degrees from north, 0..360) are measured from the shop.
 * The output is committed so the runtime never downloads anything.
 *
 * Usage: npx tsx scripts/generate-postcodes.ts [path/to/DE.txt]   (downloads DE.zip when no path is given)
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHOP } from "../src/config/delivery";
import { bearingDeg, distanceKm } from "../src/domain/geo";

const OUT = join(__dirname, "../src/data/delivery/postcodes.generated.json");
const STATES = new Set(["BE", "BB"]); // GeoNames admin code 1 (column 5)

function loadDump(path?: string): string {
  if (path) return readFileSync(path, "utf8");
  const dir = mkdtempSync(join(tmpdir(), "geonames-"));
  execFileSync("curl", ["-sSfL", "-o", join(dir, "DE.zip"), "https://download.geonames.org/export/zip/DE.zip"]);
  execFileSync("unzip", ["-o", "-q", join(dir, "DE.zip"), "DE.txt", "-d", dir]);
  return readFileSync(join(dir, "DE.txt"), "utf8");
}

const acc = new Map<string, { lat: number; lon: number; n: number; places: Set<string>; state: string }>();
for (const line of loadDump(process.argv[2]).split("\n")) {
  const c = line.split("\t");
  if (c.length < 11 || !STATES.has(c[4])) continue;
  const lat = Number(c[9]);
  const lon = Number(c[10]);
  if (!/^\d{5}$/.test(c[1]) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const a = acc.get(c[1]) ?? { lat: 0, lon: 0, n: 0, places: new Set<string>(), state: c[4] };
  a.lat += lat;
  a.lon += lon;
  a.n++;
  a.places.add(c[2]);
  acc.set(c[1], a);
}

const round = (v: number, d: number) => Number(v.toFixed(d));
const entries = [...acc.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([postcode, a]) => {
    const lat = a.lat / a.n;
    const lon = a.lon / a.n;
    const places = [...a.places].sort();
    // GeoNames lists companies and offices as "places" for Berlin postcodes; the city name is the useful label there.
    const place = a.state === "BE" ? "Berlin" : places.length > 3 ? `${places.slice(0, 3).join(", ")} u. a.` : places.join(", ");
    return {
      postcode,
      state: a.state,
      place,
      lat: round(lat, 5),
      lon: round(lon, 5),
      distanceKm: round(distanceKm(SHOP.lat, SHOP.lon, lat, lon), 3),
      bearingDeg: round(bearingDeg(SHOP.lat, SHOP.lon, lat, lon), 2),
    };
  });

writeFileSync(
  OUT,
  JSON.stringify(
    {
      attribution: "Contains data from GeoNames (https://www.geonames.org), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).",
      source: "https://download.geonames.org/export/zip/DE.zip",
      shop: { lat: SHOP.lat, lon: SHOP.lon },
      count: entries.length,
      postcodes: entries,
    },
    null,
    1,
  ) + "\n",
);
console.log(`${entries.length} postcodes -> ${OUT}`);
