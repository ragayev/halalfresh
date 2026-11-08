import { BUNDLE_UNIT_GRAMS, parseBundleItems } from "./bundles";

/**
 * Product lifecycle and eligibility rules. Pure functions: every server path (storefront, cart, checkout, admin)
 * decides through these, never through ad-hoc flag checks.
 *
 * Four independent concepts:
 *  - status        publishing: DRAFT (not listed) · ACTIVE (listed) · ARCHIVED (retired, kept for old orders)
 *  - isAvailable   commercial: may be bought right now
 *  - priceConfirmed + price > 0   the price is real
 *  - preorderEligible   may be bought in preorder-only zones
 * `Product.isHidden` is a legacy mirror of `status !== ACTIVE`, kept in sync by the product service and enforced by a
 * CHECK constraint. Nothing should read it for decisions.
 */
export const PRODUCT_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export const SELLING_UNITS = ["KG", "PIECE", "PACKAGE"] as const;
export type SellingUnit = (typeof SELLING_UNITS)[number];

export interface EligibilityInput {
  status: ProductStatus;
  isAvailable: boolean;
  priceConfirmed: boolean;
  pricePerKgCents: number;
  bundleItems?: unknown;
}

/** A real, verified price. Seeded products start at 0 and must never be sold. */
export function hasConfirmedPrice(p: Pick<EligibilityInput, "priceConfirmed" | "pricePerKgCents">): boolean {
  return p.priceConfirmed && Number.isInteger(p.pricePerKgCents) && p.pricePerKgCents > 0;
}

/** Shown in the storefront (listing + detail page), possibly as "price coming soon". */
export function isListed(p: Pick<EligibilityInput, "status">): boolean {
  return p.status === "ACTIVE";
}

/** May enter a cart and pass checkout. Server-side truth. */
export function isPurchasable(p: EligibilityInput): boolean {
  if (!isListed(p) || !p.isAvailable || !hasConfirmedPrice(p)) return false;
  if (p.bundleItems != null && !parseBundleItems(p.bundleItems)) return false;
  return true;
}

export function purchaseBlocker(p: EligibilityInput): "NOT_LISTED" | "UNAVAILABLE" | "NO_PRICE" | "BAD_BUNDLE" | null {
  if (!isListed(p)) return "NOT_LISTED";
  if (!p.isAvailable) return "UNAVAILABLE";
  if (!hasConfirmedPrice(p)) return "NO_PRICE";
  if (p.bundleItems != null && !parseBundleItems(p.bundleItems)) return "BAD_BUNDLE";
  return null;
}

const TRANSITIONS: Record<ProductStatus, ProductStatus[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["DRAFT", "ARCHIVED"],
  // A retired product is restored as a draft first, then reviewed and published.
  ARCHIVED: ["DRAFT"],
};

export function canTransition(from: ProductStatus, to: ProductStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

/** Returns a human-readable reason when the change is not allowed, otherwise null. */
export function statusChangeError(p: EligibilityInput, to: ProductStatus): string | null {
  if (!canTransition(p.status, to)) return `Cannot move a ${p.status.toLowerCase()} product to ${to.toLowerCase()}`;
  if (to === "ACTIVE" && p.bundleItems != null && !hasConfirmedPrice(p))
    return "Confirm the butcher-approved bundle price before publishing it.";
  return null;
}

/** Availability may only be switched on for a listed-or-draft product with a confirmed price; archived never. */
export function availabilityError(p: Pick<EligibilityInput, "status" | "priceConfirmed" | "pricePerKgCents">, value: boolean): string | null {
  if (!value) return null;
  if (p.status === "ARCHIVED") return "Archived products cannot be made available.";
  if (!hasConfirmedPrice(p)) return "Set and confirm a price before making the product available.";
  return null;
}

/** Legacy mirror kept in sync with status. */
export const isHiddenFor = (status: ProductStatus): boolean => status !== "ACTIVE";

// ---- Selling units ----
// Quantities are integers in "grams". For KG that is real grams. For PIECE and PACKAGE one unit is BUNDLE_UNIT_GRAMS
// (1000) so the proven integer price maths (price * qty / 1000) is unchanged and `pricePerKgCents` is the price of one unit.
export const UNIT_QUANTITY = BUNDLE_UNIT_GRAMS;

export function unitsOf(unit: SellingUnit, quantity: number): number {
  return unit === "KG" ? quantity / 1000 : quantity / UNIT_QUANTITY;
}

export function quantityConfigError(unit: SellingUnit, c: { stepGrams: number; minGrams: number; maxGrams: number }): string | null {
  if (c.minGrams % c.stepGrams !== 0 || c.maxGrams < c.minGrams) return "Min must be a multiple of the step, and max ≥ min";
  if (unit !== "KG" && [c.stepGrams, c.minGrams, c.maxGrams].some((v) => v % UNIT_QUANTITY !== 0))
    return `Per-${unit.toLowerCase()} products must use whole units (step, min and max in multiples of ${UNIT_QUANTITY}).`;
  return null;
}

export function priceLabel(unit: SellingUnit): "kg" | "piece" | "package" {
  return unit === "KG" ? "kg" : unit === "PIECE" ? "piece" : "package";
}

// ---- Supplier SKUs ----
export const SUPPLIER_SKU_RE = /^[0-9A-Za-z][0-9A-Za-z._-]{2,31}$/;

export function normalizeSku(raw: string): string {
  return raw.trim();
}

export function isValidSku(raw: string): boolean {
  return SUPPLIER_SKU_RE.test(normalizeSku(raw));
}

/** SKUs that appear more than once in the input (after trimming). */
export function duplicateSkus(skus: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const s of skus.map(normalizeSku)) (seen.has(s) ? dup : seen).add(s);
  return [...dup];
}

// ---- Images ----
export const DEFAULT_PRODUCT_IMAGE = "/images/products/default-product.svg";

export interface ImageLike {
  url: string | null;
  isPlaceholder?: boolean;
}

export type ImageStatus = "NONE" | "FALLBACK" | "OK";

/** NONE: no image row · FALLBACK: only generic/illustrative placeholders · OK: at least one real image. */
export function imageStatus(images: ImageLike[]): ImageStatus {
  if (!images.length) return "NONE";
  return images.every((i) => i.isPlaceholder || i.url === DEFAULT_PRODUCT_IMAGE) ? "FALLBACK" : "OK";
}

export type ImageStorage = "static" | "database";
export const imageStorage = (i: { url: string | null }): ImageStorage => (i.url ? "static" : "database");
