import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/server/auth";
import { ActionForm, RunButton } from "@/components/admin/forms";
import { Badge, Card, Field, Input, Textarea } from "@/components/ui";
import {
  deleteRouteAction,
  deleteScheduleAction,
  deleteZoneAction,
  savePostcodesAction,
  saveRouteAction,
  saveScheduleAction,
  saveZoneAction,
} from "./actions";

export const dynamic = "force-dynamic";
const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const eur = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));
const Check = ({ name, label, checked }: { name: string; label: string; checked: boolean }) => (
  <label className="flex items-center gap-2 text-sm">
    <input type="checkbox" name={name} defaultChecked={checked} className="size-4 accent-[#164b39]" />
    {label}
  </label>
);
const Select = ({ name, defaultValue, children }: { name: string; defaultValue?: string | number; children: React.ReactNode }) => (
  <select name={name} defaultValue={defaultValue} className="h-11 w-full rounded-xl border border-line bg-white px-3 text-sm">
    {children}
  </select>
);

function ZoneFields({
  z,
}: {
  z?: {
    name: string;
    mode: string;
    minOrderCents: number;
    deliveryFeeCents: number;
    freeDeliveryThresholdCents: number | null;
    sortOrder: number;
    isActive: boolean;
  };
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" htmlFor="name">
          <Input name="name" defaultValue={z?.name} required />
        </Field>
        <Field label="Mode" htmlFor="mode" hint="Preorder-only: only preorder-eligible products">
          <Select name="mode" defaultValue={z?.mode ?? "REGULAR"}>
            <option value="REGULAR">Regular</option>
            <option value="PREORDER_ONLY">Preorder only</option>
          </Select>
        </Field>
        <Field label="Sort order" htmlFor="sortOrder">
          <Input name="sortOrder" inputMode="numeric" defaultValue={z?.sortOrder ?? 0} />
        </Field>
        <Field label="Minimum order (€)" htmlFor="minOrder" hint="Merchandise only">
          <Input name="minOrder" inputMode="decimal" defaultValue={eur(z?.minOrderCents ?? 0)} required />
        </Field>
        <Field label="Delivery fee (€)" htmlFor="deliveryFee">
          <Input name="deliveryFee" inputMode="decimal" defaultValue={eur(z?.deliveryFeeCents ?? 0)} required />
        </Field>
        <Field label="Free delivery from (€)" htmlFor="freeFrom" hint="Empty = never">
          <Input name="freeFrom" inputMode="decimal" defaultValue={eur(z?.freeDeliveryThresholdCents ?? null)} />
        </Field>
      </div>
      <Check name="isActive" label="Active" checked={z?.isActive ?? true} />
    </>
  );
}

function ScheduleFields({
  s,
}: {
  s?: {
    kind: string;
    weekday: number;
    nth: number | null;
    windowStart: string;
    windowEnd: string;
    cutoffHoursBefore: number;
    isActive: boolean;
  };
}) {
  return (
    <div className="grid items-end gap-3 sm:grid-cols-4 lg:grid-cols-7">
      <Field label="Rule" htmlFor="kind">
        <Select name="kind" defaultValue={s?.kind ?? "WEEKLY"}>
          <option value="WEEKLY">Every week</option>
          <option value="NTH_WEEKDAY_OF_MONTH">Nth weekday of month</option>
        </Select>
      </Field>
      <Field label="Weekday" htmlFor="weekday">
        <Select name="weekday" defaultValue={s?.weekday ?? 1}>
          {DAYS.slice(1).map((d, i) => (
            <option key={d} value={i + 1}>
              {d}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Nth" htmlFor="nth" hint="monthly only">
        <Input name="nth" inputMode="numeric" defaultValue={s?.nth ?? ""} placeholder="1" />
      </Field>
      <Field label="From" htmlFor="windowStart">
        <Input name="windowStart" defaultValue={s?.windowStart ?? "14:00"} placeholder="14:00" required />
      </Field>
      <Field label="To" htmlFor="windowEnd">
        <Input name="windowEnd" defaultValue={s?.windowEnd ?? "18:00"} placeholder="18:00" required />
      </Field>
      <Field label="Cutoff (h before)" htmlFor="cutoffHoursBefore">
        <Input name="cutoffHoursBefore" inputMode="numeric" defaultValue={s?.cutoffHoursBefore ?? 24} required />
      </Field>
      {s && <Check name="isActive" label="Active" checked={s.isActive} />}
    </div>
  );
}

export default async function DeliveryAdmin() {
  await requireAdmin();
  const zones = await db.deliveryZone.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      routes: {
        orderBy: { name: "asc" },
        include: { schedules: { orderBy: [{ weekday: "asc" }, { windowStart: "asc" }] }, postcodes: { orderBy: { postcode: "asc" } } },
      },
    },
  });
  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Delivery zones</h1>
        <Link href="/admin/delivery/blackouts" className="rounded-full bg-sage px-3 py-1.5 text-sm font-medium">
          Blackout dates
        </Link>
        <Link href="/admin/delivery/waitlist" className="rounded-full bg-sage px-3 py-1.5 text-sm font-medium">
          Waitlist
        </Link>
      </div>
      <Badge tone="amber">Sundays are never delivered. Times are Europe/Berlin. A postcode belongs to exactly one route.</Badge>

      {zones.map((z) => (
        <Card key={z.id} className="space-y-5 p-6">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">{z.name}</h2>
            <Badge tone={z.mode === "REGULAR" ? "green" : "amber"}>{z.mode === "REGULAR" ? "Regular" : "Preorder only"}</Badge>
            {!z.isActive && <Badge>Inactive</Badge>}
          </div>
          <ActionForm action={saveZoneAction.bind(null, z.id)}>
            <ZoneFields z={z} />
          </ActionForm>

          {z.routes.map((r) => (
            <div key={r.id} className="space-y-4 rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">
                  Route: {r.name} {!r.isActive && <Badge>Inactive</Badge>}
                </h3>
                <RunButton
                  run={deleteRouteAction.bind(null, r.id)}
                  variant="danger"
                  size="sm"
                  confirm={`Delete route ${r.name} and its postcodes/schedules?`}
                >
                  Delete route
                </RunButton>
              </div>
              <ActionForm action={saveRouteAction.bind(null, z.id, r.id)}>
                <div className="flex flex-wrap items-end gap-4">
                  <Field label="Route name" htmlFor="name">
                    <Input name="name" defaultValue={r.name} required />
                  </Field>
                  <Check name="isActive" label="Active" checked={r.isActive} />
                </div>
              </ActionForm>

              <div className="space-y-3">
                <p className="text-sm font-semibold">Schedules</p>
                {r.schedules.map((s) => (
                  <div key={s.id} className="rounded-lg bg-sage-soft p-3">
                    <ActionForm action={saveScheduleAction.bind(null, r.id, s.id)}>
                      <ScheduleFields s={s} />
                    </ActionForm>
                    <div className="mt-2">
                      <RunButton run={deleteScheduleAction.bind(null, s.id)} variant="danger" size="sm" confirm="Delete this schedule?">
                        Delete
                      </RunButton>
                    </div>
                  </div>
                ))}
                <details className="rounded-lg border border-dashed border-line p-3">
                  <summary className="cursor-pointer text-sm font-medium">Add schedule</summary>
                  <div className="mt-3">
                    <ActionForm action={saveScheduleAction.bind(null, r.id, "new")} submit="Add schedule">
                      <ScheduleFields />
                    </ActionForm>
                  </div>
                </details>
              </div>

              <ActionForm action={savePostcodesAction.bind(null, r.id)} submit="Save postcodes">
                <Field
                  label={`Postcodes (${r.postcodes.length})`}
                  htmlFor="postcodes"
                  hint="5 digits, separated by comma/space; ranges like 14467-14482. Saving replaces the list."
                >
                  <Textarea name="postcodes" rows={4} defaultValue={r.postcodes.map((p) => p.postcode).join(", ")} />
                </Field>
              </ActionForm>
            </div>
          ))}

          <details className="rounded-lg border border-dashed border-line p-3">
            <summary className="cursor-pointer text-sm font-medium">Add route</summary>
            <div className="mt-3">
              <ActionForm action={saveRouteAction.bind(null, z.id, "new")} submit="Add route">
                <Field label="Route name" htmlFor="name">
                  <Input name="name" placeholder="West" required />
                </Field>
              </ActionForm>
            </div>
          </details>
          <RunButton run={deleteZoneAction.bind(null, z.id)} variant="danger" size="sm" confirm={`Delete zone ${z.name}?`}>
            Delete zone
          </RunButton>
        </Card>
      ))}

      <Card className="p-6">
        <h2 className="mb-4 font-semibold">Add zone</h2>
        <ActionForm action={saveZoneAction.bind(null, "new")} submit="Add zone">
          <ZoneFields />
        </ActionForm>
      </Card>
    </div>
  );
}
