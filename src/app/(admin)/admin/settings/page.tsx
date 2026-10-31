import { db } from "@/lib/db";
import { requireAdmin } from "@/server/auth";
import { getMerchant } from "@/server/settings";
import { getGateway } from "@/server/payments/gateway";
import { saveDeliveryAction, saveMerchantAction } from "../actions";
import { ActionForm } from "@/components/admin/forms";
import { StripePanel } from "@/components/admin/stripe-panel";
import { Badge, Card, Field, Input, Textarea } from "@/components/ui";

export const dynamic = "force-dynamic";
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export default async function Settings() {
  await requireAdmin();
  const m = await getMerchant();
  const zone = await db.deliveryZone.findFirst({
    where: { merchantId: m.id },
    include: {
      postcodes: true,
      slots: {
        where: { isActive: true },
        orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
      },
    },
  });
  let status = null,
    statusError = "";
  try {
    status = await (await getGateway()).getAccountStatus(m.stripeAccountId);
  } catch {
    statusError = "Could not reach Stripe";
  }
  const s = m.settings,
    eur = (c: number) => (c / 100).toFixed(2);
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card className="space-y-3 p-6">
        <h2 className="font-semibold">Payments (Stripe)</h2>
        <StripePanel status={status} error={statusError} />
      </Card>
      <Card className="p-6">
        <h2 className="mb-4 font-semibold">Merchant</h2>
        <ActionForm action={saveMerchantAction}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" htmlFor="name">
              <Input id="name" name="name" defaultValue={m.name} required />
            </Field>
            <Field label="Legal name" htmlFor="legalName">
              <Input id="legalName" name="legalName" defaultValue={m.legalName ?? ""} />
            </Field>
            <Field label="Address" htmlFor="addressLine">
              <Input id="addressLine" name="addressLine" defaultValue={m.addressLine ?? ""} />
            </Field>
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <Field label="Postcode" htmlFor="postalCode">
                <Input id="postalCode" name="postalCode" defaultValue={m.postalCode ?? ""} />
              </Field>
              <Field label="City" htmlFor="city">
                <Input id="city" name="city" defaultValue={m.city ?? ""} />
              </Field>
            </div>
            <Field label="Contact email" htmlFor="contactEmail">
              <Input id="contactEmail" name="contactEmail" type="email" defaultValue={m.contactEmail ?? ""} />
            </Field>
            <Field label="Contact phone" htmlFor="contactPhone">
              <Input id="contactPhone" name="contactPhone" defaultValue={m.contactPhone ?? ""} />
            </Field>
            <Field label="WhatsApp number (international)" htmlFor="whatsappNumber" hint="e.g. +49 151 2345678">
              <Input id="whatsappNumber" name="whatsappNumber" defaultValue={m.whatsappNumber ? `+${m.whatsappNumber}` : ""} />
            </Field>
          </div>
        </ActionForm>
      </Card>
      <Card className="p-6">
        <h2 className="mb-4 font-semibold">Delivery</h2>
        <ActionForm action={saveDeliveryAction}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Minimum order (€)" htmlFor="minOrder" hint="Merchandise only, excl. delivery">
              <Input id="minOrder" name="minOrder" inputMode="decimal" defaultValue={eur(s.minOrderCents)} required />
            </Field>
            <Field label="Delivery fee (€)" htmlFor="deliveryFee">
              <Input id="deliveryFee" name="deliveryFee" inputMode="decimal" defaultValue={eur(s.deliveryFeeCents)} required />
            </Field>
            <Field label="Free delivery from (€)" htmlFor="freeOver" hint="Empty = never">
              <Input
                id="freeOver"
                name="freeOver"
                inputMode="decimal"
                defaultValue={s.freeDeliveryOverCents != null ? eur(s.freeDeliveryOverCents) : ""}
              />
            </Field>
            <Field label="Slot lead time (hours)" htmlFor="leadHours">
              <Input id="leadHours" name="leadHours" inputMode="numeric" defaultValue={s.slotLeadTimeHours} required />
            </Field>
            <Field label="Bookable days ahead" htmlFor="horizonDays">
              <Input id="horizonDays" name="horizonDays" inputMode="numeric" defaultValue={s.slotHorizonDays} required />
            </Field>
          </div>
          <Field label="Supported postcodes" htmlFor="postcodes" hint="Comma/space separated. Exact (10115) or prefix (101*).">
            <Textarea id="postcodes" name="postcodes" defaultValue={zone?.postcodes.map((p) => p.pattern).join(", ") ?? ""} />
          </Field>
          <Field label="Delivery slots (Europe/Berlin)" htmlFor="slots" hint="One per line: day hh:mm-hh:mm, e.g. sat 10:00-14:00">
            <Textarea
              id="slots"
              name="slots"
              rows={5}
              defaultValue={zone?.slots.map((x) => `${DAYS[x.weekday]} ${x.startTime}-${x.endTime}`).join("\n") ?? ""}
            />
          </Field>
        </ActionForm>
      </Card>
      <Badge tone="amber">Legal pages are placeholders in src/content/legal.ts.</Badge>
    </div>
  );
}
