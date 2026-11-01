import { notFound } from "next/navigation";
import Link from "next/link";
import { XCircle } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { buttonClasses } from "@/components/ui";

export const metadata = { robots: { index: false, follow: false } };

export default async function Cancelled({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = await getDictionary(locale);
  return (
    <div className="mx-auto grid max-w-md place-items-center px-4 py-24 text-center">
      <XCircle className="size-14 text-muted" aria-hidden />
      <h1 className="mt-4 font-display text-3xl font-normal">{d.order.cancelledTitle}</h1>
      <p className="mt-2 text-muted">{d.order.cancelledText}</p>
      <Link href={`/${locale}/cart`} className={buttonClasses({ size: "lg" }) + " mt-6"}>
        {d.order.backToCart}
      </Link>
    </div>
  );
}
