import { normalizePostcode, POSTCODE_RE, type DeliveryCheck } from "@/domain/delivery";
import { nextDeliveryDate, type NextDelivery } from "@/domain/delivery-dates";
import { zoneForPostcode, type ZoneInfo } from "@/domain/delivery-zones";
import { BLACKOUT_DATES } from "@/config/delivery";

export type ResolvedDelivery = {
  check: DeliveryCheck;
  /** Internal routing info (tier, sector); never serialise this to the browser. Null for waitlist/unknown. */
  zone: ZoneInfo | null;
  delivery: NextDelivery | null;
};

const blackouts = new Set(BLACKOUT_DATES);

/** Single source of truth: postcode -> minimum + next delivery date. Used by the API, cart pricing and checkout. */
export function resolveDelivery(rawPostcode: string, now = new Date()): ResolvedDelivery {
  const postcode = normalizePostcode(rawPostcode);
  const none = (status: "waitlist" | "unknown"): ResolvedDelivery => ({
    check: { postcode, status, supported: false, minOrderCents: 0, deliveryFeeCents: 0, nextSlot: null },
    zone: null,
    delivery: null,
  });
  if (!POSTCODE_RE.test(postcode)) return none("unknown");
  const zone = zoneForPostcode(postcode);
  if (!zone) return none("unknown");
  if (zone.tier === "waitlist") return none("waitlist");

  const delivery = nextDeliveryDate({ weekdays: zone.weekdays, now, blackoutDates: blackouts });
  return {
    check: {
      postcode,
      status: "ok",
      supported: true,
      minOrderCents: zone.minOrderCents,
      deliveryFeeCents: 0,
      nextSlot: delivery
        ? {
            date: delivery.date,
            weekday: delivery.weekday,
            showTomorrow: delivery.isTomorrow && zone.tier === "core",
            cutoffAt: delivery.cutoffAt.toISOString(),
            slots: delivery.slots.map((s) => ({ ...s })),
          }
        : null,
    },
    zone,
    delivery,
  };
}

export function checkDelivery(postcode: string, now = new Date()): DeliveryCheck {
  return resolveDelivery(postcode, now).check;
}
