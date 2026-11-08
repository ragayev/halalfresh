"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ClipboardList, Package, Settings, ShoppingBag, Truck, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/admin/orders", label: "Bestellungen", icon: ShoppingBag },
  { href: "/admin/products", label: "Produkte", icon: Package },
  { href: "/admin/dispatch", label: "Planung", icon: ClipboardList },
  { href: "/admin/delivery", label: "Lieferung", icon: Truck },
  { href: "/admin/customers", label: "Kunden", icon: Users },
  { href: "/admin", label: "Kennzahlen", icon: BarChart3, exact: true },
  { href: "/admin/settings", label: "Einstellungen", icon: Settings },
];

/** Mobile: bottom bar (admin is used on a phone next to WhatsApp). Desktop: 240px sidebar. */
export function AdminNav({ variant }: { variant: "bottom" | "side" }) {
  const path = usePathname();
  const active = (i: (typeof ITEMS)[number]) => (i.exact ? path === i.href : path.startsWith(i.href));
  if (variant === "side")
    return (
      <nav aria-label="Admin" className="hidden w-60 shrink-0 flex-col gap-1 border-r border-border bg-surface p-3 lg:flex">
        {ITEMS.map((i) => (
          <Link key={i.href} href={i.href} aria-current={active(i) ? "page" : undefined} className={cn("flex min-h-11 items-center gap-3 rounded-[var(--radius-md)] px-3 font-medium", active(i) ? "bg-primary-soft text-primary" : "hover:bg-surface-alt")}>
            <i.icon className="size-5" strokeWidth={1.75} aria-hidden /> {i.label}
          </Link>
        ))}
      </nav>
    );
  return (
    <nav aria-label="Admin" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="grid grid-cols-7">
        {ITEMS.map((i) => (
          <li key={i.href}>
            <Link href={i.href} aria-current={active(i) ? "page" : undefined} className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium", active(i) ? "text-primary" : "text-text-muted")}>
              <i.icon className="size-5" strokeWidth={1.75} aria-hidden />
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
