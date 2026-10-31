import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "warn" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

export function buttonClasses({ variant = "primary", size = "md", full }: { variant?: Variant; size?: Size; full?: boolean } = {}) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-150 select-none",
    "disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]",
    size === "sm" && "h-9 px-4 text-sm",
    size === "md" && "h-11 px-5 text-[15px]",
    size === "lg" && "h-14 px-7 text-base",
    size === "icon" && "h-10 w-10",
    full && "w-full",
    variant === "primary" &&
      "bg-gradient-to-b from-[#1d5e47] to-forest text-white shadow-md shadow-forest/25 hover:from-forest hover:to-forest-dark hover:shadow-lg",
    variant === "secondary" && "bg-white text-forest ring-1 ring-line hover:bg-sage-soft",
    variant === "ghost" && "text-ink hover:bg-sage",
    variant === "warn" && "bg-warn text-warn-ink hover:brightness-95",
    variant === "danger" && "bg-danger text-white hover:brightness-110",
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
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-err`} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const inputBase =
  "w-full rounded-xl border bg-white px-4 text-[15px] text-ink placeholder:text-muted/70 transition-colors focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ className, invalid, ...p }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(inputBase, "h-12", invalid ? "border-danger" : "border-line", className)}
      {...p}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(inputBase, "min-h-24 border-line py-3", className)} {...p} />
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
    <div className={cn("rounded-[var(--radius-card)] bg-white shadow-card ring-1 ring-line/70", className)} {...p}>
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
      className="h-2.5 w-full overflow-hidden rounded-full bg-white/70 ring-1 ring-black/5"
    >
      <div className="h-full rounded-full bg-forest transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
    </div>
  );
}

const tones = {
  green: "bg-sage text-forest",
  amber: "bg-warn text-warn-ink",
  red: "bg-red-100 text-danger",
  gray: "bg-neutral-100 text-neutral-700",
  blue: "bg-sky-100 text-sky-800",
} as const;
export function Badge({ tone = "gray", children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8", className)}>{children}</div>;
}
