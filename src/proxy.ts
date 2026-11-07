import { NextResponse, type NextRequest } from "next/server";
import { LOCALES, DEFAULT_LOCALE } from "@/i18n/config";

/** Optimistic checks only: admin pages and actions re-verify the session server-side. */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/admin")) {
    const res =
      pathname === "/admin/login" || req.cookies.has("hf_admin")
        ? NextResponse.next()
        : NextResponse.redirect(new URL("/admin/login", req.url));
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }

  const first = pathname.split("/")[1];
  if ((LOCALES as readonly string[]).includes(first)) {
    const h = new Headers(req.headers);
    h.set("x-pathname", pathname);
    // Language lives in the URL only: the MVP sets no cookies on the shop.
    return NextResponse.next({ request: { headers: h } });
  }

  // No locale prefix: Accept-Language, then German.
  let locale: string = DEFAULT_LOCALE;
  {
    // Highest-q supported language wins; anything unsupported falls back to DEFAULT_LOCALE (de).
    const ranked = (req.headers.get("accept-language") ?? "")
      .split(",")
      .map((part) => {
        const [tag, ...params] = part.trim().split(";");
        const q = Number(params.find((p) => p.trim().startsWith("q="))?.split("=")[1] ?? 1);
        return { code: tag.slice(0, 2).toLowerCase(), q: Number.isFinite(q) ? q : 0 };
      })
      .sort((a, b) => b.q - a.q);
    const hit = ranked.find((r) => r.q > 0 && (LOCALES as readonly string[]).includes(r.code));
    if (hit) locale = hit.code;
  }
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
