import Link from "next/link";
import { requireAdmin } from "@/server/auth";
import { getMerchant } from "@/server/settings";
import { getGateway } from "@/server/payments/gateway";
import { saveMerchantAction } from "../actions";
import { ActionForm } from "@/components/admin/forms";
import { StripePanel } from "@/components/admin/stripe-panel";
import { Badge, Card, Field, Input } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Settings() {
  await requireAdmin();
  const m = await getMerchant();
  let status = null,
    statusError = "";
  try {
    status = await (await getGateway()).getAccountStatus(m.stripeAccountId);
  } catch {
    statusError = "Could not reach Stripe";
  }
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
        <h2 className="mb-1 font-semibold">Delivery</h2>
        <p className="text-sm text-muted">
          Zones, minimum order, fees, schedules, postcodes and blackout dates moved to{" "}
          <Link href="/admin/delivery" className="font-medium text-forest underline">
            Delivery
          </Link>
          .
        </p>
      </Card>
      <Badge tone="amber">Legal pages are placeholders in src/content/legal.ts.</Badge>
    </div>
  );
}
