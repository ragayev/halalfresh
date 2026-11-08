import type { PrismaClient } from "@prisma/client";
import { parseBundleItems } from "@/domain/bundles";
import { hasConfirmedPrice, imageStatus, UNIT_QUANTITY } from "@/domain/product-rules";
import { LEGACY_DEMO_CATEGORIES } from "./catalog-import";

/**
 * Read-only reconciliation report. Issues SELECTs only; never writes, merges or deletes. Numbers come from the
 * database it is pointed at (local, staging or production), never from constants.
 */
export interface NameGroup {
  name: string;
  /** What the evidence says; the tool never merges anything. */
  kind: "same-category-name-clash" | "cross-category-same-name" | "legacy-demo-overlap" | "different-supplier-skus";
  products: { id: string; slug: string; category: string; status: string; skus: string[] }[];
}

export interface AuditReport {
  generatedAt: string;
  totals: { products: number; published: number; hidden: number; draft: number; archived: number; available: number; unavailable: number; purchasable: number };
  kinds: { consumer: number; equipment: number; supplierOnly: number; bundles: number; preorder: number; legacyDemo: number };
  missingValidPrice: string[];
  noImage: string[];
  fallbackImageOnly: string[];
  noSupplierMapping: { total: number; byKind: Record<string, number> };
  supplier: {
    articles: number;
    legacyJsonSkus: number;
    /** SKU present in the old translations JSON but not (or differently) in SupplierArticle. */
    jsonNotInTable: string[];
    /** SKU listed under more than one product in the legacy JSON: ambiguous, never auto-resolved. */
    ambiguousInJson: { sku: string; slugs: string[] }[];
    productsWithManySkus: number;
  };
  nameGroups: NameGroup[];
  emptyCategories: string[];
  inconsistent: { slug: string; problems: string[] }[];
  bundleProblems: { slug: string; problems: string[] }[];
  referencedByOrders: number;
}

type Tr = { supplierArticleNumbers?: unknown };

export async function runCatalogAudit(db: PrismaClient): Promise<AuditReport> {
  const products = await db.product.findMany({
    include: {
      category: { select: { slug: true } },
      images: { select: { url: true, isPlaceholder: true } },
      supplierArticles: { select: { supplierSku: true } },
      _count: { select: { orderItems: true } },
    },
    orderBy: { slug: "asc" },
  });
  const categories = await db.category.findMany({ select: { slug: true, _count: { select: { products: true } } } });
  const articleCount = await db.supplierArticle.count();
  const slugs = new Set(products.map((p) => p.slug));
  const demo = new Set(LEGACY_DEMO_CATEGORIES);

  const kindOf = (p: (typeof products)[number]) =>
    demo.has(p.category.slug) || p.slug === "ekonomik-paket" ? "legacyDemo"
    : p.bundleItems != null ? "bundles"
    : p.preorderEligible || p.category.slug === "preorder" ? "preorder"
    : p.category.slug === "ekipman" ? "equipment"
    : p.slug.startsWith("kevser-") ? "supplierOnly"
    : "consumer";

  const kinds = { consumer: 0, equipment: 0, supplierOnly: 0, bundles: 0, preorder: 0, legacyDemo: 0 };
  const noMapping: Record<string, number> = {};
  const jsonBySku = new Map<string, string[]>();
  const jsonNotInTable: string[] = [];
  const inconsistent: AuditReport["inconsistent"] = [];
  const bundleProblems: AuditReport["bundleProblems"] = [];

  for (const p of products) {
    kinds[kindOf(p)]++;
    if (!p.supplierArticles.length) noMapping[kindOf(p)] = (noMapping[kindOf(p)] ?? 0) + 1;

    const json = (p.translations as Tr | null)?.supplierArticleNumbers;
    const tableSkus = new Set(p.supplierArticles.map((a) => a.supplierSku));
    for (const s of Array.isArray(json) ? json.filter((v): v is string => typeof v === "string") : []) {
      jsonBySku.set(s, [...(jsonBySku.get(s) ?? []), p.slug]);
      if (!tableSkus.has(s)) jsonNotInTable.push(`${s} (${p.slug})`);
    }

    const problems: string[] = [];
    if (p.minGrams % p.stepGrams !== 0) problems.push("min is not a multiple of step");
    if (p.maxGrams < p.minGrams) problems.push("max < min");
    if (p.sellingUnit !== "KG" && [p.stepGrams, p.minGrams, p.maxGrams].some((v) => v % UNIT_QUANTITY !== 0)) problems.push(`${p.sellingUnit} product with fractional unit quantities`);
    if (p.bundleItems != null && p.sellingUnit !== "PACKAGE") problems.push("bundle not sold per PACKAGE");
    if (p.isAvailable && !hasConfirmedPrice(p)) problems.push("available without a confirmed price (not purchasable)");
    if (p.isAvailable && p.status !== "ACTIVE") problems.push(`available but ${p.status.toLowerCase()} (not purchasable)`);
    if (p.priceConfirmed && p.pricePerKgCents <= 0) problems.push("price marked confirmed but is 0");
    if (p.isHidden !== (p.status !== "ACTIVE")) problems.push("isHidden contradicts status");
    if (problems.length) inconsistent.push({ slug: p.slug, problems });

    if (p.bundleItems != null) {
      const bp: string[] = [];
      const items = parseBundleItems(p.bundleItems);
      if (!items) bp.push("contents invalid or empty");
      else {
        for (const i of items) if (i.productSlug && !slugs.has(i.productSlug)) bp.push(`component product missing: ${i.productSlug}`);
        if (items.some((i) => i.grams <= 0)) bp.push("non-positive component weight");
      }
      if (p.status === "ACTIVE" && !p.priceConfirmed) bp.push("published with unconfirmed price");
      if (bp.length) bundleProblems.push({ slug: p.slug, problems: bp });
    }
  }

  // Name collisions: report with evidence, never merge.
  const byName = new Map<string, typeof products>();
  for (const p of products) {
    const key = p.name.trim().toLowerCase().replace(/\s+/g, " ");
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }
  const nameGroups: NameGroup[] = [];
  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    const cats = new Set(group.map((g) => g.category.slug));
    const withSkus = group.filter((g) => g.supplierArticles.length);
    const kind: NameGroup["kind"] =
      group.some((g) => demo.has(g.category.slug)) ? "legacy-demo-overlap"
      : withSkus.length > 1 ? "different-supplier-skus"
      : cats.size === 1 ? "same-category-name-clash"
      : "cross-category-same-name";
    nameGroups.push({
      name,
      kind,
      products: group.map((g) => ({ id: g.id, slug: g.slug, category: g.category.slug, status: g.status, skus: g.supplierArticles.map((a) => a.supplierSku) })),
    });
  }

  const count = (f: (p: (typeof products)[number]) => boolean) => products.filter(f).length;
  const purchasable = (p: (typeof products)[number]) => p.status === "ACTIVE" && p.isAvailable && hasConfirmedPrice(p);
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      products: products.length,
      published: count((p) => p.status === "ACTIVE"),
      hidden: count((p) => p.isHidden),
      draft: count((p) => p.status === "DRAFT"),
      archived: count((p) => p.status === "ARCHIVED"),
      available: count((p) => p.isAvailable),
      unavailable: count((p) => !p.isAvailable),
      purchasable: count(purchasable),
    },
    kinds,
    missingValidPrice: products.filter((p) => !hasConfirmedPrice(p)).map((p) => p.slug),
    noImage: products.filter((p) => imageStatus(p.images) === "NONE").map((p) => p.slug),
    fallbackImageOnly: products.filter((p) => imageStatus(p.images) === "FALLBACK").map((p) => p.slug),
    noSupplierMapping: { total: Object.values(noMapping).reduce((a, b) => a + b, 0), byKind: noMapping },
    supplier: {
      articles: articleCount,
      legacyJsonSkus: jsonBySku.size,
      jsonNotInTable,
      ambiguousInJson: [...jsonBySku].filter(([, s]) => new Set(s).size > 1).map(([sku, s]) => ({ sku, slugs: [...new Set(s)] })),
      productsWithManySkus: count((p) => p.supplierArticles.length > 1),
    },
    nameGroups,
    emptyCategories: categories.filter((c) => c._count.products === 0).map((c) => c.slug),
    inconsistent,
    bundleProblems,
    referencedByOrders: count((p) => p._count.orderItems > 0),
  };
}

export function formatAuditReport(r: AuditReport): string {
  const list = (a: string[], n = 12) => (a.length ? `${a.slice(0, n).join(", ")}${a.length > n ? `, … (+${a.length - n})` : ""}` : "none");
  const t = r.totals;
  const out = [
    `Catalogue audit (read-only) · ${r.generatedAt}`,
    ``,
    `Products            total ${t.products} · published ${t.published} · hidden ${t.hidden} · draft ${t.draft} · archived ${t.archived}`,
    `Commercial          available ${t.available} · unavailable ${t.unavailable} · purchasable now ${t.purchasable}`,
    `Kinds               consumer ${r.kinds.consumer} · supplier-only ${r.kinds.supplierOnly} · equipment ${r.kinds.equipment} · bundles ${r.kinds.bundles} · preorder ${r.kinds.preorder} · legacy demo ${r.kinds.legacyDemo}`,
    `No valid price      ${r.missingValidPrice.length}`,
    `No image            ${r.noImage.length}${r.noImage.length ? ` (${list(r.noImage)})` : ""}`,
    `Fallback image only ${r.fallbackImageOnly.length}`,
    `No supplier mapping ${r.noSupplierMapping.total} ${JSON.stringify(r.noSupplierMapping.byKind)}`,
    `Referenced by orders ${r.referencedByOrders} product(s) (these can never be deleted)`,
    ``,
    `Supplier articles   ${r.supplier.articles} mapped in SupplierArticle · ${r.supplier.legacyJsonSkus} in legacy JSON · ${r.supplier.productsWithManySkus} product(s) with several SKUs`,
    `  legacy JSON not in table: ${list(r.supplier.jsonNotInTable)}`,
    `  ambiguous SKUs (under >1 product, NOT resolved): ${r.supplier.ambiguousInJson.length ? r.supplier.ambiguousInJson.map((a) => `${a.sku}→${a.slugs.join("|")}`).join(", ") : "none"}`,
    ``,
    `Name collisions     ${r.nameGroups.length} group(s) — review manually, nothing is merged`,
    ...r.nameGroups.map((g) => `  "${g.name}" [${g.kind}]: ${g.products.map((p) => `${p.slug}(${p.category},${p.status}${p.skus.length ? `,sku ${p.skus.join("/")}` : ""})`).join("  ")}`),
    ``,
    `Empty categories    ${list(r.emptyCategories)}`,
    `Inconsistent config ${r.inconsistent.length}`,
    ...r.inconsistent.slice(0, 40).map((i) => `  ${i.slug}: ${i.problems.join("; ")}`),
    ...(r.inconsistent.length > 40 ? [`  … (+${r.inconsistent.length - 40}; use --json for all)`] : []),
    `Bundle problems     ${r.bundleProblems.length}`,
    ...r.bundleProblems.map((b) => `  ${b.slug}: ${b.problems.join("; ")}`),
  ];
  return out.join("\n");
}
