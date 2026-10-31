// Structured logging that never emits personal data: known PII keys are dropped.
const PII = /(email|phone|name|street|address|city|postal|postcode|instructions|password|token|secret|note)/i;

function scrub(v: unknown, depth = 0): unknown {
  if (depth > 3 || v == null) return v;
  if (v instanceof Error) return { message: v.message, name: v.name };
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrub(x, depth + 1));
  if (typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, PII.test(k) ? "[redacted]" : scrub(val, depth + 1)]),
    );
  }
  return v;
}

function emit(level: "info" | "warn" | "error", event: string, fields?: Record<string, unknown>) {
  if (process.env.VITEST) return;
  const line = JSON.stringify({
    level,
    event,
    ...(scrub(fields) as object),
    t: new Date().toISOString(),
  });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export const log = {
  info: (e: string, f?: Record<string, unknown>) => emit("info", e, f),
  warn: (e: string, f?: Record<string, unknown>) => emit("warn", e, f),
  error: (e: string, f?: Record<string, unknown>) => emit("error", e, f),
};
