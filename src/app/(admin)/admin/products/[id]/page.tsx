import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getProductById } from "@/server/product-service";
import { imageStatus, imageStorage, PRODUCT_STATUSES, SELLING_UNITS } from "@/domain/product-rules";
import { requireAdmin } from "@/server/auth";
import { saveProductAction } from "../../actions";
import { ActionForm } from "@/components/admin/forms";
import { Badge, Card, Field, Input, Textarea } from "@/components/ui";
import { parseBundleItems, bundleTotalGrams } from "@/domain/bundles";
import { formatWeight } from "@/domain/pricing";

export const dynamic = "force-dynamic";
type Tr = Record<string, { name?: string; description?: string }>;

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const [cats, p] = await Promise.all([
    db.category.findMany({ orderBy: { sortOrder: "asc" } }),
    id === "new" ? null : getProductById(id),
  ]);
  if (id !== "new" && !p) notFound();
  const tr = (p?.translations ?? {}) as Tr;
  const bundle = p?.bundleItems != null ? (parseBundleItems(p.bundleItems) ?? []) : null;
  // Component availability: bundles must not go live while a component cut is missing at the butcher.
  const comps = bundle?.length
    ? await db.product.findMany({
        where: { slug: { in: bundle.flatMap((b) => (b.productSlug ? [b.productSlug] : [])) } },
        select: { slug: true, isAvailable: true },
      })
    : [];
  const compBySlug = new Map(comps.map((c) => [c.slug, c]));
  const unavailable = (bundle ?? []).filter((b) => !b.productSlug || !compBySlug.get(b.productSlug)?.isAvailable);
  const action = saveProductAction.bind(null, id);
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">{p ? `Edit ${p.name}` : "New product"}</h1>
      <Card className="p-6">
        <ActionForm action={action}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name (English)" htmlFor="name">
              <Input id="name" name="name" defaultValue={p?.name} required />
            </Field>
            <Field label="URL slug" htmlFor="slug" hint="lowercase-with-dashes">
              <Input id="slug" name="slug" defaultValue={p?.slug} required pattern="[a-z0-9-]+" />
            </Field>
          </div>
          <Field label="Description (English)" htmlFor="description">
            <Textarea id="description" name="description" defaultValue={p?.description} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Category" htmlFor="categoryId">
              <select
                id="categoryId"
                name="categoryId"
                defaultValue={p?.categoryId}
                className="h-12 w-full rounded-xl border border-line bg-white px-3"
              >
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={bundle ? "Price per bundle (€)" : "Price per kg (€)"} htmlFor="price" hint={bundle ? "Placeholder until the butcher confirms it" : undefined}>
              <Input id="price" name="price" inputMode="decimal" defaultValue={p ? (p.pricePerKgCents / 100).toFixed(2) : ""} required />
            </Field>
            <Field label="Selling unit" htmlFor="sellingUnit" hint="Per-piece and per-package products use whole units (step/min/max in multiples of 1000)">
              <select id="sellingUnit" name="sellingUnit" defaultValue={p?.sellingUnit ?? "KG"} className="h-12 w-full rounded-xl border border-line bg-white px-3">
                {SELLING_UNITS.map((u) => <option key={u} value={u}>{u === "KG" ? "Per kg" : u === "PIECE" ? "Per piece" : "Per package"}</option>)}
              </select>
            </Field>
            <Field label="Step (g)" htmlFor="stepGrams" hint="500 or 1000">
              <Input id="stepGrams" name="stepGrams" inputMode="numeric" defaultValue={p?.stepGrams ?? 500} required />
            </Field>
            <Field label="Minimum (g)" htmlFor="minGrams">
              <Input id="minGrams" name="minGrams" inputMode="numeric" defaultValue={p?.minGrams ?? 1000} required />
            </Field>
            <Field label="Maximum (g)" htmlFor="maxGrams">
              <Input id="maxGrams" name="maxGrams" inputMode="numeric" defaultValue={p?.maxGrams ?? 20000} required />
            </Field>
            <Field label="Origin (optional)" htmlFor="origin">
              <Input id="origin" name="origin" defaultValue={p?.origin ?? ""} />
            </Field>
          </div>
          {bundle && (
            <fieldset className="space-y-3 rounded-xl bg-sage-soft p-4">
              <legend className="px-1 text-sm font-semibold">Fleischpaket · {formatWeight(bundleTotalGrams(bundle))} total</legend>
              <Field
                label="Contents (one per line)"
                htmlFor="bundleItems"
                hint="grams | Deutsch | Türkçe | English | catalogue slug (optional). Orders keep a frozen copy of the contents."
              >
                <Textarea
                  id="bundleItems"
                  name="bundleItems"
                  rows={8}
                  className="font-mono text-xs"
                  defaultValue={bundle.map((b) => [b.grams, b.names.de, b.names.tr, b.names.en, b.productSlug ?? ""].join(" | ")).join("\n")}
                />
              </Field>
              {unavailable.length > 0 && (
                <p className="text-sm">
                  <Badge tone="amber">Check availability</Badge> Components not available or not linked in the catalogue:{" "}
                  {unavailable.map((b) => b.names.de).join(", ")}
                </p>
              )}
            </fieldset>
          )}
          <Field
            label="Halal certification (only if verified)"
            htmlFor="halalCertification"
            hint="Shown to customers verbatim. Leave empty if not verified."
          >
            <Input id="halalCertification" name="halalCertification" defaultValue={p?.halalCertification ?? ""} />
          </Field>
          <Field label="Allergen / food information" htmlFor="allergenInfo">
            <Textarea id="allergenInfo" name="allergenInfo" defaultValue={p?.allergenInfo ?? ""} />
          </Field>
          <fieldset className="grid gap-4 rounded-xl bg-sage-soft p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold">Translations</legend>
            <Field label="Name (Deutsch)" htmlFor="nameDe">
              <Input id="nameDe" name="nameDe" defaultValue={tr.de?.name ?? ""} />
            </Field>
            <Field label="Name (Türkçe)" htmlFor="nameTr">
              <Input id="nameTr" name="nameTr" defaultValue={tr.tr?.name ?? ""} />
            </Field>
            <Field label="Description (Deutsch)" htmlFor="descDe">
              <Textarea id="descDe" name="descDe" defaultValue={tr.de?.description ?? ""} />
            </Field>
            <Field label="Description (Türkçe)" htmlFor="descTr">
              <Textarea id="descTr" name="descTr" defaultValue={tr.tr?.description ?? ""} />
            </Field>
          </fieldset>
          <Field
            label="Supplier article numbers"
            htmlFor="supplierSkus"
            hint="Separated by comma, space or new line. A number can belong to one product only."
          >
            <Textarea id="supplierSkus" name="supplierSkus" rows={2} className="font-mono text-xs" defaultValue={p?.supplierArticles.map((a) => a.supplierSku).join(", ") ?? ""} />
          </Field>
          <fieldset className="space-y-2 rounded-xl bg-sage-soft p-4 text-sm">
            <legend className="px-1 font-semibold">Image</legend>
            {p && (
              <div>
                <p>
                  Status: <strong>{{ OK: "photo", FALLBACK: "placeholder / illustrative only", NONE: "no image" }[imageStatus(p.images)]}</strong>
                </p>
                <ul className="mt-1 space-y-1">
                  {p.images.map((i) => (
                    <li key={i.id} className="flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={i.url ?? `/api/images/${i.id}`} alt={i.alt} className="size-12 rounded-lg object-cover" />
                      <span className="text-xs text-muted">
                        {imageStorage(i) === "static" ? `Repository file ${i.url}` : "Database upload"}
                        {i.isPlaceholder ? " · placeholder" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Field label="Upload image (JPEG/PNG/WebP, ≤ 2 MB; replaces current)" htmlFor="image" hint="Stored in the database. To use a file from public/images/products/, commit it to the repository and deploy; uploads cannot write to that folder.">
              <input id="image" name="image" type="file" accept="image/jpeg,image/png,image/webp" className="text-sm" />
            </Field>
          </fieldset>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="isAvailable" defaultChecked={p?.isAvailable ?? true} className="size-4 accent-[#164b39]" />
              Available
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="isFeatured" defaultChecked={p?.isFeatured ?? false} className="size-4 accent-[#164b39]" />
              Featured on homepage
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="preorderEligible"
                defaultChecked={p?.preorderEligible ?? false}
                className="size-4 accent-[#164b39]"
              />
              Preorder eligible (orderable in preorder-only zones)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="priceConfirmed" defaultChecked={p?.priceConfirmed ?? true} className="size-4 accent-[#164b39]" />
              Price confirmed (required to sell; bundles need it to be published)
            </label>
          </div>
          <Field label="Publishing status" htmlFor="status" hint="Draft = not shown to customers · Published = listed · Archived = retired (kept for old orders)">
            <select id="status" name="status" defaultValue={p?.status ?? "DRAFT"} className="h-12 w-full max-w-xs rounded-xl border border-line bg-white px-3">
              {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
            </select>
          </Field>
        </ActionForm>
      </Card>
    </div>
  );
}
