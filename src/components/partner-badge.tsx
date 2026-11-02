import Image from "next/image";

const PARTNER_NAME = "Kevser Fleischerei";

/** Hero badge: partner logo with "freshly prepared by" label. */
export function PartnerBadge({ label, className = "" }: { label: string; className?: string }) {
  return (
    <div className={`inline-flex items-center gap-3 rounded-2xl bg-white/90 py-2 pe-4 ps-3 shadow-card ring-1 ring-line/60 ${className}`}>
      <Image src="/kevser-logo.png" alt="" width={400} height={289} className="h-12 w-auto" />
      <span className="text-sm leading-tight">
        <span className="block text-xs text-muted">{label}</span>
        <span className="block font-semibold text-ink">{PARTNER_NAME}</span>
      </span>
    </div>
  );
}

/** Compact tag for product cards. */
export function PartnerTag({ className = "" }: { className?: string }) {
  return (
    <p className={`flex items-center gap-1.5 text-xs text-muted ${className}`}>
      <Image src="/kevser-logo.png" alt="" width={400} height={289} className="h-6 w-auto" />
      {PARTNER_NAME}
    </p>
  );
}
