"use client";
import { useState, useTransition } from "react";
import { toggleProductAction } from "@/app/(admin)/admin/actions";

export function ToggleButton({
  id,
  field,
  value,
}: {
  id: string;
  field: "isAvailable" | "isFeatured" | "preorderEligible";
  value: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={field}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await toggleProductAction(id, field, !value);
          setError(r.ok ? null : (r.message ?? "Not allowed"));
        })
      }
      className={`relative h-6 w-11 rounded-full transition ${value ? "bg-forest" : "bg-neutral-300"} disabled:opacity-50`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${value ? "left-[22px]" : "left-0.5"}`} />
    </button>
    {error && (
      <span role="alert" className="mt-1 block max-w-48 text-xs text-danger">
        {error}
      </span>
    )}
    </>
  );
}
