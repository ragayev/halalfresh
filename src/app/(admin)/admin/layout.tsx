import type { Metadata } from "next";
import Link from "next/link";
import "../../globals.css";
import { getAdmin } from "@/server/auth";
import { logoutAction } from "./actions";
import { AdminNav } from "@/components/admin/admin-nav";

export const metadata: Metadata = {
  title: "Etamico Admin",
  robots: { index: false, follow: false },
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "48x48" }, { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdmin();
  return (
    <html lang="de">
      <body className="min-h-dvh bg-[#f7f7f8] pb-16 lg:pb-0">
        <header className="border-b border-border bg-surface">
          <div className="flex h-14 items-center gap-4 px-4">
            <Link href="/admin/orders" className="wordmark text-lg">
              Etamico Admin
            </Link>
            {admin && (
              <form action={logoutAction} className="ml-auto flex items-center gap-3 text-sm text-text-muted">
                <span className="hidden sm:inline">{admin.email}</span>
                <button className="inline-flex min-h-11 items-center font-medium text-primary hover:underline">Abmelden</button>
              </form>
            )}
          </div>
        </header>
        <div className="flex">
          {admin && <AdminNav variant="side" />}
          <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">{children}</main>
        </div>
        {admin && <AdminNav variant="bottom" />}
      </body>
    </html>
  );
}
