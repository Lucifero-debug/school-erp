// app/exams/[examId]/page.tsx — mark entry
//
// Pick a section and a subject, type the marks down the column, save
// once. Blank means not entered yet; the absent tick is separate and
// is NOT the same as zero.

import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole, currentAcademicYear, CAN_EDIT_MARKS } from "@/lib/session";
import { saveMarks, publishExam } from "@/lib/actions/exams";
import { studentName } from "@/lib/format";
import { Form, Submit, ConfirmSubmit } from "@/app/form";
import { Panel, PageHeader, Empty, input, btnPrimary, btnQuiet } from "@/app/ui";

export default async function ExamPage({
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

  const papers = await db.examPaper.findMany({
    where: { examId: exam.id, klassId: chosenSection.klassId },
    include: { subject: true, _count: { select: { marks: true } } },
    orderBy: { subject: { name: "asc" } },
  });

  if (papers.length === 0) {
    return (
      <div className="mx-auto max-w-lg">
        <Empty href="/exams" cta="Back to exams">
          No papers for class {chosenSection.klass.name} in this exam.
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
      include: { student: { select: { id: true, firstName: true, lastName: true } } },
    }),
    db.mark.findMany({ where: { paperId: chosenPaper.id } }),
  ]);

  const byEnrollment = new Map(marks.map((m) => [m.enrollmentId, m]));

  const save = saveMarks.bind(null, chosenPaper.id, chosenSection.id);
  const publish = publishExam.bind(null, exam.id);

  const canPublish = session.role === "ADMIN" || session.role === "PRINCIPAL";

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={exam.name}
        meta={
          exam.publishedAt
            ? "Published — changes are visible to parents immediately"
            : "Not published. Marks are hidden from report cards until you publish."
        }
        action={
          <div className="flex gap-2">
            <Link href="/exams" className={btnQuiet}>
              All exams
            </Link>
            {canPublish && !exam.publishedAt && (
              <Form action={publish}>
                <ConfirmSubmit
                  message="Publish this exam? Report cards become printable."
                  className={btnPrimary}
                >
                  Publish results
                </ConfirmSubmit>
              </Form>
            )}
          </div>
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
          className={`w-52 ${input}`}
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
          <div className="border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-sm">
            <span className="font-medium">{chosenPaper.subject.name}</span>
            <span className="ml-2 text-xs text-[var(--color-muted)]">
              max {Number(chosenPaper.maxMarks)} · pass{" "}
              {Number(chosenPaper.passMarks)}
            </span>
          </div>

          <table className="w-full text-sm">
            <tbody>
              {enrollments.map((e) => {
                const m = byEnrollment.get(e.id);
                const failing =
                  m?.obtained !== null &&
                  m?.obtained !== undefined &&
                  Number(m.obtained) < Number(chosenPaper.passMarks);

                return (
                  <tr
                    key={e.id}
                    className="border-b border-[var(--color-line)] last:border-0"
                  >
                    <td className="w-12 px-3 py-2 text-[var(--color-faint)]">
                      {e.rollNo ?? "—"}
                    </td>

                    <td className="px-3 py-2">{studentName(e.student)}</td>

                    <td className="w-28 px-3 py-2">
                      <input
                        name={`m_${e.id}`}
                        inputMode="decimal"
                        defaultValue={
                          m?.obtained !== null && m?.obtained !== undefined
                            ? String(Number(m.obtained))
                            : ""
                        }
                        aria-label={`Marks for ${studentName(e.student)}`}
                        className={`w-20 rounded-md border px-2 py-1 text-right text-sm ${
                          failing
                            ? "border-[var(--color-due)] text-[var(--color-due)]"
                            : "border-[var(--color-line)]"
                        }`}
                      />
                    </td>

                    <td className="w-24 px-3 py-2">
                      <label className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
                        <input
                          type="checkbox"
                          name={`absent_${e.id}`}
                          defaultChecked={m?.absent ?? false}
                        />
                        Absent
                      </label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>

        <div className="mt-4 flex items-center gap-3">
          <Submit className={btnPrimary} pendingLabel="Saving…">
            Save marks
          </Submit>

          <span className="text-xs text-[var(--color-faint)]">
            Leave blank for not yet entered. Absent is not zero.
          </span>
        </div>
      </Form>
    </div>
  );
}
