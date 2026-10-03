// lib/result.ts
//
// Every server action returns one of these instead of throwing. A
// thrown error in a server action shows a blank Next.js error screen
// and loses whatever was typed — unacceptable at a fee counter with a
// queue of parents.
//
// Actions still throw for things that should never happen (an id that
// belongs to another school). Those hit app/error.tsx.

export type ActionState = { error?: string; ok?: string } | null;

export function fail(message: string): ActionState {
  return { error: message };
}

export function done(message: string): ActionState {
  return { ok: message };
}

export function isError<T>(r: T | { error: string }): r is { error: string } {
  return typeof r === "object" && r !== null && "error" in r;
}

export function requireText(
  value: FormDataEntryValue | null,
  field: string,
  max = 200
): { value: string } | { error: string } {
  const v = String(value ?? "").trim();

  if (!v) return { error: `${field} is required.` };
  if (v.length > max) return { error: `${field} is too long.` };

  return { value };
}

// Deliberately loose. Rejecting a real guardian's number is worse than
// storing an odd one.
export function requirePhone(
  value: FormDataEntryValue | null
): { value: string } | { error: string } {
  const raw = String(value ?? "").trim();

  if (!raw) return { error: "Phone number is required." };

  const digits = raw.replace(/\D/g, "");

  if (digits.length < 10) return { error: "Phone number needs at least 10 digits." };
  if (digits.length > 13) return { error: "That phone number looks too long." };

  return { value: raw };
}

export function requireMoney(
  value: FormDataEntryValue | null,
  field: string
): { value: number } | { error: string } {
  const raw = String(value ?? "").trim();

  if (!raw) return { error: `${field} is required.` };

  const n = Number(raw);

  if (!Number.isFinite(n)) return { error: `${field} must be a number.` };
  if (n < 0) return { error: `${field} cannot be negative.` };
  if (n > 10_000_000) return { error: `${field} looks mistyped.` };

  return { value: n };
}

export function optionalNumber(
  value: FormDataEntryValue | null,
  field: string,
  opts: { min?: number; max?: number } = {}
): { value: number | null } | { error: string } {
  const raw = String(value ?? "").trim();

  if (!raw) return { value: null };

  const n = Number(raw);

  if (!Number.isFinite(n)) return { error: `${field} must be a number.` };
  if (opts.min !== undefined && n < opts.min) {
    return { error: `${field} cannot be below ${opts.min}.` };
  }
  if (opts.max !== undefined && n > opts.max) {
    return { error: `${field} cannot be above ${opts.max}.` };
  }

  return { value: n };
}

export function optionalDate(
  value: FormDataEntryValue | null,
  field: string
): { value: Date | null } | { error: string } {
  const raw = String(value ?? "").trim();

  if (!raw) return { value: null };

  const d = new Date(raw);

  if (Number.isNaN(d.getTime())) return { error: `${field} is not a valid date.` };

  return { value: d };
}
