import type { Sector, Tier } from "@/config/delivery";

/**
 * Manual correction for one postcode. Every field is optional; whatever is set wins over the value calculated
 * from distance and bearing (postcodes.generated.json + src/config/delivery.ts).
 */
export interface PostcodeOverride {
  /** Delivery zone, instead of the one derived from distance. */
  tier?: Tier;
  /** Sector (and with it the delivery weekday), instead of the one derived from bearing. Ignored for core and waitlist. */
  sector?: Sector;
  /** Minimum order value in cents, e.g. 120_00. */
  minOrderCents?: number;
  /** Delivery weekdays (ISO, 1 = Monday ... 6 = Saturday), instead of the zone's. */
  weekdays?: number[];
  /** true = no delivery to this postcode (customers see the waitlist form). */
  unavailable?: boolean;
  /**
   * needs_review: customers see that delivery must be confirmed first (no promise), and orders are flagged for Kevser.
   * Normal minimum, weekday and unavailable rules still apply.
   */
  status?: "needs_review";
  /** Why this entry exists. */
  note?: string;
}

/**
 * Add a line here when straight-line distance is misleading (river, lake, bridge, no direct road).
 * Example: "12345": { tier: "tier_150", note: "Nur über die Brücke erreichbar" }
 */
export const OVERRIDES: Record<string, PostcodeOverride> = {
  "14089": { status: "needs_review", note: "Kladow/Gatow: Anfahrt über die Havel, Zone und Liefertag mit Kevser klären." },
};
