"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isValidPostcode, normalizePostcode, type DeliveryCheck } from "@/domain/delivery";

export const POSTCODE_KEY = "hf_postcode";

type Status = "idle" | "loading" | "ready" | "error";
interface Ctx {
  /** false until localStorage/cookie were read (avoid flashing the gate). */
  hydrated: boolean;
  postcode: string | null;
  check: DeliveryCheck | null;
  status: Status;
  gateOpen: boolean;
  openGate: () => void;
  closeGate: () => void;
  /** Validate, persist and look up. Resolves with the result (null on network error / invalid). */
  setPostcode: (pc: string) => Promise<DeliveryCheck | null>;
}
const DeliveryContext = createContext<Ctx | null>(null);

function persist(pc: string) {
  try {
    localStorage.setItem(POSTCODE_KEY, pc);
  } catch {}
  // Cookie lets server-rendered pages (shop) hide products a preorder-only area cannot order. Not used for tracking.
  document.cookie = `${POSTCODE_KEY}=${pc}; path=/; max-age=31536000; samesite=lax`;
}

function readStored(): string | null {
  try {
    const v = localStorage.getItem(POSTCODE_KEY);
    if (v && isValidPostcode(v)) return v;
  } catch {}
  const m = document.cookie.match(new RegExp(`(?:^|; )${POSTCODE_KEY}=(\\d{5})`));
  return m ? m[1] : null;
}

export async function fetchCheck(pc: string, signal?: AbortSignal): Promise<DeliveryCheck> {
  const r = await fetch(`/api/delivery/check?postcode=${encodeURIComponent(pc)}`, { signal, cache: "no-store" });
  if (!r.ok) throw new Error("check failed");
  return r.json();
}

export function DeliveryProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [hydrated, setHydrated] = useState(false);
  const [postcode, setPc] = useState<string | null>(null);
  const [check, setCheck] = useState<DeliveryCheck | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [gateOpen, setGateOpen] = useState(false);
  const latest = useRef(0);

  const run = useCallback(async (pc: string) => {
    const id = ++latest.current;
    setStatus("loading");
    try {
      const c = await fetchCheck(pc);
      if (id !== latest.current) return c;
      setCheck(c);
      setStatus("ready");
      return c;
    } catch {
      if (id === latest.current) setStatus("error");
      return null;
    }
  }, []);

  // localStorage/cookie are only readable in the browser, so the stored postcode is loaded after mount.
  useEffect(() => {
    const stored = readStored();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
    if (stored) {
      setPc(stored);
      void run(stored);
    } else setGateOpen(true);
  }, [run]);

  const setPostcode = useCallback(
    async (raw: string) => {
      const pc = normalizePostcode(raw);
      if (!isValidPostcode(pc)) return null;
      setPc(pc);
      persist(pc);
      return run(pc);
    },
    [run],
  );

  // The gate must never trap legal pages (the waitlist consent links to the privacy policy).
  const onLegal = /^\/[a-z]{2}\/legal\//.test(pathname ?? "");
  const value = useMemo<Ctx>(
    () => ({
      hydrated,
      postcode,
      check,
      status,
      gateOpen: gateOpen && !onLegal,
      openGate: () => setGateOpen(true),
      closeGate: () => setGateOpen(false),
      setPostcode,
    }),
    [hydrated, postcode, check, status, gateOpen, onLegal, setPostcode],
  );
  return <DeliveryContext.Provider value={value}>{children}</DeliveryContext.Provider>;
}

export function useDelivery() {
  const c = useContext(DeliveryContext);
  if (!c) throw new Error("useDelivery outside provider");
  return c;
}
