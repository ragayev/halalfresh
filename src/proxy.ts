import { NextResponse, type NextRequest } from "next/server";
import { LOCALES, DEFAULT_LOCALE, LOCALE_COOKIE } from "@/i18n/config";

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
    const res = NextResponse.next({ request: { headers: h } });
    if (req.cookies.get(LOCALE_COOKIE)?.value !== first)
      res.cookies.set(LOCALE_COOKIE, first, {
        path: "/",
        maxAge: 31536000,
        sameSite: "lax",
      });
    return res;
  }

  // No locale prefix: prefer saved choice, then Accept-Language, then English.
  const saved = req.cookies.get(LOCALE_COOKIE)?.value;
  let locale: string = DEFAULT_LOCALE;
  if (saved && (LOCALES as readonly string[]).includes(saved)) locale = saved;
  else {
    const accept = req.headers.get("accept-language") ?? "";
    for (const part of accept.split(",")) {
      const code = part.trim().slice(0, 2).toLowerCase();
      if ((LOCALES as readonly string[]).includes(code)) {
        locale = code;
        break;
      }
    }
  }
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
