// app/exams/[examId]/report/[enrollmentId]/page.tsx
//
// The printed report card. Parents keep these for years and schools
// are judged on how they look, so this is one of the few screens where
// appearance genuinely matters.
//
// Grades follow the common CBSE-style band. Boards differ — if a
// school uses another scale, change GRADE_BANDS and nothing else.
// Co-scholastic subjects are listed separately and are graded, not
// marked.

import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole, CAN_EDIT_MARKS } from "@/lib/session";
import { date, studentName } from "@/lib/format";
import { PrintButton } from "@/app/print-button";
import { btnQuiet } from "@/app/ui";

const GRADE_BANDS: { min: number; grade: string }[] = [
  { min: 91, grade: "A1" },
  { min: 81, grade: "A2" },
  { min: 71, grade: "B1" },
  { min: 61, grade: "B2" },
  { min: 51, grade: "C1" },
  { min: 41, grade: "C2" },
  { min: 33, grade: "D" },
  { min: 0, grade: "E" },
];

function gradeFor(percent: number): string {
  return GRADE_BANDS.find((b) => percent >= b.min)?.grade ?? "E";
}

// A half day counts half, late counts present.
const WEIGHT: Record<string, number> = {
  PRESENT: 1,
  LATE: 1,
  HALF_DAY: 0.5,
  LEAVE: 0,
  ABSENT: 0,
};

export default async function ReportCardPage({
  params,
}: {
  params: Promise<{ examId: string; enrollmentId: string }>;
}) {
  const { examId, enrollmentId } = await params;
  const session = await requireRole(CAN_EDIT_MARKS);

  const enrollment = await db.enrollment.findFirst({
    where: {
      id: enrollmentId,
      student: { schoolId: session.schoolId, deletedAt: null },
    },
    include: {
      student: { include: { school: true, guardians: { where: { isPrimary: true }, take: 1 } } },
      section: { include: { klass: true, classTeacher: { select: { name: true } } } },
      academicYear: { select: { name: true } },
      attendance: { select: { status: true } },
      marks: {
        include: {
          paper: { include: { subject: true, exam: { select: { id: true, name: true, publishedAt: true } } } },
        },
      },
    },
  });

  if (!enrollment) notFound();

  const exam = await db.exam.findFirst({
    where: { id: examId, academicYearId: enrollment.academicYearId },
  });

  if (!exam) notFound();

  // An unpublished exam must not produce a report card. Draft marks
  // reaching a parent is a hard problem to walk back.
  if (!exam.publishedAt) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-lg font-semibold">Not published yet</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          {exam.name} has not been published, so report cards cannot be
          printed. Marks may still be incomplete.
        </p>
        <Link
          href={`/exams/${exam.id}`}
          className="mt-4 inline-block text-sm text-[var(--color-accent)] underline underline-offset-2"
        >
          Back to mark entry
        </Link>
      </div>
    );
  }

  const { student } = enrollment;
  const school = student.school;

  const marks = enrollment.marks.filter((m) => m.paper.exam.id === exam.id);

  const scholastic = marks.filter((m) => m.paper.subject.isScholastic);
  const coScholastic = marks.filter((m) => !m.paper.subject.isScholastic);

  const totalMax = scholastic.reduce((t, m) => t + Number(m.paper.maxMarks), 0);
  const totalGot = scholastic.reduce(
    (t, m) => t + (m.absent ? 0 : Number(m.obtained ?? 0)),
    0
  );

  const overallPercent = totalMax > 0 ? (totalGot / totalMax) * 100 : 0;

  const present = enrollment.attendance.reduce(
    (t, a) => t + (WEIGHT[a.status] ?? 0),
    0
  );
  const totalDays = enrollment.attendance.length;
  const attendancePercent = totalDays > 0 ? (present / totalDays) * 100 : null;

  const failed = scholastic.filter(
    (m) =>
      m.absent || Number(m.obtained ?? 0) < Number(m.paper.passMarks)
  );

  return (
    <div className="mx-auto max-w-[190mm] print:max-w-none">
      <div className="no-print mb-4 flex gap-3">
        <PrintButton label="Print report card" />
        <Link href={`/exams/${exam.id}`} className={btnQuiet}>
          Back to marks
        </Link>
        <Link
          href={`/students/${student.id}`}
          className="ml-auto text-sm text-[var(--color-accent)] underline underline-offset-2"
        >
          Student record
        </Link>
      </div>

      <article className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-8 text-sm shadow-[var(--shadow-panel)] print:border-0 print:p-0 print:shadow-none">
        <header className="border-b-2 border-[var(--color-ink)] pb-3 text-center">
          <h1 className="text-xl font-semibold tracking-tight">{school.name}</h1>
          <p className="text-xs text-[var(--color-muted)]">
            {school.address}, {school.city} {school.pincode ?? ""}
          </p>
          {school.affiliationNo && (
            <p className="text-xs text-[var(--color-muted)]">
              Affiliation No. {school.affiliationNo}
              {school.udiseCode ? ` · UDISE ${school.udiseCode}` : ""}
            </p>
          )}
          <p className="mt-3 text-sm font-medium tracking-wide">
            REPORT CARD · {exam.name.toUpperCase()}
          </p>
          <p className="text-xs text-[var(--color-muted)]">
            Session {enrollment.academicYear.name}
          </p>
        </header>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 border-b border-[var(--color-line)] py-3 text-xs sm:grid-cols-3">
          <Field label="Name" value={studentName(student)} />
          <Field label="Admission No." value={student.admissionNo} />
          <Field
            label="Class"
            value={`${enrollment.section.klass.name}-${enrollment.section.name}`}
          />
          <Field label="Roll No." value={String(enrollment.rollNo ?? "—")} />
          {student.guardians[0] && (
            <Field label="Guardian" value={student.guardians[0].name} />
          )}
          {student.dob && (
            <Field label="Date of birth" value={date(student.dob)} />
          )}
        </dl>

        {/* --- scholastic --- */}
        <section className="mt-4">
          <h2 className="mb-2 text-xs font-semibold tracking-wide">
            SCHOLASTIC AREAS
          </h2>

          <table className="w-full border border-[var(--color-line)] text-xs">
            <thead className="bg-[var(--color-surface)]">
              <tr>
                <th className="border-r border-[var(--color-line)] px-2 py-1.5 text-left font-medium">
                  Subject
                </th>
                <th className="border-r border-[var(--color-line)] px-2 py-1.5 text-right font-medium">
                  Max
                </th>
                <th className="border-r border-[var(--color-line)] px-2 py-1.5 text-right font-medium">
                  Obtained
                </th>
                <th className="px-2 py-1.5 text-center font-medium">Grade</th>
              </tr>
            </thead>
            <tbody>
              {scholastic.map((m) => {
                const max = Number(m.paper.maxMarks);
                const got = m.absent ? null : Number(m.obtained ?? 0);
                const pct = got !== null && max > 0 ? (got / max) * 100 : 0;
                const below =
                  !m.absent && got !== null && got < Number(m.paper.passMarks);

                return (
                  <tr
                    key={m.id}
                    className="border-t border-[var(--color-line)]"
                  >
                    <td className="border-r border-[var(--color-line)] px-2 py-1.5">
                      {m.paper.subject.name}
                    </td>
                    <td className="border-r border-[var(--color-line)] px-2 py-1.5 text-right">
                      {max}
                    </td>
                    <td
                      className={`border-r border-[var(--color-line)] px-2 py-1.5 text-right ${
                        below ? "font-semibold text-[var(--color-due)]" : ""
                      }`}
                    >
                      {m.absent ? "AB" : got}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {m.absent ? "—" : gradeFor(pct)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-[var(--color-surface)] font-semibold">
              <tr className="border-t border-[var(--color-ink)]">
                <td className="border-r border-[var(--color-line)] px-2 py-1.5">
                  Total
                </td>
                <td className="border-r border-[var(--color-line)] px-2 py-1.5 text-right">
                  {totalMax}
                </td>
                <td className="border-r border-[var(--color-line)] px-2 py-1.5 text-right">
                  {totalGot}
                </td>
                <td className="px-2 py-1.5 text-center">
                  {gradeFor(overallPercent)}
                </td>
              </tr>
            </tfoot>
          </table>

          <p className="mt-2 text-xs">
            <span className="text-[var(--color-muted)]">Percentage:</span>{" "}
            <span className="font-semibold">{overallPercent.toFixed(1)}%</span>
            {failed.length > 0 && (
              <span className="ml-3 text-[var(--color-due)]">
                Below pass in {failed.length} subject
                {failed.length === 1 ? "" : "s"}
              </span>
            )}
          </p>
        </section>

        {/* --- co-scholastic --- */}
        {coScholastic.length > 0 && (
          <section className="mt-4">
            <h2 className="mb-2 text-xs font-semibold tracking-wide">
              CO-SCHOLASTIC AREAS
            </h2>

            <table className="w-full border border-[var(--color-line)] text-xs">
              <tbody>
                {coScholastic.map((m) => (
                  <tr
                    key={m.id}
                    className="border-t border-[var(--color-line)] first:border-0"
                  >
                    <td className="border-r border-[var(--color-line)] px-2 py-1.5">
                      {m.paper.subject.name}
                    </td>
                    <td className="w-20 px-2 py-1.5 text-center">
                      {m.grade ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* --- attendance --- */}
        <section className="mt-4 text-xs">
          <span className="text-[var(--color-muted)]">Attendance:</span>{" "}
          {attendancePercent !== null ? (
            <span
              className={
                attendancePercent < 75
                  ? "font-semibold text-[var(--color-due)]"
                  : "font-semibold"
              }
            >
              {present} of {totalDays} days ({attendancePercent.toFixed(0)}%)
            </span>
          ) : (
            "not recorded"
          )}
        </section>

        <footer className="mt-12 flex justify-between text-xs">
          <div className="min-w-40 border-t border-[var(--color-ink)] pt-1 text-center">
            Class Teacher
            {enrollment.section.classTeacher && (
              <div className="text-[var(--color-muted)]">
                {enrollment.section.classTeacher.name}
              </div>
            )}
          </div>

          <div className="min-w-40 border-t border-[var(--color-ink)] pt-1 text-center">
            Parent / Guardian
          </div>

          <div className="min-w-40 border-t border-[var(--color-ink)] pt-1 text-center">
            Principal
          </div>
        </footer>
      </article>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
