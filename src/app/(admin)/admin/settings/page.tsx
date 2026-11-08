import Link from "next/link";
import { requireAdmin } from "@/server/auth";
import { getMerchant } from "@/server/settings";
import { saveMerchantAction, saveOperatingSettingsAction } from "../actions";
import { getSettings } from "@/server/app-settings";
import { ActionForm } from "@/components/admin/forms";
import { Badge, Card, Checkbox, Field, Input } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Settings() {
  await requireAdmin();
  const m = await getMerchant();
  const st = await getSettings();
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Einstellungen</h1>
      <Card className="p-6">
        <h2 className="mb-4 font-semibold">Betrieb</h2>
        <ActionForm action={saveOperatingSettingsAction}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Toleranz (Basispunkte, 1000 = 10 %)" htmlFor="toleranceBps" hint="Wird bei jeder Bestellung festgeschrieben.">
              <Input id="toleranceBps" name="toleranceBps" inputMode="numeric" defaultValue={st.toleranceBps} />
            </Field>
            <Field label="Zahlung überfällig nach (Stunden)" htmlFor="paymentOverdueHours">
              <Input id="paymentOverdueHours" name="paymentOverdueHours" inputMode="numeric" defaultValue={st.paymentOverdueHours} />
            </Field>
            <Field label="Bestelllink gültig nach Abschluss (Tage)" htmlFor="tokenExpiryDays">
              <Input id="tokenExpiryDays" name="tokenExpiryDays" inputMode="numeric" defaultValue={st.tokenExpiryDays} />
            </Field>
            <Field label="Telegram Chat-ID (Admin-Benachrichtigungen)" htmlFor="telegramChatId">
              <Input id="telegramChatId" name="telegramChatId" defaultValue={st.telegramChatId} />
            </Field>
          </div>
          <Checkbox name="halalCertificateVerified" defaultChecked={st.halalCertificateVerified} label="Halal-Zertifikat geprüft (erst dann wird „zertifiziert“ im Shop angezeigt)" />
        </ActionForm>
      </Card>
      <Card className="p-6">
        <h2 className="mb-4 font-semibold">Verkäufer (Kevser Fleischerei)</h2>
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
