// app/exams/[examId]/cards/page.tsx
//
// Pick a section, get the list of report cards to print. Nobody hunts
// for one child at a time at result season — they print a class.

import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole, currentAcademicYear, CAN_EDIT_MARKS } from "@/lib/session";
import { studentName } from "@/lib/format";
import { Panel, PageHeader, Empty, input, btnQuiet, th, td, TableHead } from "@/app/ui";

export default async function CardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { examId } = await params;
  const { section } = await searchParams;

  const session = await requireRole(CAN_EDIT_MARKS);
  const year = await currentAcademicYear();

  const exam = await db.exam.findFirst({
    where: { id: examId, academicYearId: year.id },
  });

  if (!exam) notFound();

  if (!exam.publishedAt) {
    return (
      <div className="mx-auto max-w-lg">
        <Empty href={`/exams/${exam.id}`} cta="Back to mark entry">
          {exam.name} has not been published, so report cards cannot be
          printed yet.
        </Empty>
      </div>
    );
  }

  const allSections = await db.section.findMany({
    where: { klass: { schoolId: session.schoolId, deletedAt: null } },
    include: { klass: true },
    orderBy: [{ klass: { rank: "asc" } }, { name: "asc" }],
  });

  const sections =
    session.role === "TEACHER"
      ? allSections.filter((s) => s.classTeacherId === session.staffId)
      : allSections;

  if (sections.length === 0) {
    return (
      <div className="mx-auto max-w-lg">
        <Empty>No sections available to you.</Empty>
      </div>
    );
  }

  const chosen = sections.find((s) => s.id === section) ?? sections[0];

  const enrollments = await db.enrollment.findMany({
    where: {
      sectionId: chosen.id,
      academicYearId: year.id,
      status: "ACTIVE",
    },
    orderBy: { rollNo: "asc" },
    include: {
      student: { select: { firstName: true, lastName: true, admissionNo: true } },
      marks: {
        where: { paper: { examId: exam.id } },
        include: {
          paper: {
            include: { subject: { select: { isScholastic: true } } },
          },
        },
      },
    },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Report cards"
        meta={`${exam.name} · ${chosen.klass.name}-${chosen.name}`}
        action={
          <Link href={`/exams/${exam.id}`} className={btnQuiet}>
            Back to marks
          </Link>
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-3">
        <select
          name="section"
          defaultValue={chosen.id}
          className={`w-48 ${input}`}
          aria-label="Section"
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.klass.name}-{s.name}
            </option>
          ))}
        </select>

        <button className={btnQuiet}>Show</button>
      </form>

      {enrollments.length === 0 ? (
        <Empty>No students in this section.</Empty>
      ) : (
        <Panel className="overflow-hidden">
          <table className="w-full text-sm">
            <TableHead>
              <th className={th}>Roll</th>
              <th className={th}>Student</th>
              <th className={`${th} text-right`}>Marks entered</th>
              <th className={`${th} text-right`}>Percentage</th>
              <th className={th}></th>
            </TableHead>
            <tbody>
              {enrollments.map((e) => {
                const scholastic = e.marks.filter(
                  (m) => m.paper.subject.isScholastic
                );

                const max = scholastic.reduce(
                  (t, m) => t + Number(m.paper.maxMarks),
                  0
                );
                const got = scholastic.reduce(
                  (t, m) => t + (m.absent ? 0 : Number(m.obtained ?? 0)),
                  0
                );

                const pct = max > 0 ? (got / max) * 100 : null;

                return (
                  <tr
                    key={e.id}
                    className="border-b border-[var(--color-line)] last:border-0"
                  >
                    <td className={`${td} text-[var(--color-faint)]`}>
                      {e.rollNo ?? "—"}
                    </td>
                    <td className={td}>
                      {studentName(e.student)}
                      <span className="ml-2 text-xs text-[var(--color-faint)]">
                        {e.student.admissionNo}
                      </span>
                    </td>
                    <td className={`${td} text-right text-[var(--color-muted)]`}>
                      {scholastic.length}
                    </td>
                    <td className={`${td} text-right`}>
                      {pct !== null ? `${pct.toFixed(1)}%` : "—"}
                    </td>
                    <td className={`${td} text-right`}>
                      <Link
                        href={`/exams/${exam.id}/report/${e.id}`}
                        className="text-sm text-[var(--color-accent)] underline underline-offset-2"
                      >
                        Open card
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}

      <p className="mt-3 text-xs text-[var(--color-faint)]">
        Open a card and print it. Printing a whole class in one go is not
        built yet — the browser&rsquo;s print dialogue handles one page at
        a time.
      </p>
    </div>
  );
}
