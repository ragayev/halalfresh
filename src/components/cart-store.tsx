"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { useI18n } from "@/i18n/provider";

export interface CartLine {
  productId: string;
  grams: number;
}
interface Ctx {
  lines: CartLine[];
  ready: boolean;
  count: number;
  gramsOf: (id: string) => number;
  add: (p: { id: string; stepGrams: number; minGrams: number; maxGrams: number }, grams?: number) => void;
  setGrams: (id: string, grams: number) => void;
  /** Atomic relative change; removes the line when it would drop below `minGrams`. */
  change: (id: string, delta: number, minGrams: number, maxGrams: number) => void;
  remove: (id: string) => void;
  clear: () => void;
}

const KEY = "hf_cart_v1";
const CartCtx = createContext<Ctx | null>(null);

function read(): CartLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((l) => l && typeof l.productId === "string" && Number.isInteger(l.grams) && l.grams > 0).slice(0, 50);
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { d } = useI18n();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Latest lines, updated synchronously so rapid taps never act on a stale render.
  const ref = useRef<CartLine[]>([]);

  useEffect(() => {
    ref.current = read();
    setLines(ref.current);
    setReady(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) {
        ref.current = read();
        setLines(ref.current);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const commit = useCallback((next: CartLine[]) => {
    ref.current = next;
    setLines(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: cart lives in memory only */
    }
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      lines,
      ready,
      count: lines.length,
      gramsOf: (id) => lines.find((l) => l.productId === id)?.grams ?? 0,
      add: (p, grams) => {
        const lines = ref.current;
        const cur = lines.find((l) => l.productId === p.id);
        const next = Math.min(p.maxGrams, grams ?? (cur ? cur.grams + p.stepGrams : p.minGrams));
        commit(cur ? lines.map((l) => (l.productId === p.id ? { ...l, grams: next } : l)) : [...lines, { productId: p.id, grams: next }]);
        setToast((n) => n + 1);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setToast(0), 1800);
      },
      setGrams: (id, grams) => commit(ref.current.map((l) => (l.productId === id ? { ...l, grams } : l))),
      change: (id, delta, minGrams, maxGrams) => {
        const cur = ref.current.find((l) => l.productId === id);
        if (!cur) return;
        const next = cur.grams + delta;
        commit(
          next < minGrams
            ? ref.current.filter((l) => l.productId !== id)
            : ref.current.map((l) => (l.productId === id ? { ...l, grams: Math.min(maxGrams, next) } : l)),
        );
      },
      remove: (id) => commit(ref.current.filter((l) => l.productId !== id)),
      clear: () => commit([]),
    }),
    [lines, ready, commit],
  );

  return (
    <CartCtx.Provider value={value}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 lg:bottom-8">
        {toast > 0 && (
          <div
            key={toast}
            className="toast-in fixed left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-forest-dark px-4 py-2.5 text-sm font-medium text-white shadow-lg"
          >
            <Check className="size-4" aria-hidden /> {d.common.added}
          </div>
        )}
      </div>
    </CartCtx.Provider>
  );
}

export function useCart() {
  const c = useContext(CartCtx);
  if (!c) throw new Error("useCart outside provider");
  return c;
}
