"use client";
import { useActionState, useState, useTransition } from "react";
import { Button, Input } from "@/components/ui";
import type { ActionResult } from "@/app/(admin)/admin/actions";

export function Msg({ r }: { r: ActionResult | null }) {
  if (!r?.message) return null;
  return (
    <p role={r.ok ? "status" : "alert"} className={`text-sm font-medium ${r.ok ? "text-forest" : "text-danger"}`}>
      {r.message}
    </p>
  );
}

export function ActionForm({
  action,
  children,
  submit = "Save",
}: {
  action: (p: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  submit?: string;
}) {
  const [r, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-4">
      {children}
      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending}>
          {submit}
        </Button>
        <Msg r={r} />
      </div>
    </form>
  );
}

export function LoginForm({ action }: { action: (p: ActionResult | null, fd: FormData) => Promise<ActionResult> }) {
  const [r, formAction, pending] = useActionState(action, null);
  const [email, setEmail] = useState(""); // React resets uncontrolled fields after an action; keep the email
  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Msg r={r} />
      <Button type="submit" full loading={pending}>
        Sign in
      </Button>
    </form>
  );
}

export function RunButton({
  run,
  children,
  variant = "secondary",
  confirm,
  onDone,
  ...rest
}: {
  run: () => Promise<ActionResult>;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger" | "warn";
  confirm?: string;
  onDone?: (r: ActionResult) => void;
} & Omit<React.ComponentProps<typeof Button>, "onClick" | "variant">) {
  const [pending, start] = useTransition();
  const [r, setR] = useState<ActionResult | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        {...rest}
        variant={variant}
        loading={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const res = await run();
            setR(res);
            onDone?.(res);
          });
        }}
      >
        {children}
      </Button>
      {r && !r.ok && <Msg r={r} />}
    </span>
  );
}
