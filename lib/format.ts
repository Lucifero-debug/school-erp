// lib/format.ts
//
// Everything in this app is Asia/Kolkata. The server may not be, so
// never rely on the machine's local timezone — pass the zone.

const IST = "Asia/Kolkata";

export function date(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: IST,
  }).format(d);
}

export function shortDate(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    timeZone: IST,
  }).format(d);
}

export function time(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: IST,
  }).format(d);
}

export function dateTime(d: Date): string {
  return `${date(d)}, ${time(d)}`;
}

// Indian digit grouping: 1,00,000 not 100,000.
export function rupees(n: number | string, paise = false): string {
  const value = typeof n === "string" ? Number(n) : n;

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: paise ? 2 : 0,
    maximumFractionDigits: paise ? 2 : 0,
  }).format(value);
}

// For the ISO value <input type="date"> expects, in IST rather than UTC
// — otherwise a date entered late in the evening lands on the day
// before.
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

// Age in whole years, for admission eligibility checks.
export function ageYears(dob: Date | null): string {
  if (!dob) return "—";
  return `${Math.floor((Date.now() - dob.getTime()) / 31_557_600_000)}y`;
}

export function studentName(s: {
  firstName: string;
  lastName: string | null;
}): string {
  return s.lastName ? `${s.firstName} ${s.lastName}` : s.firstName;
}
