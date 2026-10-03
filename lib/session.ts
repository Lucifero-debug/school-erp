// lib/session.ts
//
// The single place the app answers "who is asking, which school, and
// what are they allowed to do".
//
// Pages do not check auth individually — they all call currentSchoolId()
// or requireRole(), and an unauthenticated caller is redirected to
// /login from here. That makes it impossible to forget the check on a
// new page.

import { redirect } from "next/navigation";
import { readSession, type SessionData } from "./auth";
import { db } from "./db";

export async function requireSession(): Promise<SessionData> {
  const session = await readSession();
  if (!session) redirect("/login");
  return session;
}

export async function currentSchoolId(): Promise<string> {
  return (await requireSession()).schoolId;
}

export async function currentStaffId(): Promise<string> {
  return (await requireSession()).staffId;
}

export async function optionalSession(): Promise<SessionData | null> {
  return readSession();
}

// ---------------------------------------------------------------
// Roles
//
// ADMIN       everything
// PRINCIPAL   everything except staff and school settings
// ACCOUNTANT  fees and money; can see students, cannot edit marks
// TEACHER     own sections only: attendance and marks. No money.
// CLERK       admissions and records. No money, no marks.
//
// A teacher must never see the fee ledger, and a clerk must never
// collect money. These are the two separations schools care about.
// ---------------------------------------------------------------

export type Role = "ADMIN" | "PRINCIPAL" | "ACCOUNTANT" | "TEACHER" | "CLERK";

export const CAN_HANDLE_MONEY: Role[] = ["ADMIN", "PRINCIPAL", "ACCOUNTANT"];
export const CAN_EDIT_MARKS: Role[] = ["ADMIN", "PRINCIPAL", "TEACHER"];
export const CAN_EDIT_STUDENTS: Role[] = ["ADMIN", "PRINCIPAL", "CLERK"];
export const CAN_MANAGE_SCHOOL: Role[] = ["ADMIN"];

export async function requireRole(allowed: Role[]): Promise<SessionData> {
  const session = await requireSession();

  if (!allowed.includes(session.role as Role)) {
    // A 404 rather than a 403 — someone poking at /fees has no business
    // learning that the page exists.
    redirect("/");
  }

  return session;
}

export async function hasRole(allowed: Role[]): Promise<boolean> {
  const session = await readSession();
  return session ? allowed.includes(session.role as Role) : false;
}

// Teachers may only touch sections they are class teacher of. Checked
// at the point of writing attendance or marks, never assumed from the
// UI having hidden a button.
export async function assertCanTouchSection(sectionId: string) {
  const session = await requireSession();

  if (session.role !== "TEACHER") return;

  const owned = await db.section.findFirst({
    where: { id: sectionId, classTeacherId: session.staffId },
    select: { id: true },
  });

  if (!owned) redirect("/");
}

// ---------------------------------------------------------------
// Current academic year
//
// Almost every query needs it. Fetched here so no page hardcodes a
// year and so switching years is one database update.
// ---------------------------------------------------------------

export async function currentAcademicYear() {
  const schoolId = await currentSchoolId();

  const year = await db.academicYear.findFirst({
    where: { schoolId, isCurrent: true },
  });

  if (!year) {
    throw new Error(
      "No current academic year is set. An admin must mark one as current in Settings."
    );
  }

  return year;
}
