// lib/actions/settings.ts
//
// School setup: classes, sections, subjects, fee heads, structures,
// installments, academic years, staff.
//
// Mostly ADMIN-only. The things that can quietly break a year's
// records — rolling over the academic year, locking a year — are
// called out in comments where they appear.

"use server";

import { revalidatePath } from "next/cache";
import { db } from "../db";
import { requireRole, currentAcademicYear } from "../session";
import { audit } from "../audit";
import { hashPassword } from "../auth";
import {
  fail,
  done,
  isError,
  requireMoney,
  requirePhone,
  requireText,
  type ActionState,
} from "../result";

// ---------------------------------------------------------------
// School
// ---------------------------------------------------------------

export async function saveSchool(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN"]);

  const name = requireText(formData.get("name"), "School name", 160);
  if (isError(name)) return fail(name.error);

  const phone = requirePhone(formData.get("phone"));
  if (isError(phone)) return fail(phone.error);

  await db.school.update({
    where: { id: session.schoolId },
    data: {
      name: name.value,
      phone: phone.value,
      email: String(formData.get("email") ?? "").trim() || null,
      address: String(formData.get("address") ?? "").trim(),
      city: String(formData.get("city") ?? "").trim(),
      state: String(formData.get("state") ?? "").trim(),
      pincode: String(formData.get("pincode") ?? "").trim() || null,
      udiseCode: String(formData.get("udiseCode") ?? "").trim() || null,
      affiliationNo: String(formData.get("affiliationNo") ?? "").trim() || null,
      board: String(formData.get("board") ?? "CBSE") as never,
    },
  });

  revalidatePath("/settings");
  return done("School details saved. They appear on receipts and report cards.");
}

// ---------------------------------------------------------------
// Classes, sections, subjects
// ---------------------------------------------------------------

export async function addClass(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN"]);

  const name = requireText(formData.get("name"), "Class name", 40);
  if (isError(name)) return fail(name.error);

  const rank = Number(formData.get("rank") ?? 0);
  if (!Number.isFinite(rank)) return fail("Order must be a number.");

  const clash = await db.klass.findFirst({
    where: { schoolId: session.schoolId, name: name.value, deletedAt: null },
  });

  if (clash) return fail("A class with that name already exists.");

  const klass = await db.klass.create({
    data: { schoolId: session.schoolId, name: name.value, rank },
  });

  // A class with no section cannot hold students, so make one.
  await db.section.create({ data: { klassId: klass.id, name: "A" } });

  revalidatePath("/settings");
  return done(`Class ${name.value} added with section A.`);
}

export async function addSection(
  klassId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN"]);

  const klass = await db.klass.findFirst({
    where: { id: klassId, schoolId: session.schoolId },
  });

  if (!klass) return fail("That class was not found.");

  const name = requireText(formData.get("name"), "Section name", 20);
  if (isError(name)) return fail(name.error);

  const clash = await db.section.findFirst({
    where: { klassId, name: name.value, deletedAt: null },
  });

  if (clash) return fail("That section already exists.");

  await db.section.create({
    data: {
      klassId,
      name: name.value,
      classTeacherId: String(formData.get("classTeacherId") ?? "") || null,
    },
  });

  revalidatePath("/settings");
  return done("Section added.");
}

export async function setClassTeacher(
  sectionId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN", "PRINCIPAL"]);

  const section = await db.section.findFirst({
    where: { id: sectionId, klass: { schoolId: session.schoolId } },
  });

  if (!section) return fail("That section was not found.");

  const staffId = String(formData.get("classTeacherId") ?? "") || null;

  if (staffId) {
    const staff = await db.staff.findFirst({
      where: { id: staffId, schoolId: session.schoolId, active: true },
    });

    if (!staff) return fail("That staff member was not found.");
  }

  await db.section.update({
    where: { id: section.id },
    data: { classTeacherId: staffId },
  });

  revalidatePath("/settings");
  return done("Class teacher updated.");
}

export async function addSubject(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN"]);

  const name = requireText(formData.get("name"), "Subject name", 80);
  if (isError(name)) return fail(name.error);

  const clash = await db.subject.findFirst({
    where: { schoolId: session.schoolId, name: name.value, deletedAt: null },
  });

  if (clash) return fail("That subject already exists.");

  await db.subject.create({
    data: {
      schoolId: session.schoolId,
      name: name.value,
      code: String(formData.get("code") ?? "").trim() || null,
      // Co-scholastic subjects are graded, not marked, and print in a
      // separate block on the report card.
      isScholastic: formData.get("isScholastic") === "on",
    },
  });

  revalidatePath("/settings");
  return done("Subject added.");
}

// ---------------------------------------------------------------
// Fee setup
// ---------------------------------------------------------------

export async function addFeeHead(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN", "PRINCIPAL"]);

  const name = requireText(formData.get("name"), "Fee head", 80);
  if (isError(name)) return fail(name.error);

  const clash = await db.feeHead.findFirst({
    where: { schoolId: session.schoolId, name: name.value, deletedAt: null },
  });

  if (clash) return fail("That fee head already exists.");

  await db.feeHead.create({
    data: {
      schoolId: session.schoolId,
      name: name.value,
      refundable: formData.get("refundable") === "on",
    },
  });

  revalidatePath("/settings/fees");
  return done("Fee head added.");
}

export async function setStructureItem(
  klassId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN", "PRINCIPAL"]);
  const year = await currentAcademicYear();

  const klass = await db.klass.findFirst({
    where: { id: klassId, schoolId: session.schoolId },
  });

  if (!klass) return fail("That class was not found.");

  const feeHeadId = String(formData.get("feeHeadId") ?? "");

  const head = await db.feeHead.findFirst({
    where: { id: feeHeadId, schoolId: session.schoolId },
  });

  if (!head) return fail("That fee head was not found.");

  const amount = requireMoney(formData.get("amount"), "Amount");
  if (isError(amount)) return fail(amount.error);

  const frequency = String(formData.get("frequency") ?? "MONTHLY");

  const structure = await db.feeStructure.upsert({
    where: {
      academicYearId_klassId: { academicYearId: year.id, klassId },
    },
    create: { academicYearId: year.id, klassId },
    update: {},
  });

  await db.feeStructureItem.upsert({
    where: {
      structureId_feeHeadId: { structureId: structure.id, feeHeadId },
    },
    create: {
      structureId: structure.id,
      feeHeadId,
      amount: amount.value,
      frequency: frequency as never,
    },
    update: { amount: amount.value, frequency: frequency as never },
  });

  await audit({
    action: "fees.structure.set",
    entityType: "Klass",
    entityId: klassId,
    after: { feeHeadId, amount: amount.value, frequency },
  });

  revalidatePath("/settings/fees");

  return done(
    "Saved. Demands already raised are unchanged — this applies to the next installment you raise."
  );
}

export async function addInstallment(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireRole(["ADMIN", "PRINCIPAL"]);
  const year = await currentAcademicYear();

  const name = requireText(formData.get("name"), "Installment name", 60);
  if (isError(name)) return fail(name.error);

  const dueOn = new Date(String(formData.get("dueOn") ?? ""));
  if (Number.isNaN(dueOn.getTime())) return fail("Pick a valid due date.");

  const count = await db.feeInstallment.count({
    where: { academicYearId: year.id },
  });

  await db.feeInstallment.create({
    data: {
      academicYearId: year.id,
      name: name.value,
      seq: count + 1,
      dueOn,
      lateFeeAfterDays: Number(formData.get("lateFeeAfterDays") ?? 0) || 0,
      lateFeePerDay: Number(formData.get("lateFeePerDay") ?? 0) || 0,
      lateFeeMax: Number(formData.get("lateFeeMax") ?? 0) || 0,
    },
  });

  revalidatePath("/settings/fees");
  return done("Installment added.");
}

// ---------------------------------------------------------------
// Staff
// ---------------------------------------------------------------

export async function addStaff(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN"]);

  const name = requireText(formData.get("name"), "Name", 120);
  if (isError(name)) return fail(name.error);

  const phone = requirePhone(formData.get("phone"));
  if (isError(phone)) return fail(phone.error);

  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return fail("The password needs at least 8 characters.");

  const clash = await db.staff.findFirst({
    where: { schoolId: session.schoolId, phone: phone.value },
  });

  if (clash) return fail("Someone already signs in with that number.");

  await db.staff.create({
    data: {
      schoolId: session.schoolId,
      name: name.value,
      phone: phone.value,
      role: String(formData.get("role") ?? "TEACHER") as never,
      designation: String(formData.get("designation") ?? "").trim() || null,
      qualification: String(formData.get("qualification") ?? "").trim() || null,
      passwordHash: hashPassword(password),
      passwordSetByAdmin: true,
    },
  });

  revalidatePath("/settings");
  return done("Staff member added.");
}

export async function deactivateStaff(staffId: string) {
  const session = await requireRole(["ADMIN"]);

  if (staffId === session.staffId) return; // cannot lock yourself out

  await db.staff.updateMany({
    where: { id: staffId, schoolId: session.schoolId },
    data: { active: false },
  });

  revalidatePath("/settings");
}

// ---------------------------------------------------------------
// Academic years
//
// The riskiest thing in this file. Switching the current year changes
// what every screen in the app shows.
// ---------------------------------------------------------------

export async function createAcademicYear(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN"]);

  const name = requireText(formData.get("name"), "Year name", 20);
  if (isError(name)) return fail(name.error);

  const startsOn = new Date(String(formData.get("startsOn") ?? ""));
  const endsOn = new Date(String(formData.get("endsOn") ?? ""));

  if (Number.isNaN(startsOn.getTime()) || Number.isNaN(endsOn.getTime())) {
    return fail("Pick valid start and end dates.");
  }

  if (endsOn <= startsOn) return fail("The end date must be after the start.");

  const clash = await db.academicYear.findFirst({
    where: { schoolId: session.schoolId, name: name.value },
  });

  if (clash) return fail("That academic year already exists.");

  // Created but NOT made current. Switching is a separate, deliberate
  // action — see makeYearCurrent below.
  await db.academicYear.create({
    data: { schoolId: session.schoolId, name: name.value, startsOn, endsOn },
  });

  revalidatePath("/settings");
  return done(
    `${name.value} created. It is not current yet — set up classes and fees first, then switch.`
  );
}

export async function makeYearCurrent(
  yearId: string,
  _prev: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN"]);

  const year = await db.academicYear.findFirst({
    where: { id: yearId, schoolId: session.schoolId },
  });

  if (!year) return fail("That academic year was not found.");

  // Students are NOT promoted by this. Enrollment for the new year has
  // to be created per student — deliberately, because promotion and
  // detention are decisions, not a side effect of changing a setting.
  await db.$transaction([
    db.academicYear.updateMany({
      where: { schoolId: session.schoolId },
      data: { isCurrent: false },
    }),
    db.academicYear.update({
      where: { id: yearId },
      data: { isCurrent: true },
    }),
  ]);

  await audit({
    action: "year.switch",
    entityType: "AcademicYear",
    entityId: yearId,
    after: { name: year.name },
  });

  revalidatePath("/");

  return done(
    `Now showing ${year.name}. Students are not enrolled in it yet — enroll them before raising fees.`
  );
}

export async function lockYear(
  yearId: string,
  _prev: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN"]);

  const year = await db.academicYear.findFirst({
    where: { id: yearId, schoolId: session.schoolId },
  });

  if (!year) return fail("That academic year was not found.");
  if (year.isCurrent) return fail("You cannot lock the current year.");

  await db.academicYear.update({
    where: { id: yearId },
    data: { lockedAt: year.lockedAt ? null : new Date() },
  });

  revalidatePath("/settings");

  return done(
    year.lockedAt
      ? `${year.name} unlocked.`
      : `${year.name} locked. Its marks and fees are now read only.`
  );
}
