import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/server/auth";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Waitlist() {
  await requireAdmin();
  const groups = await db.waitlistEntry.groupBy({
    by: ["postcode"],
    _count: { _all: true },
    _max: { createdAt: true },
    orderBy: [{ _count: { postcode: "desc" } }, { postcode: "asc" }],
  });
  const total = groups.reduce((s, g) => s + g._count._all, 0);
  return (
    <div className="max-w-2xl space-y-6">
      <Link href="/admin/delivery" className="text-sm text-forest hover:underline">
        ← Delivery zones
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Waitlist demand</h1>
        {/* File download from a route handler, not a page navigation. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/admin/delivery/waitlist/export" className="rounded-full bg-forest px-4 py-2 text-sm font-semibold text-white">
          Export CSV
        </a>
      </div>
      <p className="text-sm text-muted">
        {total} sign-ups in {groups.length} postcodes. When a postcode reaches 10, consider opening it.
      </p>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-sage-soft text-left">
            <tr>
              <th className="p-3">Postcode</th>
              <th className="p-3">Sign-ups</th>
              <th className="p-3">Latest</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.postcode} className="border-t border-line">
                <td className="p-3 font-mono">{g.postcode}</td>
                <td className="p-3 tabular-nums">{g._count._all}</td>
                <td className="p-3 text-muted">{g._max.createdAt?.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
            {groups.length === 0 && (
              <tr>
                <td colSpan={3} className="p-4 text-muted">
                  No sign-ups yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
