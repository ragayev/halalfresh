import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "../../globals.css";
import { getAdmin } from "@/server/auth";
import { logoutAction } from "./actions";
import { Leaf } from "lucide-react";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-sans-body", display: "swap" });
export const metadata: Metadata = {
  title: "Halal Fresh Admin",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdmin();
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh bg-cream">
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
            <Link href="/admin" className="flex items-center gap-2 font-semibold text-forest-dark">
              <Leaf className="size-5" aria-hidden />
              Halal Fresh Admin
            </Link>
            {admin && (
              <>
                <nav className="flex gap-1 text-sm font-medium">
                  {[
                    ["Dashboard", "/admin"],
                    ["Orders", "/admin/orders"],
                    ["Products", "/admin/products"],
                    ["Delivery", "/admin/delivery"],
                    ["Settings", "/admin/settings"],
                  ].map(([l, h]) => (
                    <Link key={h} href={h} className="rounded-full px-3 py-1.5 hover:bg-sage">
                      {l}
                    </Link>
                  ))}
                </nav>
                <form action={logoutAction} className="ml-auto flex items-center gap-3 text-sm text-muted">
                  <span className="hidden sm:inline">{admin.email}</span>
                  <button className="font-medium text-forest hover:underline">Sign out</button>
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
