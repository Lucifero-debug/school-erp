// lib/auth.ts
//
// Password hashing and signed session cookies, using only Node's
// built-in crypto. No extra dependency, nothing to keep patched.
//
// Sessions are a signed cookie, not a database table. Fine for a school
// with a few dozen staff. If you ever need remote sign-out, add a
// Session table — the interface here stays the same.

import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE = "school_session";
const MAX_AGE = 60 * 60 * 10; // a school day, then sign in again

function secret(): string {
  const s = process.env.SESSION_SECRET;

  if (!s || s.length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or too short. Put at least 32 random characters in .env"
    );
  }

  return s;
}

// --- passwords ---------------------------------------------------

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;

  const candidate = crypto.scryptSync(plain, salt, 64);
  const expected = Buffer.from(hash, "hex");

  if (candidate.length !== expected.length) return false;

  return crypto.timingSafeEqual(candidate, expected);
}

// --- session cookie ----------------------------------------------

export type SessionData = {
  staffId: string;
  schoolId: string;
  name: string;
  role: string;
};

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", secret())
    .update(payload)
    .digest("base64url");
}

export async function createSession(data: SessionData) {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const value = `${payload}.${sign(payload)}`;

  const jar = await cookies();

  jar.set(COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function readSession(): Promise<SessionData | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;

  if (!raw) return null;

  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return null;

  // Constant-time compare so a tampered cookie cannot be brute-forced
  // one character at a time.
  const expected = sign(payload);

  if (
    expected.length !== signature.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  ) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}
