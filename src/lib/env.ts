export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const gatewayName = () => (process.env.PAYMENT_GATEWAY === "mock" ? "mock" : "stripe");

export function assertMockAllowed() {
  if (process.env.NODE_ENV === "production" && process.env.PAYMENT_GATEWAY === "mock") {
    throw new Error("PAYMENT_GATEWAY=mock is not allowed in production");
  }
}
