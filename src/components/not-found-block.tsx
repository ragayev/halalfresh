import Link from "next/link";
import { buttonClasses } from "./ui";

export function NotFoundBlock({ title, text, href, cta }: { title: string; text: string; href: string; cta: string }) {
  return (
    <div className="mx-auto grid max-w-md place-items-center px-4 py-24 text-center">
      <h1 className="font-display text-3xl font-semibold">{title}</h1>
      <p className="mt-2 text-muted">{text}</p>
      <Link href={href} className={buttonClasses({ size: "lg" }) + " mt-6"}>
        {cta}
      </Link>
    </div>
  );
}
