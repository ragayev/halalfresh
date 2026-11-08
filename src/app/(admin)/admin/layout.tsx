import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import "../../globals.css";
import { getAdmin } from "@/server/auth";
import { logoutAction } from "./actions";
import { AdminNav } from "@/components/admin/admin-nav";

export const metadata: Metadata = {
  title: "Halal Fresh Admin",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdmin();
  return (
    <html lang="de">
      <body className="min-h-dvh bg-[#f7f7f8] pb-16 lg:pb-0">
        <header className="border-b border-border bg-surface">
          <div className="flex h-14 items-center gap-4 px-4">
            <Link href="/admin/orders" className="inline-flex min-h-11 items-center gap-2" aria-label="Halal Fresh Admin">
              <Image src="/brand/halal-fresh-logo.svg" alt="Halal Fresh" width={1035} height={372} className="h-9 w-auto" />
              <span className="text-sm font-semibold text-text-muted">Admin</span>
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
