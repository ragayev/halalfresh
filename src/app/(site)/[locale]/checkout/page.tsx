import type { Metadata } from "next";
import { CheckoutForm } from "@/components/checkout-form";
import { getDictionary } from "@/i18n/get-dictionary";
import { isLocale } from "@/i18n/config";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: isLocale(locale) ? (await getDictionary(locale)).checkout.title : "Checkout",
    robots: { index: false },
  };
}
export default function Page() {
  return <CheckoutForm />;
}
