import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { legalContent, type LegalSlug } from "@/content/legal";
import { Container } from "@/components/ui";

const TITLES = {
  privacy: "privacyTitle",
  imprint: "imprintTitle",
  terms: "termsTitle",
} as const;

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale) || !(slug in legalContent)) return {};
  return {
    title: (await getDictionary(locale)).legal[TITLES[slug as LegalSlug]],
    robots: { index: true },
  };
}

export default async function Legal({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!isLocale(locale) || !(slug in legalContent)) notFound();
  const d = await getDictionary(locale);
  return (
    <Container className="max-w-3xl py-10">
      <h1 className="font-display text-4xl font-normal">{d.legal[TITLES[slug as LegalSlug]]}</h1>
      <p className="mt-4 flex gap-2 rounded-xl bg-warn p-3 text-sm text-warn-ink">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {d.legal.placeholder}
      </p>
      <div className="mt-6 space-y-6">
        {legalContent[slug as LegalSlug].map((s) => (
          <section key={s.heading}>
            <h2 className="text-xl font-semibold">{s.heading}</h2>
            {s.body.map((p, i) => (
              <p key={i} className="mt-2 text-muted">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>
    </Container>
  );
}
