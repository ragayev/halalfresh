import { db } from "@/lib/db";
import { requireAdminApi } from "@/server/auth";
import { errorBody } from "@/server/errors";

/** CSV cell: quote, and neutralise spreadsheet formula injection (=, +, -, @ at the start). */
function cell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET() {
  try {
    await requireAdminApi();
  } catch (e) {
    const { status, body } = errorBody(e);
    return Response.json(body, { status });
  }
  const groups = await db.waitlistEntry.groupBy({
    by: ["postcode"],
    _count: { _all: true },
    _max: { createdAt: true },
    orderBy: [{ _count: { postcode: "desc" } }, { postcode: "asc" }],
  });
  const lines = [
    "postcode,signups,latest_signup",
    ...groups.map((g) => [cell(g.postcode), g._count._all, cell(g._max.createdAt?.toISOString().slice(0, 10) ?? "")].join(",")),
  ];
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="waitlist-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
