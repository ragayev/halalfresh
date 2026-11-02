"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { pollIntervalMs } from "@/domain/order-state";
import type { FulfillmentStatus, PaymentStatus } from "@prisma/client";

interface Snapshot {
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  version: number;
}

/**
 * Lightweight tracking poll. Asks a tiny JSON endpoint (statuses only) and re-renders the page only when something
 * changed. Pauses in background tabs, backs off after errors, and stops for good in terminal states. Redirect URLs
 * never mark orders paid: only the webhook-confirmed server state is shown.
 */
export function OrderAutoRefresh({
  token,
  paymentStatus,
  fulfillmentStatus,
  version,
  redirectedFromCheckout = false,
}: Snapshot & {
  token: string;
  redirectedFromCheckout?: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: Snapshot = { paymentStatus, fulfillmentStatus, version };
    let failures = 0;
    let redirectChecks = 0;

    const schedule = () => {
      if (stopped) return;
      const base = pollIntervalMs(current, { redirectedFromCheckout: redirectedFromCheckout && redirectChecks < 30 });
      if (base === null) return; // terminal: nothing left to wait for
      timer = setTimeout(tick, Math.min(base * 2 ** failures, 5 * 60_000));
    };
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "hidden") return; // resumed by the visibilitychange listener
      redirectChecks++;
      try {
        const res = await fetch(`/api/order/${encodeURIComponent(token)}/status`, { cache: "no-store", credentials: "omit" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as Snapshot;
        failures = 0;
        if (next.version !== current.version) {
          current = next;
          router.refresh();
        }
      } catch {
        failures = Math.min(failures + 1, 4);
      }
      schedule();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && !stopped) {
        clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, token, paymentStatus, fulfillmentStatus, version, redirectedFromCheckout]);
  return null;
}
