import { db } from "@/lib/db";
import { nextDeliverySlot, normalizePostcode, POSTCODE_RE, type DeliveryCheck, type DeliverySlot } from "@/domain/delivery";
import { getMerchant } from "./settings";

export type ResolvedDelivery = {
  check: DeliveryCheck;
  /** Present when supported: ids the order needs. */
  zoneId: string | null;
  routeId: string | null;
  slot: DeliverySlot | null;
};

const unsupported = (postcode: string, preorderProductsAvailable: boolean): ResolvedDelivery => ({
  check: {
    postcode,
    supported: false,
    zone: null,
    mode: null,
    minOrderCents: 0,
    deliveryFeeCents: 0,
    freeDeliveryThresholdCents: null,
    preorderProductsAvailable,
    nextSlot: null,
  },
  zoneId: null,
  routeId: null,
  slot: null,
});

/** Single source of truth: postcode -> zone terms + next slot. Used by the API, cart pricing and checkout. */
export async function resolveDelivery(rawPostcode: string, now = new Date()): Promise<ResolvedDelivery> {
  const postcode = normalizePostcode(rawPostcode);
  if (!POSTCODE_RE.test(postcode)) return unsupported(postcode, false);

  const merchant = await getMerchant();
  const preorderProductsAvailable =
    (await db.product.count({ where: { merchantId: merchant.id, preorderEligible: true, isHidden: false, isAvailable: true } })) > 0;
  const pr = await db.postcodeRoute.findUnique({
    where: { postcode },
    include: { route: { include: { zone: true, schedules: true } } },
  });
  const route = pr?.route;
  if (!route || !route.isActive || !route.zone.isActive || route.zone.merchantId !== merchant.id)
    return unsupported(postcode, preorderProductsAvailable);

  const blackouts = await db.deliveryBlackoutDate.findMany({
    where: { merchantId: merchant.id, date: { gte: new Date(now.getTime() - 2 * 86400_000) } },
    select: { date: true },
  });
  const slot = nextDeliverySlot({
    schedules: route.schedules,
    blackoutDates: new Set(blackouts.map((b) => b.date.toISOString().slice(0, 10))),
    now,
    horizonDays: merchant.settings.slotHorizonDays,
  });
  const z = route.zone;
  return {
    check: {
      postcode,
      supported: true,
      zone: { id: z.id, name: z.name },
      mode: z.mode,
      minOrderCents: z.minOrderCents,
      deliveryFeeCents: z.deliveryFeeCents,
      freeDeliveryThresholdCents: z.freeDeliveryThresholdCents,
      preorderProductsAvailable,
      nextSlot: slot
        ? {
            date: slot.date,
            weekday: slot.weekday,
            windowStart: slot.windowStart,
            windowEnd: slot.windowEnd,
            cutoffAt: slot.cutoffAt.toISOString(),
          }
        : null,
    },
    zoneId: z.id,
    routeId: route.id,
    slot,
  };
}

export async function checkDelivery(postcode: string, now = new Date()): Promise<DeliveryCheck> {
  return (await resolveDelivery(postcode, now)).check;
}
