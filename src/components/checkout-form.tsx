"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, Lock, Truck } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { useCart } from "./cart-store";
import { useCartView } from "./use-cart-view";
import { MinOrderBanner } from "./cart-progress";
import { Button, Card, Container, Field, Input, Textarea, buttonClasses } from "./ui";
import { formatMoney } from "@/domain/money";
import { formatQuantity } from "@/domain/bundles";
import { isValidPostcode, normalizePostcode } from "@/domain/delivery";
import { formatCutoff, formatSlotDay } from "@/lib/format-delivery";
import { useDelivery } from "./delivery-provider";
import { FreeDeliveryBar } from "./cart-progress";
type Errors = Partial<Record<"name" | "email" | "phone" | "street" | "postalCode" | "city" | "slot" | "terms", string>>;

export function CheckoutForm() {
  const { d, locale, t } = useI18n();
  const { ready } = useCart();
  const { data, loading } = useCartView();
  const [f, setF] = useState({
    name: "",
    email: "",
    phone: "",
    street: "",
    postalCode: "",
    city: "",
    instructions: "",
  });
  const [terms, setTerms] = useState(false);
  const { hydrated, postcode: savedPostcode, check, status, setPostcode } = useDelivery();
  const [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const requestId = useRef<string>(typeof crypto !== "undefined" ? crypto.randomUUID() : "");

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const pc = normalizePostcode(f.postalCode);

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
  const hasNonPreorder = data.lines.some((l) => l.issue === "NOT_PREORDER");

  function validate(): Errors {
    const e: Errors = {};
    if (f.name.trim().length < 2) e.name = d.checkout.required;
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = d.checkout.invalidEmail;
    if (!/^\+?[\d\s()/-]{6,24}$/.test(f.phone.trim())) e.phone = d.checkout.invalidPhone;
    if (f.street.trim().length < 3) e.street = d.checkout.required;
    if (!isValidPostcode(pc)) e.postalCode = d.checkout.invalidPostcode;
    else if (current && !current.supported) e.postalCode = d.checkout.postcodeUnsupported;
    if (f.city.trim().length < 2) e.city = d.checkout.required;
    if (current?.supported && !estimate) e.slot = d.checkout.slotNone;
    if (current?.supported && (!pricedFor || data!.hasIssues)) e.slot = hasNonPreorder ? d.delivery.cartPreorderOnly : d.cart.updated;
    if (current?.supported && !totals.meetsMinimum) e.slot = t(d.checkout.belowMin, { amount: formatMoney(totals.minOrderCents, locale) });
    if (!terms) e.terms = d.checkout.acceptTerms;
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
          })),
          customer: { name: f.name, email: f.email, phone: f.phone },
          address: { street: f.street, postalCode: pc, city: f.city },
          checkedPostcode: pc,
          deliveryInstructions: f.instructions || undefined,
          acceptTerms: true,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        requestId.current = crypto.randomUUID();
        const code = j?.error?.code;
        if (code === "VALIDATION" && j.error.details) {
          const fe = j.error.details as Record<string, string[]>;
          setErrors({ name: fe.customer && d.checkout.required });
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
                : code === "PREORDER_ONLY"
                  ? d.delivery.cartPreorderOnly
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
      window.location.assign(j.url); // Stripe-hosted Checkout
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
          <FreeDeliveryBar totals={totals} check={current ?? undefined} />
          <Card className="space-y-4 p-5 sm:p-6">
            <h2 className="text-lg font-semibold">{d.checkout.contact}</h2>
            <Field label={d.checkout.name} htmlFor="name" error={err("name")}>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                value={f.name}
                onChange={set("name")}
                invalid={!!err("name")}
                aria-describedby={dsc("name")}
              />
            </Field>
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
                  <p className="text-base font-bold capitalize">
                    {t(d.delivery.slotLine, {
                      day: formatSlotDay(estimate.date, locale),
                      start: estimate.windowStart,
                      end: estimate.windowEnd,
                    })}
                  </p>
                  <p className="text-xs opacity-80">{t(d.delivery.orderBy, { cutoff: formatCutoff(estimate.cutoffAt, locale) })}</p>
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
              {current?.mode === "PREORDER_ONLY" && (
                <p className="mt-1 text-xs font-medium">{hasNonPreorder ? d.delivery.cartPreorderOnly : d.delivery.preorderText}</p>
              )}
              {err("slot") && (
                <p role="alert" className="mt-1 text-xs font-medium text-danger">
                  {err("slot")}
                </p>
              )}
            </div>
          </div>
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
            <dl className="space-y-2 border-t border-line pt-3 text-[15px]">
              <div className="flex justify-between">
                <dt className="text-muted">{d.common.subtotal}</dt>
                <dd className="tabular-nums">{formatMoney(totals.subtotalCents, locale)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{d.common.delivery}</dt>
                <dd className="tabular-nums">
                  {totals.deliveryFeeCents === 0 ? d.common.free : formatMoney(totals.deliveryFeeCents, locale)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-line pt-3 text-xl font-bold">
                <dt>{d.common.total}</dt>
                <dd className="tabular-nums" data-testid="grand-total">
                  {formatMoney(totals.totalCents, locale)}
                </dd>
              </div>
            </dl>
            <div className="rounded-xl bg-sage-soft p-3 text-xs text-muted">
              <p className="font-semibold text-ink">{d.checkout.seller}</p>
              <p className="mt-0.5">
                {t(d.checkout.sellerText, {
                  merchant: data.merchant?.name ?? "",
                })}
              </p>
            </div>
            <div>
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input
                  id="terms"
                  type="checkbox"
                  checked={terms}
                  onChange={(e) => setTerms(e.target.checked)}
                  className="mt-0.5 size-5 shrink-0 accent-[#164b39]"
                  aria-describedby={err("terms") ? "terms-err" : undefined}
                />
                <TermsLabel />
              </label>
              {err("terms") && (
                <p id="terms-err" role="alert" className="mt-1 text-xs font-medium text-danger">
                  {err("terms")}
                </p>
              )}
            </div>
            {formError && (
              <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm font-medium text-danger">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {formError}
              </p>
            )}
            <Button type="submit" size="lg" full loading={submitting} disabled={!totals.meetsMinimum} data-testid="pay-btn">
              {submitting ? (
                d.checkout.paying
              ) : (
                <>
                  <Lock className="size-4" aria-hidden />
                  {t(d.checkout.pay, {
                    amount: formatMoney(totals.totalCents, locale),
                  })}
                </>
              )}
            </Button>
            <p className="text-center text-xs text-muted">{d.checkout.stripeNote}</p>
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
  const { d, locale } = useI18n();
  const parts = d.checkout.terms.split(/(\{terms\}|\{privacy\})/);
  return (
    <span>
      {parts.map((p, i) =>
        p === "{terms}" ? (
          <Link key={i} href={`/${locale}/legal/terms`} target="_blank" className="font-medium underline">
            {d.checkout.termsLink}
          </Link>
        ) : p === "{privacy}" ? (
          <Link key={i} href={`/${locale}/legal/privacy`} target="_blank" className="font-medium underline">
            {d.checkout.privacyLink}
          </Link>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}
