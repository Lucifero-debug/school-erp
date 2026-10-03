// lib/actions/students.ts

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../db";
import {
  requireRole,
  currentAcademicYear,
  CAN_EDIT_STUDENTS,
} from "../session";
import { audit } from "../audit";
import { nextAdmissionNumber } from "../numbering";
import {
  fail,
  done,
  isError,
  optionalDate,
  requirePhone,
  requireText,
  type ActionState,
} from "../result";

export async function admitStudent(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(CAN_EDIT_STUDENTS);
  const year = await currentAcademicYear();

  if (year.lockedAt) return fail("This academic year is locked.");

  const firstName = requireText(formData.get("firstName"), "First name", 80);
  if (isError(firstName)) return fail(firstName.error);

  const sectionId = String(formData.get("sectionId") ?? "");
  if (!sectionId) return fail("Choose a class and section.");

  // The section must belong to this school. Never trust an id from a
  // form — see CONTEXT.md §4.4.
  const section = await db.section.findFirst({
    where: { id: sectionId, klass: { schoolId: session.schoolId } },
  });

  if (!section) return fail("That class section was not found.");

  const guardianName = requireText(
    formData.get("guardianName"),
    "Guardian name",
    120
  );
  if (isError(guardianName)) return fail(guardianName.error);

  const guardianPhone = requirePhone(formData.get("guardianPhone"));
  if (isError(guardianPhone)) return fail(guardianPhone.error);

  const dob = optionalDate(formData.get("dob"), "Date of birth");
  if (isError(dob)) return fail(dob.error);

  // DPDP: a child's data needs verifiable guardian consent. The form
  // makes this a required tick, and we record how it was obtained.
  if (formData.get("consent") !== "on") {
    return fail(
      "Guardian consent is required before a child's details can be stored."
    );
  }

  const gender = String(formData.get("gender") ?? "");

  const student = await db.$transaction(async (tx) => {
    const admissionNo = await nextAdmissionNumber(
      tx,
      session.schoolId,
      year.name
    );

    const created = await tx.student.create({
      data: {
        schoolId: session.schoolId,
        admissionNo,
        firstName: firstName.value,
        lastName: String(formData.get("lastName") ?? "").trim() || null,
        dob: dob.value,
        gender:
          gender === "MALE" || gender === "FEMALE" || gender === "OTHER"
            ? gender
            : null,
        category: String(formData.get("category") ?? "").trim() || null,
        address: String(formData.get("address") ?? "").trim() || null,
        city: String(formData.get("city") ?? "").trim() || null,
        admittedOn: new Date(),
        guardians: {
          create: [
            {
              relation: String(formData.get("relation") ?? "FATHER") as never,
              name: guardianName.value,
              phone: guardianPhone.value,
              email: String(formData.get("guardianEmail") ?? "").trim() || null,
              isPrimary: true,
              consentGivenAt: new Date(),
              consentMethod: String(formData.get("consentMethod") ?? "admission form"),
              messagingConsent: formData.get("messagingConsent") === "on",
            },
          ],
        },
      },
    });

    // Roll number: next free in the section this year.
    const taken = await tx.enrollment.count({
      where: { sectionId, academicYearId: year.id },
    });

    await tx.enrollment.create({
      data: {
        studentId: created.id,
        academicYearId: year.id,
        sectionId,
        rollNo: taken + 1,
      },
    });

    return created;
  });

  await audit({
    action: "student.admit",
    entityType: "Student",
    entityId: student.id,
    after: { admissionNo: student.admissionNo, name: student.firstName },
  });

  revalidatePath("/students");
  redirect(`/students/${student.id}`);
}

export async function updateStudent(
  studentId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(CAN_EDIT_STUDENTS);

  const before = await db.student.findFirst({
    where: { id: studentId, schoolId: session.schoolId, deletedAt: null },
  });

  if (!before) return fail("That student was not found.");

  const firstName = requireText(formData.get("firstName"), "First name", 80);
  if (isError(firstName)) return fail(firstName.error);

  const dob = optionalDate(formData.get("dob"), "Date of birth");
  if (isError(dob)) return fail(dob.error);

  const gender = String(formData.get("gender") ?? "");

  await db.student.update({
    where: { id: before.id },
    data: {
      firstName: firstName.value,
      lastName: String(formData.get("lastName") ?? "").trim() || null,
      dob: dob.value,
      gender:
        gender === "MALE" || gender === "FEMALE" || gender === "OTHER"
          ? gender
          : null,
      category: String(formData.get("category") ?? "").trim() || null,
      address: String(formData.get("address") ?? "").trim() || null,
      city: String(formData.get("city") ?? "").trim() || null,
      srNo: String(formData.get("srNo") ?? "").trim() || null,
      apaarId: String(formData.get("apaarId") ?? "").trim() || null,
    },
  });

  await audit({
    action: "student.update",
    entityType: "Student",
    entityId: before.id,
    before: { firstName: before.firstName, lastName: before.lastName },
    after: { firstName: firstName.value },
  });

  revalidatePath(`/students/${before.id}`);
  redirect(`/students/${before.id}`);
}

export async function updateGuardian(
  guardianId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(CAN_EDIT_STUDENTS);

  const guardian = await db.guardian.findFirst({
    where: { id: guardianId, student: { schoolId: session.schoolId } },
  });

  if (!guardian) return fail("That guardian record was not found.");

  const name = requireText(formData.get("name"), "Name", 120);
  if (isError(name)) return fail(name.error);

  const phone = requirePhone(formData.get("phone"));
  if (isError(phone)) return fail(phone.error);

  await db.guardian.update({
    where: { id: guardian.id },
    data: {
      name: name.value,
      phone: phone.value,
      email: String(formData.get("email") ?? "").trim() || null,
      occupation: String(formData.get("occupation") ?? "").trim() || null,
      messagingConsent: formData.get("messagingConsent") === "on",
    },
  });

  await audit({
    action: "guardian.update",
    entityType: "Guardian",
    entityId: guardian.id,
  });

  revalidatePath(`/students/${guardian.studentId}`);
  return done("Guardian details saved.");
}

// Moving a student between sections mid-year is an UPDATE to the one
// enrollment, not a second row — see CONTEXT.md §4.1.
export async function changeSection(
  studentId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(CAN_EDIT_STUDENTS);
  const year = await currentAcademicYear();

  if (year.lockedAt) return fail("This academic year is locked.");

  const sectionId = String(formData.get("sectionId") ?? "");

  const section = await db.section.findFirst({
    where: { id: sectionId, klass: { schoolId: session.schoolId } },
  });

  if (!section) return fail("That section was not found.");

  const enrollment = await db.enrollment.findFirst({
    where: { studentId, academicYearId: year.id },
  });

  if (!enrollment) return fail("This student is not enrolled this year.");

  const taken = await db.enrollment.count({
    where: { sectionId, academicYearId: year.id },
  });

  await db.enrollment.update({
    where: { id: enrollment.id },
    data: { sectionId, rollNo: taken + 1 },
  });

  await audit({
    action: "enrollment.move",
    entityType: "Enrollment",
    entityId: enrollment.id,
    before: { sectionId: enrollment.sectionId },
    after: { sectionId },
  });

  revalidatePath(`/students/${studentId}`);
  return done("Section changed.");
}
