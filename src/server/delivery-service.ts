import { db } from "@/lib/db";
import { availableSlots, findZoneForPostcode } from "@/domain/delivery";
import { getMerchant } from "./settings";

export async function zoneForPostcode(postcode: string) {
  const merchant = await getMerchant();
  const zones = await db.deliveryZone.findMany({
    where: { merchantId: merchant.id, isActive: true },
    include: { postcodes: true, slots: true },
  });
  return { merchant, zone: findZoneForPostcode(zones, postcode) };
}

export async function slotsForPostcode(postcode: string, now = new Date()) {
  const { merchant, zone } = await zoneForPostcode(postcode);
  if (!zone)
    return {
      supported: false as const,
      estimate: null,
      deliveryFeeCents: 0,
      freeDeliveryOverCents: null,
    };
  const s = merchant.settings;
  return {
    supported: true as const,
    deliveryFeeCents: zone.deliveryFeeCents ?? s.deliveryFeeCents,
    freeDeliveryOverCents: s.freeDeliveryOverCents,
    estimate: availableSlots(zone.slots, now, s.slotLeadTimeHours, s.slotHorizonDays)[0] ?? null,
  };
}
