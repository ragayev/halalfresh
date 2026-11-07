import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2, Store } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "warn" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

export function buttonClasses({ variant = "primary", size = "md", full }: { variant?: Variant; size?: Size; full?: boolean } = {}) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] font-semibold transition-colors duration-150 select-none",
    "disabled:cursor-not-allowed disabled:opacity-40 active:translate-y-px",
    // Touch targets stay >= 44px at every size.
    size === "sm" && "min-h-11 px-4 text-sm",
    size === "md" && "h-12 px-5 text-base lg:h-11",
    size === "lg" && "h-14 px-7 text-base",
    size === "icon" && "size-11",
    full && "w-full",
    variant === "primary" && "bg-primary text-text-inverse hover:bg-primary-hover",
    variant === "secondary" && "border border-border-strong bg-surface text-text hover:bg-surface-alt",
    variant === "ghost" && "px-2 text-primary hover:underline",
    variant === "warn" && "bg-warning-bg text-warning hover:brightness-95",
    variant === "danger" && "bg-danger text-text-inverse hover:brightness-110",
  );
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant;
    size?: Size;
    full?: boolean;
    loading?: boolean;
  }
>(({ variant, size, full, loading, className, children, disabled, ...p }, ref) => (
  <button
    ref={ref}
    className={cn(buttonClasses({ variant, size, full }), className)}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    {...p}
  >
    {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
    {children}
  </button>
));
Button.displayName = "Button";

export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-text">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-sm text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-err`} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const inputBase =
  "w-full rounded-[var(--radius-md)] border bg-surface px-3.5 text-base text-text placeholder:text-text-muted/70 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ className, invalid, ...p }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(inputBase, "h-12", invalid ? "border-danger" : "border-border-strong", className)}
      {...p}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(inputBase, "min-h-24 border-border-strong py-3", className)} {...p} />
));
Textarea.displayName = "Textarea";

export function Card({
  className,
  children,
  ...p
}: {
  className?: string;
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-[var(--radius-lg)] bg-surface shadow-sm ring-1 ring-border", className)} {...p}>
      {children}
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
      className="h-1 w-full overflow-hidden rounded-full bg-primary-soft"
    >
      <div className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out" style={{ width: `${pct}%` }} />
    </div>
  );
}

const tones = {
  neutral: "bg-surface-alt text-text",
  primary: "bg-primary-soft text-primary",
  fresh: "bg-fresh-soft text-fresh",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
  // legacy names
  green: "bg-fresh-soft text-fresh",
  amber: "bg-warning-bg text-warning",
  red: "bg-danger-bg text-danger",
  gray: "bg-surface-alt text-text",
  blue: "bg-info-bg text-info",
} as const;
export function Badge({ tone = "neutral", children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return <span className={cn("t-caption inline-flex items-center rounded-[var(--radius-sm)] px-2 py-0.5", tones[tone], className)}>{children}</span>;
}

const noticeTones = {
  info: { box: "bg-info-bg text-info", icon: Info },
  warning: { box: "bg-warning-bg text-warning", icon: AlertTriangle },
  danger: { box: "bg-danger-bg text-danger", icon: AlertCircle },
  success: { box: "bg-fresh-soft text-fresh", icon: CheckCircle2 },
} as const;
/** Icon + text, never colour alone. */
export function Notice({ tone = "info", children, className }: { tone?: keyof typeof noticeTones; children: ReactNode; className?: string }) {
  const { box, icon: Icon } = noticeTones[tone];
  return (
    <div role={tone === "danger" ? "alert" : "note"} className={cn("t-small flex gap-3 rounded-[var(--radius-md)] p-3", box, className)}>
      <Icon className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Whole row is clickable; 20x20 box. */
export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; error?: string }>(
  ({ label, error, className, ...p }, ref) => (
    <div>
      <label className={cn("flex min-h-11 cursor-pointer items-start gap-3 py-2 text-base", className)}>
        <input ref={ref} type="checkbox" className="mt-0.5 size-5 shrink-0 cursor-pointer rounded-[var(--radius-sm)] accent-[var(--color-primary)]" {...p} />
        <span>{label}</span>
      </label>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  ),
);
Checkbox.displayName = "Checkbox";

export function SellerBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-[var(--radius-md)] bg-surface-alt p-4">
      <Store className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
      <div className="t-small">
        <p className="font-semibold">{title}</p>
        <div className="text-text">{children}</div>
      </div>
    </div>
  );
}

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-[var(--container)] px-4 sm:px-6 lg:px-8", className)}>{children}</div>;
}
