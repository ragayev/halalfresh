"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, Lock, Truck } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { useCart } from "./cart-store";
import { useCartView } from "./use-cart-view";
import { MinOrderBanner } from "./cart-progress";
import { Button, Card, Checkbox, Container, Field, Input, Notice, SellerBox, Textarea, buttonClasses } from "./ui";
import { mvpCopy } from "@/content/mvp-copy";
import { formatMoney } from "@/domain/money";
import { formatQuantity } from "@/domain/bundles";
import { isValidPostcode, normalizePostcode } from "@/domain/delivery";
import { formatCutoff, formatSlotDay } from "@/lib/format-delivery";
import { useDelivery } from "./delivery-provider";
type Errors = Partial<Record<"firstName" | "lastName" | "email" | "phone" | "street" | "postalCode" | "city" | "slot" | "terms", string>>;

export function CheckoutForm() {
  const { d, locale, t } = useI18n();
  const { ready, lines: cartLines } = useCart();
  const lineBundle = new Map(cartLines.flatMap((l) => (l.bundleId ? [[l.productId, l.bundleId] as const] : [])));
  const { data, loading } = useCartView();
  const c = mvpCopy(locale);
  const [f, setF] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    street: "",
    postalCode: "",
    city: "",
    instructions: "",
  });
  const [terms, setTerms] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [chosen, setMethod] = useState<"PAYPAL" | "CASH">("PAYPAL");
  const [cashAllowed, setCashOk] = useState(false);
  // Derived: cash is only effective while the server says it is allowed for the phone currently typed.
  const cashOk = cashAllowed && f.phone.trim().length >= 6;
  const method = cashOk ? chosen : "PAYPAL";
  const { hydrated, postcode: savedPostcode, check, status, setPostcode } = useDelivery();
  const [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const requestId = useRef<string>(typeof crypto !== "undefined" ? crypto.randomUUID() : "");

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const pc = normalizePostcode(f.postalCode);

  // Cash is offered only when the server says so for this phone; the order endpoint re-checks.
  useEffect(() => {
    if (f.phone.trim().length < 6) return;
    const ctrl = new AbortController();
    const h = setTimeout(() => {
      fetch(`/api/checkout/cash?phone=${encodeURIComponent(f.phone)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { allowed: false }))
        .then((j) => setCashOk(!!j.allowed))
        .catch(() => undefined);
    }, 500);
    return () => (clearTimeout(h), ctrl.abort());
  }, [f.phone]);

  // Prefill the address postcode with the one the customer already checked.
  const seeded = useRef(false);
  useEffect(() => {
    if (hydrated && savedPostcode && !seeded.current) {
      seeded.current = true;
      setF((s) => ({ ...s, postalCode: savedPostcode }));
    }
  }, [hydrated, savedPostcode]);

  // The address postcode drives the delivery terms: if it differs from the checked one, re-run the check.
  useEffect(() => {
    if (!seeded.current || !isValidPostcode(pc) || pc === savedPostcode) return;
    void setPostcode(pc).then((c) => c && setNotice(t(d.delivery.postcodeUpdated, { postcode: pc })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pc]);

  // Terms only count for the postcode currently typed.
  const current = check && check.postcode === pc ? check : null;
  const checking = isValidPostcode(pc) && (!current || status === "loading");
  const estimate = current?.nextSlot ?? null;
  const [pickedDate, setDate] = useState<string | null>(null);
  const [pickedSlot, setSlotStart] = useState<string | null>(null);
  // A picked date that is no longer offered (cutoff passed, postcode changed) falls back to the earliest one.
  const dateOptions = current?.dates ?? [];
  const chosenDate = dateOptions.find((o) => o.date === pickedDate) ?? dateOptions[0] ?? null;
  const slotStart = pickedSlot ?? estimate?.slots[0].start ?? null;
  const pricedFor = data?.delivery?.postcode === pc;

  if (!ready || (loading && !data))
    return (
      <Container className="py-8">
        <div className="skeleton h-96 rounded-[var(--radius-card)]" />
      </Container>
    );
  if (!data || !data.lines.length) {
    return (
      <Container className="py-24 text-center">
        <p className="text-lg font-semibold">{d.checkout.emptyCart}</p>
        <Link href={`/${locale}/shop`} className={buttonClasses({ size: "lg" }) + " mt-5"}>
          {d.cart.browse}
        </Link>
      </Container>
    );
  }

  const totals = data.totals!;

  function validate(): Errors {
    const e: Errors = {};
    if (!f.firstName.trim()) e.firstName = d.checkout.required;
    if (!f.lastName.trim()) e.lastName = d.checkout.required;
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = d.checkout.invalidEmail;
    if (!/^\+?[\d\s()/-]{6,24}$/.test(f.phone.trim())) e.phone = d.checkout.invalidPhone;
    if (f.street.trim().length < 3) e.street = d.checkout.required;
    if (!isValidPostcode(pc)) e.postalCode = d.checkout.invalidPostcode;
    else if (current && !current.supported) e.postalCode = d.checkout.postcodeUnsupported;
    if (f.city.trim().length < 2) e.city = d.checkout.required;
    if (current?.supported && !estimate) e.slot = d.checkout.slotNone;
    if (current?.supported && (!pricedFor || data!.hasIssues)) e.slot = d.cart.updated;
    if (current?.supported && !totals.meetsMinimum) e.slot = t(d.checkout.belowMin, { amount: formatMoney(totals.minOrderCents, locale) });
    if (!terms) e.terms = c.termsRequired;
    return e;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setFormError("");
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      setFormError(d.checkout.fixErrors);
      const first = Object.keys(e)[0];
      document.getElementById(first === "terms" ? "terms" : first === "slot" ? "postalCode" : first)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: requestId.current,
          locale,
          lines: data!.lines.map((l) => ({
            productId: l.productId,
            grams: l.grams,
            bundleId: lineBundle.get(l.productId),
          })),
          customer: { firstName: f.firstName, lastName: f.lastName, email: f.email, phone: f.phone },
          address: { street: f.street, postalCode: pc, city: f.city },
          deliveryDate: chosenDate!.date,
          slotStart: slotStart!,
          checkedPostcode: pc,
          deliveryNotes: f.instructions || undefined,
          paymentMethod: method,
          consents: { terms: true, marketing, dataTransfer: false },
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        requestId.current = crypto.randomUUID();
        const code = j?.error?.code;
        if (code === "VALIDATION" && j.error.details) {
          const fe = j.error.details as Record<string, string[]>;
          setErrors({ firstName: fe.customer && d.checkout.required });
        }
        setFormError(
          code === "BELOW_MINIMUM"
            ? t(d.checkout.belowMin, {
                amount: formatMoney(totals.minOrderCents, locale),
              })
            : code === "POSTCODE_UNSUPPORTED"
              ? d.checkout.postcodeUnsupported
              : code === "POSTCODE_MISMATCH"
                ? d.delivery.postcodeUpdated.replace("{postcode}", pc)
                : code === "CHECKOUT_UNAVAILABLE"
                  ? d.checkout.unavailable
                  : code === "SLOT_INVALID"
                    ? d.checkout.slotNone
                    : code === "RATE_LIMITED" || code === "PRODUCT_UNAVAILABLE" || code === "INVALID_QUANTITY"
                      ? j.error.message
                      : d.checkout.payError,
        );
        setSubmitting(false);
        return;
      }
      window.location.assign(j.url); // private order page (/b/{token})
    } catch {
      setFormError(d.common.networkError);
      setSubmitting(false);
    }
  }

  const err = (k: keyof Errors) => errors[k];
  const dsc = (k: string) => (errors[k as keyof Errors] ? `${k}-err` : undefined);

  return (
    <Container className="py-6 sm:py-10">
      <h1 className="mb-5 font-display text-3xl font-normal">{d.checkout.title}</h1>
      <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          {!totals.meetsMinimum && <MinOrderBanner totals={totals} />}
          <Card className="space-y-4 p-5 sm:p-6">
            <h2 className="text-lg font-semibold">{d.checkout.contact}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={c.firstName} htmlFor="firstName" error={err("firstName")}>
                <Input id="firstName" name="firstName" autoComplete="given-name" value={f.firstName} onChange={set("firstName")} invalid={!!err("firstName")} aria-describedby={dsc("firstName")} />
              </Field>
              <Field label={c.lastName} htmlFor="lastName" error={err("lastName")}>
                <Input id="lastName" name="lastName" autoComplete="family-name" value={f.lastName} onChange={set("lastName")} invalid={!!err("lastName")} aria-describedby={dsc("lastName")} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={d.checkout.email} htmlFor="email" error={err("email")}>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  value={f.email}
                  onChange={set("email")}
                  invalid={!!err("email")}
                  aria-describedby={dsc("email")}
                />
              </Field>
              <Field label={d.checkout.phone} htmlFor="phone" error={err("phone")} hint={d.checkout.phoneHint}>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  value={f.phone}
                  onChange={set("phone")}
                  invalid={!!err("phone")}
                  aria-describedby={dsc("phone")}
                />
              </Field>
            </div>
          </Card>
          <Card className="space-y-4 p-5 sm:p-6">
            <h2 className="text-lg font-semibold">{d.checkout.addressTitle}</h2>
            <Field label={d.checkout.street} htmlFor="street" error={err("street")}>
              <Input
                id="street"
                name="street"
                autoComplete="address-line1"
                value={f.street}
                onChange={set("street")}
                invalid={!!err("street")}
                aria-describedby={dsc("street")}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
              <Field label={d.checkout.postalCode} htmlFor="postalCode" error={err("postalCode")}>
                <Input
                  id="postalCode"
                  name="postalCode"
                  autoComplete="postal-code"
                  inputMode="numeric"
                  maxLength={6}
                  value={f.postalCode}
                  onChange={set("postalCode")}
                  invalid={!!err("postalCode")}
                  aria-describedby={dsc("postalCode")}
                />
              </Field>
              <Field label={d.checkout.city} htmlFor="city" error={err("city")}>
                <Input
                  id="city"
                  name="city"
                  autoComplete="address-level2"
                  value={f.city}
                  onChange={set("city")}
                  invalid={!!err("city")}
                  aria-describedby={dsc("city")}
                />
              </Field>
            </div>
            <Field label={d.checkout.instructions} htmlFor="instructions" hint={d.checkout.instructionsHint}>
              <Textarea
                id="instructions"
                name="instructions"
                maxLength={500}
                value={f.instructions}
                onChange={set("instructions")}
                aria-describedby="instructions-hint"
              />
            </Field>
          </Card>
          <div className="flex items-start gap-3 rounded-[var(--radius-card)] bg-sage p-4 text-forest-dark" data-testid="estimate">
            <Truck className="mt-0.5 size-6 shrink-0" aria-hidden />
            <div className="text-sm">
              <p className="font-semibold">{d.checkout.estimated}</p>
              {estimate ? (
                <>
                  {current?.status === "review" && (
                    <p className="font-medium text-warn-ink" data-testid="review-note">
                      {t(d.delivery.reviewNote, { postcode: current.postcode })}
                    </p>
                  )}
                  <fieldset className="mt-2 flex flex-wrap gap-2" data-testid="date-picker">
                    <legend className="font-semibold">{d.delivery.chooseDate}</legend>
                    {dateOptions.map((o) => (
                      <label
                        key={o.date}
                        className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 ${chosenDate?.date === o.date ? "border-primary bg-white" : "border-transparent bg-white/60"}`}
                      >
                        <input type="radio" name="deliveryDate" value={o.date} checked={chosenDate?.date === o.date} onChange={() => setDate(o.date)} className="size-4 accent-[var(--color-primary)]" />
                        {o.showTomorrow ? d.delivery.tomorrow : formatSlotDay(o.date, locale)}
                      </label>
                    ))}
                  </fieldset>
                  <fieldset className="mt-2 flex flex-wrap gap-2" data-testid="slot-picker">
                    <legend className="sr-only">{d.delivery.slotLabel}</legend>
                    {estimate.slots.map((s) => (
                      <label
                        key={s.start}
                        className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 ${slotStart === s.start ? "border-primary bg-white" : "border-transparent bg-white/60"}`}
                      >
                        <input type="radio" name="slot" value={s.start} checked={slotStart === s.start} onChange={() => setSlotStart(s.start)} className="size-4 accent-[var(--color-primary)]" />
                        {s.start}–{s.end} {d.delivery.oclock}
                      </label>
                    ))}
                  </fieldset>
                  {chosenDate && <p className="text-xs opacity-80">{t(d.delivery.orderBy, { cutoff: formatCutoff(chosenDate.cutoffAt, locale) })}</p>}
                </>
              ) : checking ? (
                <p>{d.checkout.slotLoading}</p>
              ) : current && !current.supported ? (
                <p className="font-medium text-warn-ink">{d.checkout.postcodeUnsupported}</p>
              ) : current ? (
                <p className="font-medium text-warn-ink">{d.checkout.slotNone}</p>
              ) : (
                <p>{d.checkout.slotNeedPostcode}</p>
              )}
              {notice && (
                <p role="status" className="mt-1 text-xs font-medium">
                  {notice}
                </p>
              )}
              {err("slot") && (
                <p role="alert" className="mt-1 text-xs font-medium text-danger">
                  {err("slot")}
                </p>
              )}
            </div>
          </div>
          <Card className="space-y-3 p-5 sm:p-6">
            <h2 className="text-lg font-semibold">{c.payment}</h2>
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="sr-only">{c.payment}</legend>
              <label className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border p-3 ${method === "PAYPAL" ? "border-primary bg-primary-soft" : "border-border-strong bg-surface"}`}>
                <input type="radio" name="method" checked={method === "PAYPAL"} onChange={() => setMethod("PAYPAL")} className="mt-1 size-5 accent-[var(--color-primary)]" />
                <span>
                  <span className="block font-semibold">{c.paypal}</span>
                  <span className="t-small text-text-muted">{c.paypalHint}</span>
                </span>
              </label>
              <label className={`flex min-h-16 items-start gap-3 rounded-[var(--radius-md)] border p-3 ${cashOk ? "cursor-pointer" : "cursor-not-allowed opacity-60"} ${method === "CASH" ? "border-primary bg-primary-soft" : "border-border-strong bg-surface"}`}>
                <input type="radio" name="method" disabled={!cashOk} checked={method === "CASH"} onChange={() => setMethod("CASH")} className="mt-1 size-5 accent-[var(--color-primary)]" />
                <span>
                  <span className="block font-semibold">{c.cash}</span>
                  {!cashOk && <span className="t-small text-text-muted">{c.cashUnavailable}</span>}
                </span>
              </label>
            </fieldset>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card className="space-y-4 p-5">
            <h2 className="text-lg font-semibold">{d.checkout.summary}</h2>
            <ul className="space-y-3">
              {data.lines.map((l) => (
                <li key={l.productId} className="flex items-center gap-3">
                  <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-sage">
                    {l.image && (
                      <Image src={l.image} alt="" fill unoptimized={l.image.endsWith(".svg")} sizes="56px" className="object-cover" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block truncate font-medium">{l.name}</span>
                    <span className="text-muted">{formatQuantity(l.grams, l.isBundle)}</span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{formatMoney(l.lineTotalCents, locale)}</span>
                </li>
              ))}
            </ul>
            <dl className="tabular space-y-2 border-t border-border pt-3 text-base">
              <div className="flex justify-between">
                <dt className="text-text-muted">{c.estimated}</dt>
                <dd data-testid="grand-total">ca. {formatMoney(data.estimate?.estimatedTotalCents ?? totals.totalCents, locale)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-muted">{c.max}</dt>
                <dd data-testid="max-total">{formatMoney(data.estimate?.maxTotalCents ?? totals.totalCents, locale)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-muted">{c.deliveryFee}</dt>
                <dd>{totals.deliveryFeeCents === 0 ? d.common.free : formatMoney(totals.deliveryFeeCents, locale)}</dd>
              </div>
            </dl>
            <SellerBox title={c.sellerTitle}>
              <p data-testid="seller-box">
                {data.merchant?.name}
                {data.merchant?.address ? `, ${data.merchant.address}` : ""}
                {data.merchant?.phone ? `, ${data.merchant.phone}` : ""}
                {data.merchant?.email ? `, ${data.merchant.email}` : ""}
              </p>
            </SellerBox>
            <Notice tone="info">
              <span data-testid="variable-price">
                {c.variablePrice(`ca. ${formatMoney(data.estimate?.estimatedTotalCents ?? totals.totalCents, locale)}`, formatMoney(data.estimate?.maxTotalCents ?? totals.totalCents, locale))}
              </span>
            </Notice>
            <Notice tone="warning">
              <span data-testid="no-withdrawal">{c.noWithdrawal}</span>
            </Notice>
            <Checkbox id="terms" checked={terms} onChange={(e) => setTerms(e.target.checked)} error={err("terms")} label={<TermsLabel />} aria-describedby={err("terms") ? "terms-err" : undefined} />
            <Checkbox id="marketing" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} label={locale === "tr" ? "Kampanya ve haberleri e-posta/SMS ile almak istiyorum (isteğe bağlı, her zaman geri alınabilir)." : "Ich möchte Angebote und Neuigkeiten per E-Mail/SMS erhalten (optional, jederzeit widerrufbar)."} />
            {formError && (
              <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm font-medium text-danger">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {formError}
              </p>
            )}
            <Button type="submit" size="lg" full loading={submitting} disabled={!totals.meetsMinimum} data-testid="pay-btn">
              <Lock className="size-4" aria-hidden />
              {c.orderButton}
            </Button>
            <Link href={`/${locale}/cart`} className="block text-center text-sm font-medium text-forest hover:underline">
              {d.checkout.editCart}
            </Link>
          </Card>
        </aside>
      </form>
    </Container>
  );
}

function TermsLabel() {
  const { locale } = useI18n();
  const parts = (locale === "tr"
    ? "Kevser Fleischerei {agb} ve Halal Fresh {terms} metinlerini kabul ediyorum."
    : "Ich akzeptiere die {agb} der Kevser Fleischerei und die {terms} von Halal Fresh."
  ).split(/(\{agb\}|\{terms\})/);
  return (
    <span>
      {parts.map((p, i) =>
        p === "{agb}" ? (
          <Link key={i} href={`/${locale}/legal/agb`} target="_blank" className="font-medium text-primary underline">
            AGB
          </Link>
        ) : p === "{terms}" ? (
          <Link key={i} href={`/${locale}/legal/terms`} target="_blank" className="font-medium text-primary underline">
            {locale === "tr" ? "Kullanım Koşulları" : "Nutzungsbedingungen"}
          </Link>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}
