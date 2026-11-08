export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** "paypal" talks to PayPal (sandbox or live per PAYPAL_ENV). "mock" is a local stand-in, refused in production. */
export const paymentProviderName = () => (process.env.PAYMENT_PROVIDER === "mock" ? "mock" : "paypal");

export function assertMockAllowed() {
  if (process.env.NODE_ENV === "production" && process.env.PAYMENT_PROVIDER === "mock") {
    throw new Error("PAYMENT_PROVIDER=mock is not allowed in production");
  }
}
