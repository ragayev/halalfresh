import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { getOrderByToken } from "@/server/orders";
import { OrderView } from "@/components/order-view";
import { NotFoundBlock } from "@/components/not-found-block";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Success({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { t: token } = await searchParams;
  const d = await getDictionary(locale);
  const order = token ? await getOrderByToken(token) : null;
  if (!order) return <NotFoundBlock title={d.order.notFound} text={d.order.notFoundText} href={`/${locale}`} cta={d.errors.goHome} />;
  return <OrderView order={order} d={d} locale={locale} justPaid />;
}
