import { normalizePostcode, POSTCODE_RE, type DeliveryCheck } from "@/domain/delivery";
import { eligibleDeliveryDates, type NextDelivery } from "@/domain/delivery-dates";
import { zoneForPostcode, type ZoneInfo } from "@/domain/delivery-zones";
import { BLACKOUT_DATES, SLOTS } from "@/config/delivery";

export type ResolvedDelivery = {
  check: DeliveryCheck;
  /** Internal routing info (tier, sector); never serialise this to the browser. Null for waitlist/unknown. */
  zone: ZoneInfo | null;
  /** Orderable dates, earliest first. */
  dates: NextDelivery[];
};

const blackouts = new Set(BLACKOUT_DATES);
const DATE_OPTIONS = 6;

/** Single source of truth: postcode -> minimum + orderable delivery dates. Used by the API, cart pricing and checkout. */
export function resolveDelivery(rawPostcode: string, now = new Date()): ResolvedDelivery {
  const postcode = normalizePostcode(rawPostcode);
  const none = (status: "waitlist" | "unknown"): ResolvedDelivery => ({
    check: { postcode, status, supported: false, minOrderCents: 0, weekdays: [], deliveryFeeCents: 0, dates: [], nextSlot: null },
    zone: null,
    dates: [],
  });
  if (!POSTCODE_RE.test(postcode)) return none("unknown");
  const zone = zoneForPostcode(postcode);
  if (!zone) return none("unknown");
  if (zone.tier === "waitlist") return none("waitlist");

  // Server-side validation uses every eligible date; the browser only gets the first few.
  const dates = eligibleDeliveryDates({ weekdays: zone.weekdays, now, blackoutDates: blackouts });
  const first = dates[0];
  return {
    check: {
      postcode,
      status: zone.needsReview ? "review" : "ok",
      supported: true,
      minOrderCents: zone.minOrderCents,
      weekdays: zone.weekdays,
      deliveryFeeCents: 0,
      dates: dates.slice(0, DATE_OPTIONS).map((d) => ({ date: d.date, showTomorrow: d.isTomorrow && zone.tier === "core", cutoffAt: d.cutoffAt.toISOString() })),
      nextSlot: first
        ? {
            date: first.date,
            weekday: first.weekday,
            showTomorrow: first.isTomorrow && zone.tier === "core",
            cutoffAt: first.cutoffAt.toISOString(),
            slots: SLOTS.map((s) => ({ ...s })),
          }
        : null,
    },
    zone,
    dates,
  };
}

export function checkDelivery(postcode: string, now = new Date()): DeliveryCheck {
  return resolveDelivery(postcode, now).check;
}
