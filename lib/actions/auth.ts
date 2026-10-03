// lib/actions/auth.ts

"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { requireSession, requireRole } from "../session";
import { audit } from "../audit";
import {
  createSession,
  destroySession,
  hashPassword,
  verifyPassword,
} from "../auth";
import { fail, done, type ActionState } from "../result";

const MAX_ATTEMPTS = 8;
const WINDOW_MINUTES = 15;

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null
  );
}

export async function signIn(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const phone = String(formData.get("phone") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!phone || !password) {
    return fail("Enter your phone number and password.");
  }

  const ip = await clientIp();
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);

  // Throttle on both phone and IP, so neither a targeted attack on one
  // account nor a spray across many gets far. Counted in the database
  // because serverless functions do not share memory.
  const recentFailures = await db.loginAttempt.count({
    where: {
      success: false,
      createdAt: { gte: since },
      OR: [{ phone }, ...(ip ? [{ ip }] : [])],
    },
  });

  if (recentFailures >= MAX_ATTEMPTS) {
    return fail(
      `Too many failed attempts. Wait ${WINDOW_MINUTES} minutes, or ask an admin to reset your password.`
    );
  }

  const staff = await db.staff.findFirst({
    where: { phone, active: true, deletedAt: null },
  });

  const okCredentials =
    staff?.passwordHash && verifyPassword(password, staff.passwordHash);

  await db.loginAttempt.create({
    data: { phone, ip, success: Boolean(okCredentials) },
  });

  // Same message either way — never reveal whether the number exists.
  if (!staff || !okCredentials) {
    const left = MAX_ATTEMPTS - recentFailures - 1;

    return fail(
      left <= 3
        ? `That phone number and password do not match. ${left} attempt${
            left === 1 ? "" : "s"
          } left before this is locked.`
        : "That phone number and password do not match."
    );
  }

  await createSession({
    staffId: staff.id,
    schoolId: staff.schoolId,
    name: staff.name,
    role: staff.role,
  });

  redirect("/");
}

export async function signOut() {
  await destroySession();
  redirect("/login");
}

export async function changeOwnPassword(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (next.length < 8) return fail("Your new password needs at least 8 characters.");
  if (next !== confirm) return fail("The two new passwords do not match.");

  const staff = await db.staff.findUnique({ where: { id: session.staffId } });

  if (!staff?.passwordHash || !verifyPassword(current, staff.passwordHash)) {
    return fail("Your current password is not correct.");
  }

  await db.staff.update({
    where: { id: staff.id },
    data: { passwordHash: hashPassword(next), passwordSetByAdmin: false },
  });

  await audit({
    action: "staff.password.change",
    entityType: "Staff",
    entityId: staff.id,
  });

  return done("Password changed.");
}

// No email in this system, so resets happen in person. For a school
// office that is how it actually works.
export async function resetStaffPassword(
  staffId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN"]);

  const next = String(formData.get("password") ?? "");
  if (next.length < 8) return fail("The new password needs at least 8 characters.");

  const updated = await db.staff.updateMany({
    where: { id: staffId, schoolId: session.schoolId },
    data: { passwordHash: hashPassword(next), passwordSetByAdmin: true },
  });

  if (updated.count === 0) return fail("That staff member was not found.");

  // Clear the lockout so they can sign in straight away.
  const staff = await db.staff.findUnique({ where: { id: staffId } });
  if (staff) await db.loginAttempt.deleteMany({ where: { phone: staff.phone } });

  await audit({
    action: "staff.password.reset",
    entityType: "Staff",
    entityId: staffId,
  });

  revalidatePath("/settings");
  return done("Password reset. Ask them to change it after signing in.");
}
