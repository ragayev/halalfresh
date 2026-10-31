import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { getOrderByToken } from "@/server/orders";
import { OrderView } from "@/components/order-view";
import { NotFoundBlock } from "@/components/not-found-block";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function OrderPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();
  const d = await getDictionary(locale);
  const order = await getOrderByToken(token);
  if (!order) return <NotFoundBlock title={d.order.notFound} text={d.order.notFoundText} href={`/${locale}`} cta={d.errors.goHome} />;
  return <OrderView order={order} d={d} locale={locale} />;
}
