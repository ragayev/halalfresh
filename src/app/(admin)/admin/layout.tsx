import type { Metadata } from "next";
import Link from "next/link";
import "../../globals.css";
import { getAdmin } from "@/server/auth";
import { logoutAction } from "./actions";

export const metadata: Metadata = {
  title: "Halal Fresh Admin",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdmin();
  return (
    <html lang="de">
      <body className="min-h-dvh bg-[#f7f7f8]">
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
            <Link href="/admin" className="flex items-center gap-2 font-semibold text-forest-dark">
              <span className="wordmark text-lg">Halal Fresh Admin</span>
            </Link>
            {admin && (
              <>
                <nav className="flex gap-1 text-sm font-medium">
                  {[
                    ["Dashboard", "/admin"],
                    ["Bestellungen", "/admin/orders"],
                    ["Produkte", "/admin/products"],
                    ["Lieferung", "/admin/delivery"],
                    ["Einstellungen", "/admin/settings"],
                  ].map(([l, h]) => (
                    <Link key={h} href={h} className="rounded-full px-3 py-1.5 hover:bg-sage">
                      {l}
                    </Link>
                  ))}
                </nav>
                <form action={logoutAction} className="ml-auto flex items-center gap-3 text-sm text-muted">
                  <span className="hidden sm:inline">{admin.email}</span>
                  <button className="font-medium text-forest hover:underline">Abmelden</button>
                </form>
              </>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
