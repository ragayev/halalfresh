import { requireAdmin } from "@/server/auth";
import { exportProductsCsv } from "@/server/catalog-csv";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await requireAdmin();
  const sp = new URL(req.url).searchParams;
  const csv = await exportProductsCsv({
    q: sp.get("q") ?? undefined,
    sku: sp.get("sku") ?? undefined,
    category: sp.get("category") ?? undefined,
    status: (["DRAFT", "ACTIVE", "ARCHIVED"] as const).find((s) => s === sp.get("status")),
    availability: sp.get("availability") === "available" || sp.get("availability") === "unavailable" ? (sp.get("availability") as "available" | "unavailable") : undefined,
    missingImage: sp.get("missingImage") === "1",
    missingPrice: sp.get("missingPrice") === "1",
  });
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="halalfresh-products-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
