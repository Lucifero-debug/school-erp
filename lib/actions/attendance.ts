// lib/actions/attendance.ts
//
// Attendance is marked for a whole section on one date, in one submit.
// A teacher with 40 children will not click 40 times, so the form
// defaults everyone to present and they only change the absentees.
//
// Re-marking a day UPDATES, never appends — @@unique([enrollmentId,
// onDate]) in the schema enforces that.

"use server";

import { revalidatePath } from "next/cache";
import { db } from "../db";
import {
  requireRole,
  currentAcademicYear,
  assertCanTouchSection,
  CAN_EDIT_MARKS,
} from "../session";
import { audit } from "../audit";
import { startOfDay } from "../format";
import { fail, done, type ActionState } from "../result";

const VALID = ["PRESENT", "ABSENT", "LATE", "LEAVE", "HALF_DAY"] as const;
type Status = (typeof VALID)[number];

export async function markAttendance(
  sectionId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(CAN_EDIT_MARKS);
  const year = await currentAcademicYear();

  if (year.lockedAt) return fail("This academic year is locked.");

  // A teacher may only touch their own section, whatever the form says.
  await assertCanTouchSection(sectionId);

  const dateRaw = String(formData.get("onDate") ?? "");
  const onDate = startOfDay(new Date(dateRaw));

  if (Number.isNaN(onDate.getTime())) return fail("Pick a valid date.");

  if (onDate > new Date()) {
    return fail("You cannot mark attendance for a future date.");
  }

  if (onDate < year.startsOn || onDate > year.endsOn) {
    return fail("That date is outside this academic year.");
  }

  // A holiday means nobody was expected. Marking it would distort the
  // attendance percentage that board eligibility depends on.
  const holiday = await db.holiday.findFirst({
    where: { academicYearId: year.id, onDate },
  });

  if (holiday) return fail(`${holiday.name} is a holiday. Nothing to mark.`);

  const enrollments = await db.enrollment.findMany({
    where: { sectionId, academicYearId: year.id, status: "ACTIVE" },
    select: { id: true },
  });

  if (enrollments.length === 0) return fail("No students in this section.");

  let marked = 0;

  await db.$transaction(async (tx) => {
    for (const e of enrollments) {
      const raw = String(formData.get(`s_${e.id}`) ?? "PRESENT");
      const status = (VALID as readonly string[]).includes(raw)
        ? (raw as Status)
        : "PRESENT";

      await tx.attendance.upsert({
        where: { enrollmentId_onDate: { enrollmentId: e.id, onDate } },
        create: {
          enrollmentId: e.id,
          onDate,
          status,
          markedById: session.staffId,
        },
        update: { status, markedById: session.staffId },
      });

      marked++;
    }
  });

  await audit({
    action: "attendance.mark",
    entityType: "Section",
    entityId: sectionId,
    after: { onDate: onDate.toISOString(), marked },
  });

  revalidatePath("/attendance");

  return done(`Attendance saved for ${marked} students.`);
}

export async function addHoliday(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireRole(["ADMIN", "PRINCIPAL"]);
  const year = await currentAcademicYear();

  const onDate = startOfDay(new Date(String(formData.get("onDate") ?? "")));
  if (Number.isNaN(onDate.getTime())) return fail("Pick a valid date.");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return fail("Give the holiday a name.");

  const existing = await db.holiday.findFirst({
    where: { academicYearId: year.id, onDate },
  });

  if (existing) return fail("That date is already marked as a holiday.");

  await db.holiday.create({
    data: { academicYearId: year.id, onDate, name },
  });

  revalidatePath("/attendance/register");
  return done("Holiday added.");
}
