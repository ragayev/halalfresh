"use client";
import { useEffect, useState } from "react";
import type { CartViewLine } from "@/server/cart-view";
import type { Totals } from "@/domain/pricing";
import { useCart } from "./cart-store";
import { useI18n } from "@/i18n/provider";
import type { DeliveryCheck } from "@/domain/delivery";
import { useDelivery } from "./delivery-provider";

export interface CartViewData {
  lines: CartViewLine[];
  totals: Totals | null;
  delivery?: DeliveryCheck;
  merchant?: { name: string };
  hasIssues?: boolean;
}

/** Server-priced view of the local cart. Prices always come from the API, never from localStorage. */
export function useCartView() {
  const { lines, ready } = useCart();
  const { locale } = useI18n();
  const { hydrated, postcode } = useDelivery();
  const [data, setData] = useState<CartViewData | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify([lines, postcode]);

  useEffect(() => {
    if (!ready || !hydrated) return;
    if (!lines.length) return;
    const ctrl = new AbortController();
    const h = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/cart/price", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ locale, lines, postcode: postcode ?? undefined }),
          signal: ctrl.signal,
        });
        if (!r.ok) throw new Error();
        setData(await r.json());
        setError(false);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(true);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 150);
    return () => {
      clearTimeout(h);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, hydrated, locale]);

  // An empty cart needs no server round trip.
  const empty = ready && lines.length === 0;
  return {
    data: empty ? ({ lines: [], totals: null } as CartViewData) : data,
    error,
    loading: empty ? false : loading || !ready || !hydrated,
  };
}
