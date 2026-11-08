"use client";
import { useActionState } from "react";
import { Button, Textarea } from "@/components/ui";
import { applyCsvAction, previewCsvAction, type CsvPreview } from "@/app/(admin)/admin/actions";

export function CsvImport() {
  const [preview, previewAction, previewing] = useActionState<CsvPreview | null, FormData>(previewCsvAction, null);
  const [applied, applyAction, applying] = useActionState<CsvPreview | null, FormData>(applyCsvAction, null);
  const plan = (applied ?? preview)?.plan;
  const msg = applied?.message ?? preview?.message;
  const canApply = !!preview?.ok && !applied?.ok;
  return (
    <form className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="file" className="block text-sm font-medium">CSV file (UTF-8, “,” or “;” separated)</label>
        <input id="file" name="file" type="file" accept=".csv,text/csv" className="text-sm" />
        <label htmlFor="text" className="block text-sm font-medium">…or paste the content</label>
        <Textarea id="text" name="text" rows={6} className="font-mono text-xs" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" formAction={previewAction} loading={previewing} variant="secondary">
          Preview (no changes)
        </Button>
        <Button type="submit" formAction={applyAction} loading={applying} disabled={!canApply}>
          Apply changes
        </Button>
        {msg && (
          <p role={(applied ?? preview)?.ok ? "status" : "alert"} className={`text-sm font-medium ${(applied ?? preview)?.ok ? "text-forest" : "text-danger"}`}>
            {msg}
          </p>
        )}
      </div>
      {plan && plan.rows.length > 0 && (
        <div className="overflow-x-auto">
          <p className="mb-2 text-sm">
            {plan.counts.update} to update · {plan.counts.skip} unchanged · {plan.counts.reject} rejected · 0 created (this import never creates products)
          </p>
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase text-muted">
              <tr><th className="px-3 py-2">Line</th><th className="px-3 py-2">Product</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Details</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {plan.rows.map((r) => (
                <tr key={r.line}>
                  <td className="px-3 py-2 tabular-nums">{r.line}</td>
                  <td className="px-3 py-2">{r.name ?? r.id}</td>
                  <td className={`px-3 py-2 font-medium ${r.action === "reject" ? "text-danger" : r.action === "update" ? "text-forest" : "text-muted"}`}>{r.action}</td>
                  <td className="px-3 py-2 text-muted">{r.notes.join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </form>
  );
}
