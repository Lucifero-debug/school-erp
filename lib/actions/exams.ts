// lib/actions/exams.ts
//
// Marks are entered a whole section at a time, for one paper. A
// teacher with 40 children and five subjects will not save 200 times.
//
// Two rules worth knowing:
//   - ABSENT IS NOT ZERO. Blank means not entered; the absent tick is
//     a separate field. Treating them the same distorts averages and
//     pass/fail, and parents notice.
//   - Results stay hidden until the exam is published, so marks can be
//     entered over several days without parents seeing drafts.

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
import { fail, done, type ActionState } from "../result";

export async function saveMarks(
  paperId: string,
  sectionId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(CAN_EDIT_MARKS);
  const year = await currentAcademicYear();

  if (year.lockedAt) return fail("This academic year is locked.");

  await assertCanTouchSection(sectionId);

  const paper = await db.examPaper.findFirst({
    where: { id: paperId, exam: { academicYearId: year.id } },
    include: { exam: true },
  });

  if (!paper) return fail("That paper was not found.");

  // Once published, marks are corrections rather than entry. Allowed,
  // but audited as an amendment.
  const amending = paper.exam.publishedAt !== null;

  const enrollments = await db.enrollment.findMany({
    where: { sectionId, academicYearId: year.id, status: "ACTIVE" },
    select: { id: true },
  });

  const max = Number(paper.maxMarks);
  let saved = 0;

  for (const e of enrollments) {
    const absent = formData.get(`absent_${e.id}`) === "on";
    const raw = String(formData.get(`m_${e.id}`) ?? "").trim();

    // Blank and not absent means "not entered yet" — skip rather than
    // writing a zero.
    if (!absent && raw === "") continue;

    let obtained: number | null = null;

    if (!absent) {
      const n = Number(raw);

      if (!Number.isFinite(n)) return fail(`"${raw}" is not a number.`);
      if (n < 0) return fail("Marks cannot be negative.");
      if (n > max) return fail(`Marks cannot be more than ${max}.`);

      obtained = n;
    }

    await db.mark.upsert({
      where: { enrollmentId_paperId: { enrollmentId: e.id, paperId } },
      create: {
        enrollmentId: e.id,
        paperId,
        obtained,
        absent,
        enteredById: session.staffId,
      },
      update: { obtained, absent, enteredById: session.staffId },
    });

    saved++;
  }

  await audit({
    action: amending ? "marks.amend" : "marks.enter",
    entityType: "ExamPaper",
    entityId: paperId,
    after: { sectionId, saved },
  });

  revalidatePath(`/exams/${paper.examId}`);

  return done(
    `${saved} mark${saved === 1 ? "" : "s"} saved.${
      amending ? " This exam is already published — the change is live." : ""
    }`
  );
}

// Co-scholastic subjects are graded A–E, not marked. Same Mark row,
// different field.
export async function saveGrades(
  paperId: string,
  sectionId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(CAN_EDIT_MARKS);
  const year = await currentAcademicYear();

  if (year.lockedAt) return fail("This academic year is locked.");

  await assertCanTouchSection(sectionId);

  const paper = await db.examPaper.findFirst({
    where: { id: paperId, exam: { academicYearId: year.id } },
    include: { subject: true, exam: true },
  });

  if (!paper) return fail("That paper was not found.");

  if (paper.subject.isScholastic) {
    return fail(
      `${paper.subject.name} is a scholastic subject — enter marks for it, not grades.`
    );
  }

  const allowed = ["A", "B", "C", "D", "E"];

  const enrollments = await db.enrollment.findMany({
    where: { sectionId, academicYearId: year.id, status: "ACTIVE" },
    select: { id: true },
  });

  let saved = 0;

  for (const e of enrollments) {
    const grade = String(formData.get(`g_${e.id}`) ?? "").trim();

    if (!grade) continue; // not graded yet
    if (!allowed.includes(grade)) return fail(`"${grade}" is not a valid grade.`);

    await db.mark.upsert({
      where: { enrollmentId_paperId: { enrollmentId: e.id, paperId } },
      create: {
        enrollmentId: e.id,
        paperId,
        grade,
        enteredById: session.staffId,
      },
      update: { grade, enteredById: session.staffId },
    });

    saved++;
  }

  await audit({
    action: paper.exam.publishedAt ? "grades.amend" : "grades.enter",
    entityType: "ExamPaper",
    entityId: paperId,
    after: { sectionId, saved },
  });

  revalidatePath(`/exams/${paper.examId}/grades`);

  return done(`${saved} grade${saved === 1 ? "" : "s"} saved.`);
}

export async function publishExam(
  examId: string,
  _prev: ActionState,
  _formData: FormData
): Promise<ActionState> {
  await requireRole(["ADMIN", "PRINCIPAL"]);
  const year = await currentAcademicYear();

  const exam = await db.exam.findFirst({
    where: { id: examId, academicYearId: year.id },
    include: {
      papers: {
        include: {
          subject: { select: { name: true, isScholastic: true } },
          _count: { select: { marks: true } },
        },
      },
    },
  });

  if (!exam) return fail("That exam was not found.");
  if (exam.publishedAt) return fail("That exam is already published.");

  // Only scholastic papers block publishing. A school that has not
  // graded art should still be able to release the marks.
  const empty = exam.papers.filter(
    (p) => p.subject.isScholastic && p._count.marks === 0
  );

  if (empty.length > 0) {
    return fail(
      `${empty.length} paper${empty.length === 1 ? " has" : "s have"} no marks yet (${empty
        .slice(0, 3)
        .map((p) => p.subject.name)
        .join(", ")}${empty.length > 3 ? "…" : ""}). Enter them, or remove the paper.`
    );
  }

  await db.exam.update({
    where: { id: exam.id },
    data: { publishedAt: new Date() },
  });

  await audit({ action: "exam.publish", entityType: "Exam", entityId: exam.id });

  revalidatePath(`/exams/${exam.id}`);
  return done("Published. Report cards can now be printed.");
}

export async function createExam(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN", "PRINCIPAL"]);
  const year = await currentAcademicYear();

  if (year.lockedAt) return fail("This academic year is locked.");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return fail("Give the exam a name.");

  const maxMarks = Number(formData.get("maxMarks") ?? 80) || 80;
  const passMarks = Number(formData.get("passMarks") ?? 26) || 26;

  if (passMarks > maxMarks) {
    return fail("Pass marks cannot be more than maximum marks.");
  }

  const existing = await db.exam.findFirst({
    where: { academicYearId: year.id, name },
  });

  if (existing) return fail("An exam with that name already exists this year.");

  const count = await db.exam.count({ where: { academicYearId: year.id } });

  const [klasses, subjects] = await Promise.all([
    db.klass.findMany({
      where: { schoolId: session.schoolId, deletedAt: null },
    }),
    // Both kinds: scholastic get marks, co-scholastic get grades.
    db.subject.findMany({
      where: { schoolId: session.schoolId, deletedAt: null },
    }),
  ]);

  await db.exam.create({
    data: {
      academicYearId: year.id,
      name,
      type: String(formData.get("type") ?? "TERM") as never,
      seq: count + 1,
      weightPercent: Number(formData.get("weightPercent") ?? 0) || 0,
      papers: {
        create: klasses.flatMap((k) =>
          subjects.map((s) => ({
            klassId: k.id,
            subjectId: s.id,
            // Co-scholastic papers carry nominal marks; only the grade
            // is used.
            maxMarks: s.isScholastic ? maxMarks : 0,
            passMarks: s.isScholastic ? passMarks : 0,
          }))
        ),
      },
    },
  });

  revalidatePath("/exams");
  return done(
    `Exam created with ${klasses.length * subjects.length} papers. Remove any that do not apply.`
  );
}
