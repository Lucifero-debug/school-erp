// lib/actions/leaving.ts
//
// Transfer certificates and year-end promotion. The two things that
// happen when a student stops being in their current class.
//
// A TC is a legal document. It is numbered, never deleted, and most
// schools will not issue one until dues are cleared — so the dues
// check is in the code, with a deliberate override that gets recorded.

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../db";
import { requireRole, currentAcademicYear } from "../session";
import { audit } from "../audit";
import { nextTcNumber } from "../numbering";
import { fail, done, type ActionState } from "../result";

// ---------------------------------------------------------------
// Transfer certificate
// ---------------------------------------------------------------

export async function issueTC(
  studentId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN", "PRINCIPAL"]);
  const year = await currentAcademicYear();

  const student = await db.student.findFirst({
    where: { id: studentId, schoolId: session.schoolId, deletedAt: null },
    include: {
      tc: true,
      enrollments: {
        where: { academicYearId: year.id },
        include: { section: { include: { klass: true } } },
      },
      demands: {
        where: {
          cancelledAt: null,
          status: { in: ["OPEN", "PART_PAID"] },
        },
      },
    },
  });

  if (!student) return fail("That student was not found.");
  if (student.tc) return fail(`A TC was already issued: ${student.tc.number}.`);

  const outstanding = student.demands.reduce(
    (t, d) => t + Number(d.net) + Number(d.lateFee) - Number(d.paid),
    0
  );

  const override = formData.get("overrideDues") === "on";

  if (outstanding > 0 && !override) {
    return fail(
      `₹${outstanding.toLocaleString("en-IN")} is still outstanding. Clear it, or tick the override — the override is recorded.`
    );
  }

  const enrollment = student.enrollments[0];

  const lastClass = enrollment
    ? `${enrollment.section.klass.name}-${enrollment.section.name}`
    : "—";

  const issuedOn = new Date();

  const tc = await db.$transaction(async (tx) => {
    const number = await nextTcNumber(tx, session.schoolId, year.name);

    const created = await tx.transferCertificate.create({
      data: {
        studentId: student.id,
        number,
        issuedOn,
        lastClass,
        reason: String(formData.get("reason") ?? "").trim() || null,
        conduct: String(formData.get("conduct") ?? "Satisfactory").trim(),
        duesCleared: outstanding <= 0,
        issuedById: session.staffId,
      },
    });

    // The student leaves the roll, and this year's enrollment closes.
    await tx.student.update({
      where: { id: student.id },
      data: { status: "LEFT", leftOn: issuedOn },
    });

    if (enrollment) {
      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: { status: "TRANSFERRED" },
      });
    }

    return created;
  });

  await audit({
    action: "student.tc.issue",
    entityType: "Student",
    entityId: student.id,
    after: {
      number: tc.number,
      outstanding,
      duesOverridden: outstanding > 0 && override,
    },
  });

  revalidatePath(`/students/${student.id}`);
  redirect(`/students/${student.id}/tc`);
}

// ---------------------------------------------------------------
// Promotion
//
// Deliberately NOT a side effect of switching the academic year.
// Promotion and detention are decisions, and a school wants to look at
// the list before it happens.
//
// Run per class, into the next year. Students are promoted into the
// class one rank higher, keeping their section letter where it exists.
// ---------------------------------------------------------------

export type PromotionCandidate = {
  enrollmentId: string;
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  outstanding: number;
  attendancePercent: number | null;
};

export async function promotionPreview(
  fromKlassId: string,
  toYearId: string
): Promise<{
  candidates: PromotionCandidate[];
  targetKlass: string | null;
  alreadyEnrolled: number;
}> {
  const session = await requireRole(["ADMIN", "PRINCIPAL"]);
  const year = await currentAcademicYear();

  const fromKlass = await db.klass.findFirst({
    where: { id: fromKlassId, schoolId: session.schoolId },
  });

  if (!fromKlass) return { candidates: [], targetKlass: null, alreadyEnrolled: 0 };

  // Next class up by rank. The highest class has none — those students
  // pass out rather than promote.
  const target = await db.klass.findFirst({
    where: {
      schoolId: session.schoolId,
      deletedAt: null,
      rank: { gt: fromKlass.rank },
    },
    orderBy: { rank: "asc" },
  });

  const enrollments = await db.enrollment.findMany({
    where: {
      academicYearId: year.id,
      status: "ACTIVE",
      section: { klassId: fromKlassId },
      student: { status: "ACTIVE", deletedAt: null },
    },
    orderBy: { rollNo: "asc" },
    include: {
      student: {
        include: {
          demands: {
            where: {
              cancelledAt: null,
              status: { in: ["OPEN", "PART_PAID"] },
            },
          },
          enrollments: { where: { academicYearId: toYearId } },
        },
      },
      attendance: { select: { status: true } },
      section: true,
    },
  });

  const WEIGHT: Record<string, number> = {
    PRESENT: 1,
    LATE: 1,
    HALF_DAY: 0.5,
    LEAVE: 0,
    ABSENT: 0,
  };

  let alreadyEnrolled = 0;

  const candidates: PromotionCandidate[] = [];

  for (const e of enrollments) {
    if (e.student.enrollments.length > 0) {
      alreadyEnrolled++;
      continue;
    }

    const present = e.attendance.reduce(
      (t, a) => t + (WEIGHT[a.status] ?? 0),
      0
    );

    candidates.push({
      enrollmentId: e.id,
      studentId: e.studentId,
      name: `${e.student.firstName} ${e.student.lastName ?? ""}`.trim(),
      admissionNo: e.student.admissionNo,
      rollNo: e.rollNo,
      outstanding: e.student.demands.reduce(
        (t, d) => t + Number(d.net) + Number(d.lateFee) - Number(d.paid),
        0
      ),
      attendancePercent:
        e.attendance.length > 0
          ? (present / e.attendance.length) * 100
          : null,
    });
  }

  return {
    candidates,
    targetKlass: target?.name ?? null,
    alreadyEnrolled,
  };
}

export async function promoteClass(
  fromKlassId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN", "PRINCIPAL"]);
  const year = await currentAcademicYear();

  const toYearId = String(formData.get("toYearId") ?? "");

  const toYear = await db.academicYear.findFirst({
    where: { id: toYearId, schoolId: session.schoolId },
  });

  if (!toYear) return fail("Choose the year to promote into.");
  if (toYear.id === year.id) return fail("That is the current year.");
  if (toYear.lockedAt) return fail("That year is locked.");

  const fromKlass = await db.klass.findFirst({
    where: { id: fromKlassId, schoolId: session.schoolId },
  });

  if (!fromKlass) return fail("That class was not found.");

  const target = await db.klass.findFirst({
    where: {
      schoolId: session.schoolId,
      deletedAt: null,
      rank: { gt: fromKlass.rank },
    },
    orderBy: { rank: "asc" },
    include: { sections: { where: { deletedAt: null } } },
  });

  if (!target) {
    return fail(
      `${fromKlass.name} is the highest class. Mark those students as passed out instead.`
    );
  }

  if (target.sections.length === 0) {
    return fail(`Class ${target.name} has no sections. Create one first.`);
  }

  const enrollments = await db.enrollment.findMany({
    where: {
      academicYearId: year.id,
      status: "ACTIVE",
      section: { klassId: fromKlassId },
      student: { status: "ACTIVE", deletedAt: null },
    },
    orderBy: { rollNo: "asc" },
    include: { section: true },
  });

  let promoted = 0;
  let detained = 0;
  let skipped = 0;

  await db.$transaction(
    async (tx) => {
      // Roll numbers restart per section in the new year.
      const rollCounters = new Map<string, number>();

      for (const sec of target.sections) {
        const used = await tx.enrollment.count({
          where: { sectionId: sec.id, academicYearId: toYear.id },
        });
        rollCounters.set(sec.id, used);
      }

      for (const e of enrollments) {
        // Already has a place next year? Leave it alone — re-running
        // must not create a second enrollment.
        const existing = await tx.enrollment.findFirst({
          where: { studentId: e.studentId, academicYearId: toYear.id },
        });

        if (existing) {
          skipped++;
          continue;
        }

        const detain = formData.get(`detain_${e.id}`) === "on";

        if (detain) {
          // Detained: same class again next year, same section letter
          // if it exists there.
          const sameSection = await tx.section.findFirst({
            where: { klassId: fromKlassId, name: e.section.name, deletedAt: null },
          });

          const sectionId = sameSection?.id ?? e.sectionId;

          const used = await tx.enrollment.count({
            where: { sectionId, academicYearId: toYear.id },
          });

          await tx.enrollment.create({
            data: {
              studentId: e.studentId,
              academicYearId: toYear.id,
              sectionId,
              rollNo: used + 1,
            },
          });

          await tx.enrollment.update({
            where: { id: e.id },
            data: { status: "DETAINED" },
          });

          detained++;
          continue;
        }

        // Keep the section letter where the target class has it,
        // otherwise the first section.
        const sameLetter = target.sections.find((s) => s.name === e.section.name);
        const dest = sameLetter ?? target.sections[0];

        const next = (rollCounters.get(dest.id) ?? 0) + 1;
        rollCounters.set(dest.id, next);

        await tx.enrollment.create({
          data: {
            studentId: e.studentId,
            academicYearId: toYear.id,
            sectionId: dest.id,
            rollNo: next,
          },
        });

        await tx.enrollment.update({
          where: { id: e.id },
          data: { status: "PROMOTED" },
        });

        promoted++;
      }
    },
    { timeout: 120_000, maxWait: 10_000 }
  );

  await audit({
    action: "students.promote",
    entityType: "Klass",
    entityId: fromKlassId,
    after: { toYear: toYear.name, promoted, detained, skipped },
  });

  revalidatePath("/students/promote");

  return done(
    `${promoted} promoted to ${target.name}${
      detained > 0 ? `, ${detained} detained in ${fromKlass.name}` : ""
    }${skipped > 0 ? `, ${skipped} already had a place` : ""} for ${toYear.name}.`
  );
}

// The highest class does not promote — those students finish.
export async function markPassedOut(
  klassId: string,
  _prev: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN", "PRINCIPAL"]);
  const year = await currentAcademicYear();

  const enrollments = await db.enrollment.findMany({
    where: {
      academicYearId: year.id,
      status: "ACTIVE",
      section: { klassId },
      student: { schoolId: session.schoolId, status: "ACTIVE" },
    },
  });

  if (enrollments.length === 0) return fail("No active students in that class.");

  await db.$transaction([
    db.student.updateMany({
      where: { id: { in: enrollments.map((e) => e.studentId) } },
      data: { status: "PASSED_OUT", leftOn: new Date() },
    }),
    db.enrollment.updateMany({
      where: { id: { in: enrollments.map((e) => e.id) } },
      data: { status: "PROMOTED" },
    }),
  ]);

  await audit({
    action: "students.passed_out",
    entityType: "Klass",
    entityId: klassId,
    after: { count: enrollments.length },
  });

  revalidatePath("/students/promote");
  return done(`${enrollments.length} students marked as passed out.`);
}
