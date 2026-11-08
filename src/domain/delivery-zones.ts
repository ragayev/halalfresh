import { CORE_WEEKDAYS, SECTORS, TIERS, type Sector, type Tier } from "@/config/delivery";
import generated from "@/data/delivery/postcodes.generated.json";
import { OVERRIDES, type PostcodeOverride } from "@/data/delivery/overrides";
import { normalizePostcode, POSTCODE_RE } from "./delivery";

export interface GeneratedPostcode {
  postcode: string;
  state: string;
  place: string;
  lat: number;
  lon: number;
  distanceKm: number;
  bearingDeg: number;
}

/** Internal view of a postcode. Tier and sector are for admin and routing only and are never shown to customers. */
export interface ZoneInfo {
  postcode: string;
  place: string;
  tier: Tier;
  sector: Sector | null;
  minOrderCents: number;
  /** ISO weekdays on which this postcode is delivered; empty for waitlist. */
  weekdays: number[];
  distanceKm: number;
  bearingDeg: number;
  needsReview: boolean;
  overridden: boolean;
}

export const POSTCODE_DATA = generated.postcodes as GeneratedPostcode[];
const BY_POSTCODE = new Map(POSTCODE_DATA.map((p) => [p.postcode, p]));
export const POSTCODE_ATTRIBUTION = generated.attribution;

export function tierForDistance(km: number): Tier {
  for (const t of TIERS) if (km <= t.maxKm) return t.tier;
  return "waitlist";
}

/** Lower bound inclusive, upper bound exclusive; a range whose end is below its start wraps past 360. */
export function sectorForBearing(deg: number): Sector {
  const b = ((deg % 360) + 360) % 360;
  for (const s of SECTORS) {
    const inside = s.from < s.to ? b >= s.from && b < s.to : b >= s.from || b < s.to;
    if (inside) return s.sector;
  }
  throw new Error(`No sector for bearing ${deg}`); // the configured ranges must cover the full circle
}

export function classify(row: GeneratedPostcode, override: PostcodeOverride | undefined = OVERRIDES[row.postcode]): ZoneInfo {
  const tier = override?.tier ?? tierForDistance(row.distanceKm);
  let sector: Sector | null = null;
  let weekdays: number[] = [];
  if (tier === "core") weekdays = CORE_WEEKDAYS;
  else if (tier !== "waitlist") {
    sector = override?.sector ?? sectorForBearing(row.bearingDeg);
    weekdays = [SECTORS.find((s) => s.sector === sector)!.weekday];
  }
  return {
    postcode: row.postcode,
    place: row.place,
    tier,
    sector,
    minOrderCents: TIERS.find((t) => t.tier === tier)?.minOrderCents ?? 0,
    weekdays,
    distanceKm: row.distanceKm,
    bearingDeg: row.bearingDeg,
    needsReview: override?.status === "needs_review",
    overridden: !!override,
  };
}

/** null = postcode is not in the data (treated like waitlist by the customer flow). */
export function zoneForPostcode(raw: string): ZoneInfo | null {
  const pc = normalizePostcode(raw);
  if (!POSTCODE_RE.test(pc)) return null;
  const row = BY_POSTCODE.get(pc);
  return row ? classify(row) : null;
}

export function allZones(): ZoneInfo[] {
  return POSTCODE_DATA.map((r) => classify(r));
}
