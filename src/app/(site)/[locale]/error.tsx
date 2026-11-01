"use client";
import { useI18n } from "@/i18n/provider";
import { Button } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const { d } = useI18n();
  return (
    <div className="mx-auto grid max-w-md place-items-center px-4 py-24 text-center">
      <h1 className="font-display text-3xl font-normal">{d.errors.errorTitle}</h1>
      <p className="mt-2 text-muted">{d.errors.errorText}</p>
      <Button size="lg" className="mt-6" onClick={reset}>
        {d.common.retry}
      </Button>
    </div>
  );
}
