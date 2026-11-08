import type { Sector, Tier } from "@/config/delivery";

export interface PostcodeOverride {
  /** Replaces the tier derived from distance. */
  tier?: Tier;
  /** Replaces the sector derived from bearing (ignored for core and waitlist). */
  sector?: Sector;
  /** needs_review: the generated values are used, but orders for this postcode are flagged for a manual check. */
  status?: "needs_review";
  note?: string;
}

/** Manual corrections. Anything set here wins over the generated data in postcodes.generated.json. */
export const OVERRIDES: Record<string, PostcodeOverride> = {
  "14089": { status: "needs_review", note: "Kladow/Gatow: Anfahrt über die Havel, Zone und Liefertag mit Kevser klären." },
};
