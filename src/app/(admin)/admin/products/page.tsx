import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/server/auth";
import { formatMoney } from "@/domain/money";
import { Badge, buttonClasses, Card } from "@/components/ui";
import { ToggleButton } from "@/components/admin/toggle-button";

export const dynamic = "force-dynamic";

export default async function Products() {
  await requireAdmin();
  const products = await db.product.findMany({
    include: { category: true },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Products</h1>
        <Link href="/admin/products/new" className={buttonClasses({ size: "sm" })}>
          Add product
        </Link>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-line text-xs uppercase text-muted">
            <tr>
              {["Name", "Category", "€/kg", "Step", "Available", "Featured", "Preorder", "Hidden", ""].map((h) => (
                <th key={h} className="px-4 py-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {products.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3 text-muted">{p.category.name}</td>
                <td className="px-4 py-3 tabular-nums">{formatMoney(p.pricePerKgCents)}</td>
                <td className="px-4 py-3">{p.stepGrams} g</td>
                <td className="px-4 py-3">
                  <ToggleButton id={p.id} field="isAvailable" value={p.isAvailable} />
                </td>
                <td className="px-4 py-3">
                  <ToggleButton id={p.id} field="isFeatured" value={p.isFeatured} />
                </td>
                <td className="px-4 py-3">
                  <ToggleButton id={p.id} field="preorderEligible" value={p.preorderEligible} />
                </td>
                <td className="px-4 py-3">
                  <ToggleButton id={p.id} field="isHidden" value={p.isHidden} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/admin/products/${p.id}`} className="font-medium text-forest hover:underline">
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Badge tone="amber">Demo prices and illustrations are placeholders — replace before launch.</Badge>
    </div>
  );
}
