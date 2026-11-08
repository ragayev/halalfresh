"use client";
import { useState, useTransition } from "react";
import { setProductStatusAction } from "@/app/(admin)/admin/actions";
import { PRODUCT_STATUSES, type ProductStatus } from "@/domain/product-rules";

export function StatusSelect({ id, value }: { id: string; value: ProductStatus }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <select
        aria-label="Publishing status"
        value={value}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            const r = await setProductStatusAction(id, e.target.value);
            setError(r.ok ? null : (r.message ?? "Not allowed"));
          })
        }
        className="h-9 rounded-lg border border-line bg-white px-2 text-sm disabled:opacity-50"
      >
        {PRODUCT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="mt-1 block max-w-48 text-xs text-danger">
          {error}
        </span>
      )}
    </>
  );
}
