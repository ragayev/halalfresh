/**
 * Single place for delivery rules. Kevser Fleischerei fulfils and delivers every order.
 * Generated postcode data (distance + bearing from the shop) lives in src/data/delivery/;
 * tiers and sectors are derived from it with the values below, then manual overrides are applied.
 */

export const SHOP = { name: "Kevser Fleischerei", address: "Hermannstraße 64, 12049 Berlin", lat: 52.4757, lon: 13.4267 } as const;

export type Tier = "core" | "tier_100" | "tier_150" | "waitlist";
export type Sector = "west" | "north" | "northeast" | "southeast" | "southwest";

/** Upper distance bounds are inclusive ("up to 9 km"). Anything beyond the last bound is waitlist. */
export const TIERS: { tier: Exclude<Tier, "waitlist">; maxKm: number; minOrderCents: number }[] = [
  { tier: "core", maxKm: 9, minOrderCents: 60_00 },
  { tier: "tier_100", maxKm: 27, minOrderCents: 100_00 },
  { tier: "tier_150", maxKm: 42, minOrderCents: 150_00 },
];

/** Bearing ranges in degrees, from inclusive to exclusive. `to < from` wraps past 360 (north: 312 to 5). */
export const SECTORS: { sector: Sector; from: number; to: number; weekday: number }[] = [
  { sector: "west", from: 265, to: 312, weekday: 2 },
  { sector: "north", from: 312, to: 5, weekday: 3 },
  { sector: "northeast", from: 5, to: 80, weekday: 4 },
  { sector: "southeast", from: 80, to: 185, weekday: 1 },
  { sector: "southwest", from: 185, to: 265, weekday: 5 },
];

/** Core postcodes are delivered on every working day (ISO weekday, 1 = Monday). */
export const CORE_WEEKDAYS = [1, 2, 3, 4, 5, 6];

/** Order for delivery day D closes at this Berlin time on the working day before D. */
export const CUTOFF_TIME = "18:00";

export const SLOTS = [
  { start: "10:00", end: "14:00" },
  { start: "15:00", end: "19:00" },
] as const;

/** Days without delivery or cutoff (YYYY-MM-DD, Berlin) in addition to Berlin public holidays, e.g. shop holiday. */
export const BLACKOUT_DATES: string[] = [];

/** A weighed order may land this far below the minimum and is still accepted. */
export const MIN_ORDER_FINAL_TOLERANCE_BPS = 1000;

/** Distance/bearing within these margins of a boundary are listed as borderline in the report. */
export const BORDERLINE = { km: 1, degrees: 5 } as const;
