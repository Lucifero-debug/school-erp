// app/exams/[examId]/grades/page.tsx — co-scholastic grades
//
// Work education, art, health and physical education. CBSE grades
// these A/B/C rather than marking them, and they print in their own
// block on the report card.
//
// Separate screen from marks because the interaction is different —
// a dropdown per child, not a number — and mixing them slows both.

import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole, currentAcademicYear, CAN_EDIT_MARKS } from "@/lib/session";
import { saveGrades } from "@/lib/actions/exams";
import { studentName } from "@/lib/format";
import { Form, Submit } from "@/app/form";
import { Panel, PageHeader, Empty, input, btnPrimary, btnQuiet } from "@/app/ui";

const GRADES = ["A", "B", "C", "D", "E"];

export default async function GradesPage({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<{ section?: string; subject?: string }>;
}) {
  const { examId } = await params;
  const { section, subject } = await searchParams;

  const session = await requireRole(CAN_EDIT_MARKS);
  const year = await currentAcademicYear();

  const exam = await db.exam.findFirst({
    where: { id: examId, academicYearId: year.id },
  });

  if (!exam) notFound();

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

  const chosenSection = sections.find((s) => s.id === section) ?? sections[0];

  // Only co-scholastic papers belong on this screen.
  const papers = await db.examPaper.findMany({
    where: {
      examId: exam.id,
      klassId: chosenSection.klassId,
      subject: { isScholastic: false },
    },
    include: { subject: true, _count: { select: { marks: true } } },
    orderBy: { subject: { name: "asc" } },
  });

  if (papers.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Co-scholastic grades" meta={exam.name} />

        <Empty href={`/exams/${exam.id}`} cta="Back to marks">
          No co-scholastic papers exist for class {chosenSection.klass.name}{" "}
          in this exam. Co-scholastic subjects are the ones with the
          Scholastic tick cleared in Settings, and papers for them have to
          be added to the exam.
        </Empty>
      </div>
    );
  }

  const chosenPaper = papers.find((p) => p.subjectId === subject) ?? papers[0];

  const [enrollments, marks] = await Promise.all([
    db.enrollment.findMany({
      where: {
        sectionId: chosenSection.id,
        academicYearId: year.id,
        status: "ACTIVE",
      },
      orderBy: { rollNo: "asc" },
      include: { student: { select: { firstName: true, lastName: true } } },
    }),
    db.mark.findMany({ where: { paperId: chosenPaper.id } }),
  ]);

  const byEnrollment = new Map(marks.map((m) => [m.enrollmentId, m]));

  const save = saveGrades.bind(null, chosenPaper.id, chosenSection.id);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Co-scholastic grades"
        meta={`${exam.name} · ${chosenSection.klass.name}-${chosenSection.name}`}
        action={
          <Link href={`/exams/${exam.id}`} className={btnQuiet}>
            Scholastic marks
          </Link>
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-3">
        <select
          name="section"
          defaultValue={chosenSection.id}
          className={`w-44 ${input}`}
          aria-label="Section"
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.klass.name}-{s.name}
            </option>
          ))}
        </select>

        <select
          name="subject"
          defaultValue={chosenPaper.subjectId}
          className={`w-60 ${input}`}
          aria-label="Subject"
        >
          {papers.map((p) => (
            <option key={p.id} value={p.subjectId}>
              {p.subject.name}
              {p._count.marks > 0 ? " ✓" : ""}
            </option>
          ))}
        </select>

        <button className={btnQuiet}>Show</button>
      </form>

      <Form action={save}>
        <Panel className="overflow-hidden">
          <div className="border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium">
            {chosenPaper.subject.name}
          </div>

          <table className="w-full text-sm">
            <tbody>
              {enrollments.map((e) => {
                const m = byEnrollment.get(e.id);

                return (
                  <tr
                    key={e.id}
                    className="border-b border-[var(--color-line)] last:border-0"
                  >
                    <td className="w-12 px-3 py-2 text-[var(--color-faint)]">
                      {e.rollNo ?? "—"}
                    </td>

                    <td className="px-3 py-2">{studentName(e.student)}</td>

                    <td className="w-40 px-3 py-2">
                      <select
                        name={`g_${e.id}`}
                        defaultValue={m?.grade ?? ""}
                        aria-label={`Grade for ${studentName(e.student)}`}
                        className="w-full rounded-md border border-[var(--color-line)] px-2 py-1 text-sm"
                      >
                        <option value="">Not graded</option>
                        {GRADES.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>

        <div className="mt-4 flex items-center gap-3">
          <Submit className={btnPrimary} pendingLabel="Saving…">
            Save grades
          </Submit>

          <span className="text-xs text-[var(--color-faint)]">
            Leave as &ldquo;Not graded&rdquo; to skip a student.
          </span>
        </div>
      </Form>
    </div>
  );
}
