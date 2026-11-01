/**
 * Builds prisma/data/postcodes.verified.json from OpenPLZ API (https://openplzapi.org, built on official
 * German postal-code data). Every postcode in the requested ranges is checked: it must exist AND belong to
 * the expected locality/state. Anything that cannot be verified is written to `unverified` — never guessed.
 *
 * Usage: npx tsx scripts/verify-postcodes.ts
 */
import { writeFileSync } from "node:fs";

const API = "https://openplzapi.org/de";
interface Loc {
  postalCode: string;
  name: string;
  federalState: { key: string; name: string };
}

async function get<T>(path: string): Promise<T> {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${API}${path}`);
    if (r.ok) return (await r.json()) as T;
    if (r.status === 404) return [] as T;
    await new Promise((res) => setTimeout(res, 500 * (i + 1)));
  }
  throw new Error(`OpenPLZ request failed: ${path}`);
}

function range(from: string, to: string): string[] {
  const out: string[] = [];
  for (let n = Number(from); n <= Number(to); n++) out.push(String(n).padStart(5, "0"));
  return out;
}

async function allBerlin(): Promise<Loc[]> {
  const out: Loc[] = [];
  for (let page = 1; ; page++) {
    const rows = await get<Loc[]>(`/FederalStates/11/Localities?page=${page}&pageSize=50`);
    out.push(...rows);
    if (rows.length < 50) return out;
  }
}

// TODO confirm with Kevser: city/postcode lists below are the placeholder brief, not a confirmed delivery area.
const CITY_RANGES: { zone: 2 | 3; route: string; city: string; match: RegExp; state: string; ranges: [string, string][] }[] = [
  { zone: 2, route: "West", city: "Potsdam", match: /^Potsdam/, state: "12", ranges: [["14467", "14482"]] },
  { zone: 2, route: "West", city: "Falkensee", match: /^Falkensee/, state: "12", ranges: [["14612", "14612"]] },
  { zone: 2, route: "West", city: "Dallgow-Döberitz", match: /^Dallgow/, state: "12", ranges: [["14624", "14624"]] },
  { zone: 2, route: "West", city: "Teltow", match: /^Teltow/, state: "12", ranges: [["14513", "14513"]] },
  { zone: 2, route: "North/East", city: "Oranienburg", match: /^Oranienburg/, state: "12", ranges: [["16515", "16515"]] },
  { zone: 2, route: "North/East", city: "Bernau", match: /^Bernau/, state: "12", ranges: [["16321", "16321"]] },
  { zone: 2, route: "North/East", city: "Strausberg", match: /^Strausberg/, state: "12", ranges: [["15344", "15344"]] },
  { zone: 2, route: "North/East", city: "Königs Wusterhausen", match: /^K.nigs Wusterhausen/, state: "12", ranges: [["15711", "15711"]] },
  { zone: 3, route: "Far Brandenburg", city: "Brandenburg an der Havel", match: /^Brandenburg/, state: "12", ranges: [["14770", "14776"]] },
  { zone: 3, route: "Far Brandenburg", city: "Eberswalde", match: /^Eberswalde/, state: "12", ranges: [["16225", "16227"]] },
  { zone: 3, route: "Far Brandenburg", city: "Frankfurt (Oder)", match: /^Frankfurt/, state: "12", ranges: [["15230", "15236"]] },
  { zone: 3, route: "Far Brandenburg", city: "Cottbus", match: /^Cottbus/, state: "12", ranges: [["03042", "03055"]] },
];

async function main() {
  const berlin = await allBerlin();
  const berlinInRange = [...new Set(berlin.map((l) => l.postalCode))].filter((p) => p >= "10115" && p <= "14199").sort();
  const berlinOutOfRange = [...new Set(berlin.map((l) => l.postalCode))].filter((p) => p < "10115" || p > "14199").sort();
  const nonBerlinInRange = range("10115", "14199").length - berlinInRange.length;

  const verified: { zone: 2 | 3; route: string; city: string; postcode: string; locality: string }[] = [];
  const unverified: { zone: number; city: string; postcode: string; reason: string }[] = [];
  for (const c of CITY_RANGES) {
    for (const [a, b] of c.ranges) {
      for (const pc of range(a, b)) {
        const rows = await get<Loc[]>(`/Localities?postalCode=${pc}`);
        const hit = rows.find((r) => c.match.test(r.name) && r.federalState.key === c.state);
        if (hit) verified.push({ zone: c.zone, route: c.route, city: c.city, postcode: pc, locality: hit.name });
        else
          unverified.push({
            zone: c.zone,
            city: c.city,
            postcode: pc,
            reason: rows.length ? `belongs to ${rows.map((r) => `${r.name} (${r.federalState.name})`).join(", ")}` : "not found in OpenPLZ",
          });
      }
    }
  }

  const out = {
    source: "OpenPLZ API https://openplzapi.org/de (official German postal code data)",
    generatedAt: new Date().toISOString(),
    berlin: berlinInRange,
    berlinOutsideRequestedRange: berlinOutOfRange,
    verified,
    unverified,
  };
  writeFileSync("prisma/data/postcodes.verified.json", JSON.stringify(out, null, 2) + "\n");
  console.log(
    `Berlin postcodes in 10115–14199: ${berlinInRange.length} (skipped ${nonBerlinInRange} non-Berlin codes in that numeric range)`,
  );
  console.log(`Berlin postcodes outside range: ${berlinOutOfRange.join(", ") || "none"}`);
  console.log(`Verified Zone 2/3: ${verified.length}`);
  console.log(`UNVERIFIED (${unverified.length}):`);
  for (const u of unverified) console.log(`  Zone ${u.zone} ${u.city} ${u.postcode}: ${u.reason}`);
}
main();
