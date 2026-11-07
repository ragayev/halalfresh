import type { CaptureResult, PaymentProvider } from "./provider";

export class PayPalConfigError extends Error {}

const base = () => (process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");

function creds() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new PayPalConfigError("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set");
  return { id, secret };
}

let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
  const { id, secret } = creds();
  const res = await fetch(`${base()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status})`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function api(path: string, init: { method: string; body?: unknown; requestId?: string }) {
  const res = await fetch(`${base()}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

const eur = (cents: number) => (cents / 100).toFixed(2);
const toCents = (v: unknown) => (typeof v === "string" ? Math.round(Number(v) * 100) : null);

type PayPalCapture = { id?: string; status?: string; amount?: { value?: string } };
const firstCapture = (j: Record<string, unknown>): PayPalCapture | undefined =>
  ((j.purchase_units as { payments?: { captures?: PayPalCapture[] } }[] | undefined)?.[0]?.payments?.captures ?? [])[0];

export const paypalProvider: PaymentProvider = {
  name: "paypal",

  async createOrder(a) {
    const itemTotal = a.lines.reduce((s, l) => s + l.amountCents, 0);
    // PayPal requires item_total to equal the sum of items; any rounding difference is sent as a separate "Gewichtsabrechnung" line.
    const lines = itemTotal === a.amountCents ? a.lines : [{ name: `${a.orderNumberLabel} (Endbetrag)`, amountCents: a.amountCents }];
    const r = await api("/v2/checkout/orders", {
      method: "POST",
      requestId: a.requestId,
      body: {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: a.orderNumberLabel,
            description: `${a.orderNumberLabel} bei ${a.sellerName}`.slice(0, 127),
            soft_descriptor: "HALALFRESH",
            amount: {
              currency_code: "EUR",
              value: eur(a.amountCents),
              breakdown: { item_total: { currency_code: "EUR", value: eur(a.amountCents) } },
            },
            items: lines.map((l) => ({ name: l.name.slice(0, 127), quantity: "1", unit_amount: { currency_code: "EUR", value: eur(l.amountCents) }, category: "PHYSICAL_GOODS" })),
          },
        ],
        payment_source: { paypal: { experience_context: { brand_name: "Halal Fresh", locale: "de-DE", user_action: "PAY_NOW", return_url: a.returnUrl, cancel_url: a.cancelUrl } } },
      },
    });
    if (!r.ok || typeof r.json.id !== "string") throw new Error(`PayPal create order failed (${r.status})`);
    return { providerOrderId: r.json.id, raw: r.json };
  },

  async captureOrder(providerOrderId, requestId): Promise<CaptureResult> {
    const r = await api(`/v2/checkout/orders/${encodeURIComponent(providerOrderId)}/capture`, { method: "POST", requestId, body: {} });
    if (!r.ok) {
      // Already captured (e.g. the webhook won the race): ask PayPal for the order instead of failing.
      const issues = JSON.stringify(r.json);
      if (r.status === 422 && issues.includes("ORDER_ALREADY_CAPTURED")) {
        const g = await api(`/v2/checkout/orders/${encodeURIComponent(providerOrderId)}`, { method: "GET" });
        const c = firstCapture(g.json);
        return { status: c?.status === "COMPLETED" ? "COMPLETED" : "PENDING", captureId: c?.id ?? null, amountCents: toCents(c?.amount?.value), raw: g.json };
      }
      throw new Error(`PayPal capture failed (${r.status})`);
    }
    const c = firstCapture(r.json);
    const status = c?.status === "COMPLETED" ? "COMPLETED" : c?.status === "PENDING" ? "PENDING" : c?.status === "DECLINED" ? "DECLINED" : "PENDING";
    return { status, captureId: c?.id ?? null, amountCents: toCents(c?.amount?.value), raw: r.json };
  },

  async verifyWebhook(headers, rawBody) {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) throw new PayPalConfigError("PAYPAL_WEBHOOK_ID is not set");
    let event: unknown;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return false;
    }
    const h = (n: string) => headers.get(n) ?? "";
    const r = await api("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      body: {
        auth_algo: h("paypal-auth-algo"),
        cert_url: h("paypal-cert-url"),
        transmission_id: h("paypal-transmission-id"),
        transmission_sig: h("paypal-transmission-sig"),
        transmission_time: h("paypal-transmission-time"),
        webhook_id: webhookId,
        webhook_event: event,
      },
    });
    return r.ok && r.json.verification_status === "SUCCESS";
  },
};
