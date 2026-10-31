"use client";
import { useState } from "react";
import { ArrowRight, CheckCircle2, MapPin, XCircle } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { isValidPostcode, normalizePostcode } from "@/domain/delivery";
import { Spinner } from "./spinner";

export function PostcodeChecker() {
  const { d, t } = useI18n();
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ok" | "no" | "invalid" | "error">("idle");
  const [checked, setChecked] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pc = normalizePostcode(value);
    if (!isValidPostcode(pc)) return setState("invalid");
    setState("loading");
    try {
      const r = await fetch("/api/delivery/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postcode: pc }),
      });
      if (!r.ok) throw new Error();
      const j = await r.json();
      setChecked(pc);
      setState(j.supported ? "ok" : "no");
    } catch {
      setState("error");
    }
  }

  return (
    <form onSubmit={submit} className="rounded-[var(--radius-card)] bg-white p-4 shadow-card ring-1 ring-line/70" noValidate>
      <label htmlFor="postcode" className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
        <MapPin className="size-4 text-forest" aria-hidden />
        {d.home.postcodeLabel}
      </label>
      <div className="flex gap-2">
        <input
          id="postcode"
          name="postcode"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          placeholder={d.home.postcodePlaceholder}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setState("idle");
          }}
          aria-describedby="postcode-result"
          className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-cream px-4 text-base focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20"
        />
        <button
          type="submit"
          aria-label={d.home.check}
          className="inline-flex h-12 min-w-12 items-center justify-center gap-2 rounded-xl bg-forest px-4 font-semibold text-white transition hover:bg-forest-dark"
        >
          {state === "loading" ? (
            <Spinner />
          ) : (
            <>
              <span className="hidden sm:inline">{d.home.check}</span>
              <ArrowRight className="size-5" aria-hidden />
            </>
          )}
        </button>
      </div>
      <p id="postcode-result" role="status" className="mt-2 min-h-5 text-sm">
        {state === "ok" && (
          <span className="inline-flex items-start gap-1.5 font-medium text-forest">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t(d.home.postcodeOk, { postcode: checked })}
          </span>
        )}
        {state === "no" && (
          <span className="inline-flex items-start gap-1.5 font-medium text-warn-ink">
            <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t(d.home.postcodeNo, { postcode: checked })}
          </span>
        )}
        {state === "invalid" && <span className="font-medium text-danger">{d.home.postcodeInvalid}</span>}
        {state === "error" && <span className="font-medium text-danger">{d.common.networkError}</span>}
      </p>
    </form>
  );
}
