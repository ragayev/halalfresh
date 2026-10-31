import { headers } from "next/headers";
import { NotFoundBlock } from "@/components/not-found-block";
import { getDictionary } from "@/i18n/get-dictionary";
import { isLocale, DEFAULT_LOCALE } from "@/i18n/config";

export default async function NotFound() {
  const h = await headers();
  const seg = (h.get("x-pathname") ?? "").split("/")[1];
  const locale = isLocale(seg) ? seg : DEFAULT_LOCALE;
  const d = await getDictionary(locale);
  return <NotFoundBlock title={d.errors.notFoundTitle} text={d.errors.notFoundText} href={`/${locale}`} cta={d.errors.goHome} />;
}
