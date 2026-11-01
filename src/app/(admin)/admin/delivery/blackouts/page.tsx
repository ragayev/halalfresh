import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/server/auth";
import { getMerchant } from "@/server/settings";
import { ActionForm, RunButton } from "@/components/admin/forms";
import { Card, Field, Input } from "@/components/ui";
import { addBlackoutAction, deleteBlackoutAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function Blackouts() {
  await requireAdmin();
  const m = await getMerchant();
  const rows = await db.deliveryBlackoutDate.findMany({ where: { merchantId: m.id }, orderBy: { date: "asc" } });
  return (
    <div className="max-w-2xl space-y-6">
      <Link href="/admin/delivery" className="text-sm text-forest hover:underline">
        ← Delivery zones
      </Link>
      <h1 className="text-2xl font-semibold">Blackout dates</h1>
      <p className="text-sm text-muted">
        No deliveries on these days (holidays, Bayram, vacation). Customers see the next available date instead.
      </p>
      <Card className="p-6">
        <ActionForm action={addBlackoutAction} submit="Add date">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" htmlFor="date">
              <Input name="date" type="date" required />
            </Field>
            <Field label="Reason" htmlFor="reason">
              <Input name="reason" placeholder="Kurban Bayramı" required />
            </Field>
          </div>
        </ActionForm>
      </Card>
      <Card className="divide-y divide-line">
        {rows.length === 0 && <p className="p-4 text-sm text-muted">No blackout dates.</p>}
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 p-4 text-sm">
            <span>
              <strong>{r.date.toISOString().slice(0, 10)}</strong> · {r.reason}
            </span>
            <RunButton run={deleteBlackoutAction.bind(null, r.id)} variant="danger" size="sm" confirm="Remove this date?">
              Remove
            </RunButton>
          </div>
        ))}
      </Card>
    </div>
  );
}
