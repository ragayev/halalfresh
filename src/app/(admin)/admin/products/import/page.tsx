import Link from "next/link";
import { requireAdmin } from "@/server/auth";
import { Card } from "@/components/ui";
import { CsvImport } from "@/components/admin/csv-import";

export const dynamic = "force-dynamic";

export default async function ImportProducts() {
  await requireAdmin();
  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Import prices &amp; availability</h1>
        <Link href="/admin/products" className="text-sm font-medium text-forest hover:underline">← Products</Link>
      </div>
      <Card className="space-y-3 p-6 text-sm">
        <p>
          Start from <Link href="/admin/products/export" className="font-medium text-forest underline">the CSV export</Link>, edit the
          <code className="mx-1">price_eur</code>, <code>price_confirmed</code> and <code>available</code> columns (German “12,50” or “12.50”), and upload it.
          Rows are matched by <code>id</code> only. Products are never created, and no other field can change.
        </p>
        <p>Preview first: nothing is written until you press <strong>Apply changes</strong>. If any row is rejected, nothing is applied.</p>
      </Card>
      <Card className="p-6"><CsvImport /></Card>
    </div>
  );
}
