"use client";
import { useState } from "react";
import { useI18n } from "@/i18n/provider";
import { isValidPostcode, normalizePostcode } from "@/domain/delivery";
import { useDelivery } from "./delivery-provider";

/** Compact postcode form for the trust section: saves the postcode and opens the gate to show the result. */
export function StandardsPostcode() {
  const { d } = useI18n();
  const { setPostcode, openGate } = useDelivery();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pc = normalizePostcode(value);
    if (!isValidPostcode(pc)) return setInvalid(true);
    setInvalid(false);
    openGate();
    await setPostcode(pc);
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10 sm:p-5">
      <label htmlFor="std-postcode" className="mb-3 block text-sm font-semibold">
        {d.home.stdPostcodeTitle}
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="std-postcode"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          dir="ltr"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setInvalid(false);
          }}
          placeholder={d.home.stdPostcodePh}
          aria-invalid={invalid || undefined}
          className="h-12 min-w-0 flex-1 rounded-xl bg-white px-4 text-base text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-[#f0c866]"
        />
        <button type="submit" className="h-12 rounded-xl bg-[#f0c866] px-5 font-semibold text-ink transition hover:brightness-95">
          {d.home.stdPostcodeCta}
        </button>
      </div>
      {invalid && (
        <p role="alert" className="mt-2 text-sm font-medium text-[#f0c866]">
          {d.delivery.invalid}
        </p>
      )}
    </form>
  );
}
