"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, SlidersHorizontal, ChevronDown } from "lucide-react";
import { useI18n } from "@/i18n/provider";

export function ShopControls({ count }: { count: number }) {
  const { d, locale, t } = useI18n();
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sp.get("focus") === "search") inputRef.current?.focus();
  }, [sp]);

  function push(patch: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    next.delete("focus");
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    start(() =>
      router.replace(`/${locale}/shop${next.size ? `?${next}` : ""}`, {
        scroll: false,
      }),
    );
  }

  useEffect(() => {
    if (q === (sp.get("q") ?? "")) return;
    const h = setTimeout(() => push({ q: q.trim() || null }), 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="space-y-3" aria-busy={pending}>
      <div className="relative">
        <Search className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={d.shop.searchPlaceholder}
          aria-label={d.shop.searchPlaceholder}
          className="h-12 w-full rounded-full border border-line/70 bg-white ps-12 pe-4 text-[15px] shadow-card focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <details className="relative">
            <summary className="inline-flex h-10 cursor-pointer list-none items-center gap-2 rounded-full bg-white px-5 text-sm font-bold shadow-card ring-1 ring-line/70 hover:bg-sage-soft [&::-webkit-details-marker]:hidden">
              <SlidersHorizontal className="size-4" aria-hidden />
              {d.shop.filters}
            </summary>
            <div className="absolute start-0 z-20 mt-2 w-64 rounded-2xl bg-white p-4 shadow-card ring-1 ring-line">
              <label className="flex cursor-pointer items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-5 accent-[#164b39]"
                  checked={sp.get("available") === "1"}
                  onChange={(e) => push({ available: e.target.checked ? "1" : null })}
                />
                {d.shop.inStockOnly}
              </label>
            </div>
          </details>
          <span className="text-sm text-muted" aria-live="polite">
            {t(d.shop.results, { count })}
          </span>
        </div>
        <label className="relative inline-flex items-center">
          <span className="sr-only">{d.shop.sort}</span>
          <select
            value={sp.get("sort") ?? "popular"}
            onChange={(e) =>
              push({
                sort: e.target.value === "popular" ? null : e.target.value,
              })
            }
            className="h-10 cursor-pointer appearance-none rounded-full bg-white py-0 ps-5 pe-10 text-sm font-bold shadow-card ring-1 ring-line/70 focus:outline-none focus:ring-2 focus:ring-forest"
          >
            <option value="popular">
              {d.shop.sort}: {d.shop.sortPopular}
            </option>
            <option value="price-asc">{d.shop.sortPriceAsc}</option>
            <option value="price-desc">{d.shop.sortPriceDesc}</option>
            <option value="name">{d.shop.sortName}</option>
          </select>
          <ChevronDown className="pointer-events-none absolute end-3 size-4 text-muted" aria-hidden />
        </label>
      </div>
    </div>
  );
}
