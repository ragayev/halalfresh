import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/server/auth";
import { formatMoney } from "@/domain/money";
import { imageStatus, priceLabel, PRODUCT_STATUSES, type ProductStatus, type SellingUnit } from "@/domain/product-rules";
import { getCatalogStats, listProducts, type AdminProductFilters } from "@/server/product-service";
import { Badge, buttonClasses, Card } from "@/components/ui";
import { ToggleButton } from "@/components/admin/toggle-button";
import { StatusSelect } from "@/components/admin/status-select";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function Products({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdmin();
  const sp = await searchParams;
  const status = PRODUCT_STATUSES.find((s) => s === one(sp.status));
  const availability = one(sp.availability) === "available" || one(sp.availability) === "unavailable" ? (one(sp.availability) as "available" | "unavailable") : undefined;
  const filters: AdminProductFilters = {
    q: one(sp.q),
    sku: one(sp.sku),
    category: one(sp.category),
    status,
    availability,
    missingImage: one(sp.missingImage) === "1",
    missingPrice: one(sp.missingPrice) === "1",
  };
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const [stats, list, categories] = await Promise.all([
    getCatalogStats(),
    listProducts(filters, page, 50),
    db.category.findMany({ orderBy: { sortOrder: "asc" }, select: { slug: true, name: true } }),
  ]);
  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, one(v)])), ...over })) if (v !== undefined && v !== "") p.set(k, String(v));
    return p.toString();
  };
  const statCards: [string, number, string?][] = [
    ["Total", stats.total],
    ["Published", stats.published, "status=ACTIVE"],
    ["Draft", stats.draft, "status=DRAFT"],
    ["Archived", stats.archived, "status=ARCHIVED"],
    ["Available", stats.available, "availability=available"],
    ["Purchasable", stats.purchasable],
    ["No/placeholder image", stats.missingImage, "missingImage=1"],
    ["No confirmed price", stats.missingPrice, "missingPrice=1"],
  ];
  const sel = "h-10 rounded-lg border border-line bg-white px-2 text-sm";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Products</h1>
        <div className="flex gap-2">
          <Link href={`/admin/products/export?${qs({ page: undefined })}`} className={buttonClasses({ size: "sm", variant: "secondary" })} prefetch={false}>
            Export CSV
          </Link>
          <Link href="/admin/products/import" className={buttonClasses({ size: "sm", variant: "secondary" })}>
            Import CSV
          </Link>
          <Link href="/admin/products/new" className={buttonClasses({ size: "sm" })}>
            Add product
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {statCards.map(([label, n, href]) => (
          <Card key={label} className="p-3">
            <div className="text-xs text-muted">{label}</div>
            {href ? (
              <Link href={`/admin/products?${href}`} className="text-xl font-semibold tabular-nums text-forest hover:underline">{n}</Link>
            ) : (
              <div className="text-xl font-semibold tabular-nums">{n}</div>
            )}
          </Card>
        ))}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2" role="search">
        <label className="text-xs text-muted">Name<input name="q" defaultValue={filters.q} className={`${sel} mt-1 block w-44`} /></label>
        <label className="text-xs text-muted">Supplier SKU<input name="sku" defaultValue={filters.sku} className={`${sel} mt-1 block w-36`} /></label>
        <label className="text-xs text-muted">Category
          <select name="category" defaultValue={filters.category ?? ""} className={`${sel} mt-1 block`}>
            <option value="">All</option>
            {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted">Status
          <select name="status" defaultValue={status ?? ""} className={`${sel} mt-1 block`}>
            <option value="">All</option>
            {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted">Availability
          <select name="availability" defaultValue={availability ?? ""} className={`${sel} mt-1 block`}>
            <option value="">All</option>
            <option value="available">Available</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
        <label className="flex h-10 items-center gap-1 text-sm"><input type="checkbox" name="missingImage" value="1" defaultChecked={filters.missingImage} /> Missing image</label>
        <label className="flex h-10 items-center gap-1 text-sm"><input type="checkbox" name="missingPrice" value="1" defaultChecked={filters.missingPrice} /> Missing price</label>
        <button className={buttonClasses({ size: "sm" })}>Filter</button>
        <Link href="/admin/products" className="h-10 content-center px-2 text-sm text-muted hover:underline">Reset</Link>
      </form>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="border-b border-line text-xs uppercase text-muted">
            <tr>
              {["Name", "Supplier SKU", "Category", "Price", "Unit", "Status", "Available", "Featured", "Preorder", "Image", "Updated", ""].map((h) => (
                <th key={h} className="px-3 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.rows.map((p) => {
              const img = imageStatus(p.images);
              const unit = p.sellingUnit as SellingUnit;
              const priced = p.priceConfirmed && p.pricePerKgCents > 0;
              return (
                <tr key={p.id}>
                  <td className="px-3 py-3 font-medium">
                    {p.name}
                    {p.bundleItems != null && <Badge tone={p.priceConfirmed ? "green" : "amber"} className="ms-2">{p.priceConfirmed ? "Bundle" : "Bundle · draft price"}</Badge>}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted">{p.supplierArticles.map((s) => s.supplierSku).join(", ") || "—"}</td>
                  <td className="px-3 py-3 text-muted">{p.category.name}</td>
                  <td className="px-3 py-3 tabular-nums">
                    {formatMoney(p.pricePerKgCents)} <span className="text-xs text-muted">/{priceLabel(unit)}</span>
                    {!priced && <Badge tone="amber" className="ms-1">{p.pricePerKgCents > 0 ? "unconfirmed" : "no price"}</Badge>}
                  </td>
                  <td className="px-3 py-3 text-xs">{unit}</td>
                  <td className="px-3 py-3"><StatusSelect id={p.id} value={p.status as ProductStatus} /></td>
                  <td className="px-3 py-3"><ToggleButton id={p.id} field="isAvailable" value={p.isAvailable} /></td>
                  <td className="px-3 py-3"><ToggleButton id={p.id} field="isFeatured" value={p.isFeatured} /></td>
                  <td className="px-3 py-3"><ToggleButton id={p.id} field="preorderEligible" value={p.preorderEligible} /></td>
                  <td className="px-3 py-3">
                    <Badge tone={img === "OK" ? "green" : img === "FALLBACK" ? "amber" : "gray"}>{img === "OK" ? "photo" : img === "FALLBACK" ? "placeholder" : "none"}</Badge>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted tabular-nums">{p.updatedAt.toISOString().slice(0, 10)}</td>
                  <td className="px-3 py-3 text-right">
                    <Link href={`/admin/products/${p.id}`} className="font-medium text-forest hover:underline">Edit</Link>
                  </td>
                </tr>
              );
            })}
            {!list.rows.length && <tr><td colSpan={12} className="px-3 py-8 text-center text-muted">No products match these filters.</td></tr>}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted">
        <span>{list.total} product{list.total === 1 ? "" : "s"} · page {list.page} of {list.pages}</span>
        <span className="flex gap-3">
          {list.page > 1 && <Link className="text-forest hover:underline" href={`/admin/products?${qs({ page: list.page - 1 })}`}>← Previous</Link>}
          {list.page < list.pages && <Link className="text-forest hover:underline" href={`/admin/products?${qs({ page: list.page + 1 })}`}>Next →</Link>}
        </span>
      </div>
    </div>
  );
}
