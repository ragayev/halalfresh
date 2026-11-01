"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, MapPin, PackageOpen, Truck, X } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/config";
import { isValidPostcode, normalizePostcode, type DeliveryCheck } from "@/domain/delivery";
import { formatMoney } from "@/domain/money";
import { formatCutoff, slotParts } from "@/lib/format-delivery";
import { useDelivery } from "./delivery-provider";
import { Spinner } from "./spinner";
import { Button, Input } from "./ui";

/** Next concrete delivery date + terms for a supported postcode. */
export function DeliveryInfo({ check }: { check: DeliveryCheck }) {
  const { d, locale, t } = useI18n();
  const money = (c: number) => formatMoney(c, locale);
  const slot = check.nextSlot;
  return (
    <div className="space-y-3 rounded-2xl bg-sage p-4 text-forest-dark" data-testid="delivery-info">
      <p className="flex items-center gap-2 font-semibold">
        <CheckCircle2 className="size-5 shrink-0" aria-hidden />
        {t(d.delivery.supportedTitle, { postcode: check.postcode })}
        {check.mode === "PREORDER_ONLY" && (
          <span className="rounded-full bg-warn px-2 py-0.5 text-xs font-semibold text-warn-ink">{d.delivery.preorderBadge}</span>
        )}
      </p>
      {slot ? (
        <div className="flex items-start gap-3">
          <CalendarClock className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide opacity-70">{d.delivery.nextDelivery}</p>
            <p className="text-base font-bold" data-testid="next-slot">
              {t(d.delivery.slotLine, slotParts(slot, locale))}
            </p>
            <p className="text-xs opacity-80">{t(d.delivery.orderBy, { cutoff: formatCutoff(slot.cutoffAt, locale) })}</p>
          </div>
        </div>
      ) : (
        <p className="text-sm font-medium text-warn-ink">{d.delivery.noSlot}</p>
      )}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <li className="inline-flex items-center gap-1.5">
          <PackageOpen className="size-4" aria-hidden />
          {t(d.delivery.minOrder, { amount: money(check.minOrderCents) })}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <Truck className="size-4" aria-hidden />
          {check.deliveryFeeCents === 0 ? d.delivery.freeDelivery : t(d.delivery.feeLine, { amount: money(check.deliveryFeeCents) })}
        </li>
        {check.freeDeliveryThresholdCents != null && check.deliveryFeeCents > 0 && (
          <li>{t(d.delivery.freeFrom, { amount: money(check.freeDeliveryThresholdCents) })}</li>
        )}
      </ul>
      {check.mode === "PREORDER_ONLY" && (
        <div className="rounded-xl bg-white/70 p-3 text-sm">
          <p className="font-semibold">{d.delivery.preorderTitle}</p>
          <p>{d.delivery.preorderText}</p>
        </div>
      )}
    </div>
  );
}

export function WaitlistForm({ postcode }: { postcode: string }) {
  const { d, locale, t } = useI18n();
  const [f, setF] = useState({ name: "", contact: "", lang: locale as Locale });
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!consent) return setErr(d.delivery.waitlistConsentRequired);
    if (f.name.trim().length < 2 || f.contact.trim().length < 5) return setErr(d.delivery.waitlistInvalid);
    setErr("");
    setState("sending");
    try {
      const r = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postcode, name: f.name, contact: f.contact, preferredLanguage: f.lang, consent: true }),
      });
      if (r.status === 400) {
        setErr(d.delivery.waitlistInvalid);
        return setState("idle");
      }
      setState(r.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done")
    return (
      <p role="status" className="flex items-start gap-2 rounded-xl bg-sage p-3 text-sm font-medium text-forest-dark">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t(d.delivery.waitlistThanks, { postcode })}
      </p>
    );

  const privacy = (
    <Link href={`/${locale}/legal/privacy`} target="_blank" className="font-semibold underline underline-offset-2">
      {d.delivery.waitlistPrivacy}
    </Link>
  );
  const [before, after] = d.delivery.waitlistConsent.split("{privacy}");
  return (
    <form onSubmit={submit} noValidate className="space-y-3" data-testid="waitlist-form">
      <h3 className="font-semibold">{d.delivery.waitlistTitle}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{d.delivery.waitlistName}</span>
          <Input name="name" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{d.delivery.waitlistContact}</span>
          <Input name="contact" autoComplete="email" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">{d.delivery.waitlistLanguage}</span>
        <select
          value={f.lang}
          onChange={(e) => setF({ ...f, lang: e.target.value as Locale })}
          className="h-12 w-full rounded-xl border border-line bg-white px-3 text-base"
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_LABELS[l]}
            </option>
          ))}
        </select>
      </label>
      {/* DSGVO: explicit, unticked by default, with a link to the privacy policy. */}
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="consent"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-[#164b39]"
        />
        <span>
          {before}
          {privacy}
          {after}
        </span>
      </label>
      {(err || state === "error") && (
        <p role="alert" className="text-sm font-medium text-danger">
          {err || d.delivery.waitlistError}
        </p>
      )}
      <Button type="submit" loading={state === "sending"}>
        {d.delivery.waitlistSubmit}
      </Button>
    </form>
  );
}

/** Never a bare "no delivery": explains, offers preorders if any exist, and collects the waitlist. */
export function UnsupportedNotice({ check }: { check: DeliveryCheck }) {
  const { d, locale, t } = useI18n();
  return (
    <div className="space-y-4 rounded-2xl bg-warn p-4 text-warn-ink" data-testid="unsupported">
      <div>
        <p className="font-semibold">{t(d.delivery.unsupportedTitle, { postcode: check.postcode })}</p>
        <p className="mt-1 text-sm">{d.delivery.unsupportedText}</p>
      </div>
      {check.preorderProductsAvailable && (
        <p className="text-sm">
          {d.delivery.preorderOffer}{" "}
          <Link href={`/${locale}/shop?preorder=1`} className="font-semibold underline underline-offset-2">
            {d.delivery.preorderShop}
          </Link>
        </p>
      )}
      <div className="rounded-xl bg-white p-4 text-ink">
        <WaitlistForm postcode={check.postcode} />
      </div>
    </div>
  );
}

/** Postcode input + result. Used on the homepage and inside the gate. */
export function PostcodePanel({ onResolved, autoFocus }: { onResolved?: (c: DeliveryCheck) => void; autoFocus?: boolean }) {
  const { d } = useI18n();
  const { postcode, check, status, setPostcode } = useDelivery();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const seeded = useRef(false);
  const id = useId();

  // Show the stored postcode once it is known (but never overwrite what the user is typing).
  useEffect(() => {
    if (postcode && !seeded.current) {
      seeded.current = true;
      setValue(postcode);
    }
  }, [postcode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pc = normalizePostcode(value);
    if (!isValidPostcode(pc)) return setInvalid(true);
    setInvalid(false);
    const c = await setPostcode(pc);
    if (c) onResolved?.(c);
  }

  const shown = check && check.postcode === postcode ? check : null;
  return (
    <div className="space-y-3">
      <form onSubmit={submit} noValidate>
        <label htmlFor={id} className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
          <MapPin className="size-4 text-forest" aria-hidden />
          {d.delivery.label}
        </label>
        <div className="flex gap-2">
          <input
            id={id}
            name="postcode"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            autoFocus={autoFocus}
            dir="ltr"
            placeholder={d.delivery.placeholder}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setInvalid(false);
            }}
            aria-describedby={`${id}-result`}
            className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-cream px-4 text-base focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20"
          />
          <button
            type="submit"
            aria-label={d.delivery.check}
            className="inline-flex h-12 min-w-12 items-center justify-center gap-2 rounded-xl bg-forest px-4 font-semibold text-white transition hover:bg-forest-dark"
          >
            {status === "loading" ? (
              <Spinner />
            ) : (
              <>
                <span className="hidden sm:inline">{d.delivery.check}</span>
                <ArrowRight className="size-5 rtl:rotate-180" aria-hidden />
              </>
            )}
          </button>
        </div>
      </form>
      <div id={`${id}-result`} role="status" className="min-h-5 text-sm">
        {invalid && <p className="font-medium text-danger">{d.delivery.invalid}</p>}
        {status === "error" && <p className="font-medium text-danger">{d.common.networkError}</p>}
        {!invalid && shown && (shown.supported ? <DeliveryInfo check={shown} /> : <UnsupportedNotice check={shown} />)}
      </div>
    </div>
  );
}

/** First-open modal. Required until a postcode exists; afterwards it doubles as "change postcode". */
export function PostcodeGate() {
  const { d } = useI18n();
  const { hydrated, gateOpen, postcode, closeGate } = useDelivery();
  const closable = !!postcode;

  useEffect(() => {
    if (!gateOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closable && closeGate();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [gateOpen, closable, closeGate]);

  if (!hydrated || !gateOpen) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" data-testid="postcode-gate">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gate-title"
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="gate-title" className="font-display text-2xl font-semibold">
              {d.delivery.gateTitle}
            </h2>
            <p className="mt-1 text-sm text-muted">{d.delivery.gateText}</p>
          </div>
          {closable && (
            <button
              type="button"
              onClick={closeGate}
              aria-label={d.delivery.close}
              className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-sage"
            >
              <X className="size-5" aria-hidden />
            </button>
          )}
        </div>
        <PostcodePanel autoFocus />
        {closable && (
          <Button type="button" full className="mt-4" onClick={closeGate}>
            {d.delivery.continue}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Header chip: current postcode, click to change. */
export function PostcodeChip() {
  const { d, t } = useI18n();
  const { hydrated, postcode, check, openGate } = useDelivery();
  if (!hydrated) return <span className="h-11 w-28" aria-hidden />;
  const unsupported = !!postcode && check?.postcode === postcode && !check.supported;
  const label = !postcode ? d.delivery.chipEmpty : t(unsupported ? d.delivery.chipNo : d.delivery.chip, { postcode });
  return (
    <button
      type="button"
      onClick={openGate}
      aria-label={postcode ? `${label} — ${d.delivery.change}` : label}
      className="inline-flex h-11 max-w-[11rem] shrink-0 items-center gap-1.5 rounded-full px-2 text-sm font-semibold hover:bg-sage sm:px-3"
      data-testid="postcode-chip"
    >
      <MapPin className={`size-4 shrink-0 ${unsupported ? "text-warn-ink" : "text-forest"}`} aria-hidden />
      {/* Phones: just the postcode (the header is tight); sm+: full sentence. */}
      <span className="truncate sm:hidden">{postcode ?? ""}</span>
      <span className="hidden truncate sm:inline">{label}</span>
    </button>
  );
}
