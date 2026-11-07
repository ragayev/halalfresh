"use client";
import { useTransition } from "react";
import { Button } from "@/components/ui";
import { setBlockedCashAction } from "@/app/(admin)/admin/actions";

export function BlockCashButton({ customerId, blocked }: { customerId: string; blocked: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="secondary" size="sm" loading={pending} onClick={() => start(async () => void (await setBlockedCashAction(customerId, !blocked)))}>
      {blocked ? "Barzahlung freigeben" : "Barzahlung sperren"}
    </Button>
  );
}
