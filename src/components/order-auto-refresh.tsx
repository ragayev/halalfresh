"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Polls the server (webhook-confirmed state) while payment is still pending. Redirect URLs never mark orders paid. */
export function OrderAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      router.refresh();
      if (++n >= 40) clearInterval(id);
    }, 2500);
    return () => clearInterval(id);
  }, [router]);
  return null;
}
