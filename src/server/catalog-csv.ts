import { db } from "@/lib/db";
import { parseCsv, toCsv } from "@/domain/csv";
import { parsePriceToCents } from "@/domain/money";
import { audit } from "./orders";
import { adminWhere, type AdminProductFilters } from "./product-service";
import { AppError } from "./errors";
import { availabilityError, hasConfirmedPrice } from "@/domain/product-rules";

/**
 * CSV exchange for prices and availability. Identity is the immutable product `id`; nothing else in a row can change a
 * product. Import is two steps: `planCsvImport` (pure read, shows create/update/skip/reject) and `applyCsvImport`
 * (re-plans on the server from the same text, then writes in one transaction).
 */
export const CSV_HEADER = ["id", "slug", "name", "supplier_skus", "category", "status", "unit", "price_eur", "price_confirmed", "available"] as const;

export async function exportProductsCsv(filters: AdminProductFilters = {}): Promise<string> {
  const rows = await db.product.findMany({
    where: adminWhere(filters),
    include: { category: { select: { slug: true } }, supplierArticles: { select: { supplierSku: true }, orderBy: { supplierSku: "asc" } } },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
  });
  return toCsv([
    [...CSV_HEADER],
    ...rows.map((p) => [
      p.id, p.slug, p.name, p.supplierArticles.map((s) => s.supplierSku).join(" "), p.category.slug, p.status, p.sellingUnit,
      `${Math.floor(p.pricePerKgCents / 100)},${String(p.pricePerKgCents % 100).padStart(2, "0")}`,
      p.priceConfirmed ? "yes" : "no", p.isAvailable ? "yes" : "no",
    ]),
  ]);
}

export type RowAction = "update" | "skip" | "reject";
export interface PlannedRow {
  line: number;
  id: string;
  name?: string;
  action: RowAction;
  /** Human-readable change list, or the rejection reason. */
  notes: string[];
  patch?: { priceCents?: number; priceConfirmed?: boolean; isAvailable?: boolean };
}
export interface CsvPlan {
  rows: PlannedRow[];
  counts: Record<RowAction, number>;
  errors: string[];
}

const yes = (v: string) => ["yes", "ja", "evet", "true", "1", "x"].includes(v.trim().toLowerCase());
const no = (v: string) => ["no", "nein", "hayir", "hayır", "false", "0", ""].includes(v.trim().toLowerCase());

export async function planCsvImport(text: string): Promise<CsvPlan> {
  const table = parseCsv(text);
  const errors: string[] = [];
  if (table.length < 2) return { rows: [], counts: { update: 0, skip: 0, reject: 0 }, errors: ["The file has no data rows"] };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = (n: string) => header.indexOf(n);
  if (col("id") < 0) errors.push('Missing required column "id"');
  const known = ["price_eur", "price_confirmed", "available"].filter((c) => col(c) >= 0);
  if (!known.length) errors.push('Nothing to import: add at least one of "price_eur", "price_confirmed", "available"');
  if (errors.length) return { rows: [], counts: { update: 0, skip: 0, reject: 0 }, errors };

  const ids = table.slice(1).map((r) => (r[col("id")] ?? "").trim()).filter(Boolean);
  const products = await db.product.findMany({ where: { id: { in: ids } } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const rows: PlannedRow[] = [];
  for (const [i, r] of table.slice(1).entries()) {
    const line = i + 2;
    const id = (r[col("id")] ?? "").trim();
    const reject = (why: string, name?: string): void => void rows.push({ line, id, name, action: "reject", notes: [why] });
    if (!id) { reject("Empty id"); continue; }
    if (seen.has(id)) { reject("Duplicate id in file"); continue; }
    seen.add(id);
    const p = byId.get(id);
    if (!p) { reject("Unknown product id (this import never creates products)"); continue; }

    const patch: NonNullable<PlannedRow["patch"]> = {};
    const notes: string[] = [];
    let bad: string | null = null;
    if (col("price_eur") >= 0 && (r[col("price_eur")] ?? "").trim() !== "") {
      const cents = parsePriceToCents(r[col("price_eur")]);
      if (cents == null || cents > 10_000_000) bad = `Invalid price "${r[col("price_eur")]}"`;
      else if (cents !== p.pricePerKgCents) {
        patch.priceCents = cents;
        notes.push(`price ${p.pricePerKgCents} → ${cents} cents`);
      }
    }
    if (col("price_confirmed") >= 0 && (r[col("price_confirmed")] ?? "").trim() !== "") {
      const v = r[col("price_confirmed")];
      if (!yes(v) && !no(v)) bad = `Invalid price_confirmed "${v}" (use yes/no)`;
      else if (yes(v) !== p.priceConfirmed) {
        patch.priceConfirmed = yes(v);
        notes.push(`price_confirmed ${p.priceConfirmed} → ${yes(v)}`);
      }
    }
    if (col("available") >= 0 && (r[col("available")] ?? "").trim() !== "") {
      const v = r[col("available")];
      if (!yes(v) && !no(v)) bad = `Invalid available "${v}" (use yes/no)`;
      else if (yes(v) !== p.isAvailable) {
        patch.isAvailable = yes(v);
        notes.push(`available ${p.isAvailable} → ${yes(v)}`);
      }
    }
    if (bad) { reject(bad, p.name); continue; }

    // Final state must obey the same rules as the admin UI.
    const priceCents = patch.priceCents ?? p.pricePerKgCents;
    const confirmed = patch.priceConfirmed ?? p.priceConfirmed;
    const available = patch.isAvailable ?? p.isAvailable;
    if (confirmed && priceCents <= 0) { reject("A price of 0 cannot be confirmed", p.name); continue; }
    const availErr = patch.isAvailable === true || (available && patch.priceConfirmed === false)
      ? availabilityError({ status: p.status, priceConfirmed: confirmed, pricePerKgCents: priceCents }, true)
      : null;
    if (availErr) { reject(availErr, p.name); continue; }
    if (p.bundleItems != null && patch.priceCents !== undefined && p.status === "ACTIVE" && !hasConfirmedPrice({ priceConfirmed: confirmed, pricePerKgCents: priceCents }))
      { reject("Bundle price must stay confirmed while published", p.name); continue; }

    rows.push({ line, id, name: p.name, action: notes.length ? "update" : "skip", notes: notes.length ? notes : ["no change"], patch });
  }
  const counts: Record<RowAction, number> = { update: 0, skip: 0, reject: 0 };
  for (const r of rows) counts[r.action]++;
  return { rows, counts, errors };
}

/** All-or-nothing: any rejected row aborts the import so the file can be fixed and re-submitted. */
export async function applyCsvImport(text: string, actor: string) {
  const plan = await planCsvImport(text);
  if (plan.errors.length) throw new AppError("VALIDATION", plan.errors.join("; "));
  if (plan.counts.reject) throw new AppError("VALIDATION", `${plan.counts.reject} row(s) rejected; fix the file and preview again`);
  const updates = plan.rows.filter((r) => r.action === "update");
  await db.$transaction(async (tx) => {
    for (const r of updates) {
      const p = await tx.product.findUniqueOrThrow({ where: { id: r.id } });
      const priceCents = r.patch?.priceCents ?? p.pricePerKgCents;
      const confirmed = r.patch?.priceConfirmed ?? p.priceConfirmed;
      const available = r.patch?.isAvailable ?? p.isAvailable;
      await tx.product.update({
        where: { id: r.id },
        data: { pricePerKgCents: priceCents, priceConfirmed: confirmed, isAvailable: confirmed ? available : false },
      });
    }
    await audit(actor, "product.csv.import", "Product", undefined, { updated: updates.length, ids: updates.map((u) => u.id) }, tx);
  });
  return plan;
}
