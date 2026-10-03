// app/exams/page.tsx

import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole, currentAcademicYear, CAN_EDIT_MARKS } from "@/lib/session";
import { createExam } from "@/lib/actions/exams";
import { date } from "@/lib/format";
import { Form, Submit } from "@/app/form";
import { Panel, PageHeader, Empty, input, label, btnQuiet } from "@/app/ui";

export default async function ExamsPage() {
  const session = await requireRole(CAN_EDIT_MARKS);
  const year = await currentAcademicYear();

  const exams = await db.exam.findMany({
    where: { academicYearId: year.id },
    orderBy: { seq: "asc" },
    include: {
      papers: {
        include: {
          subject: { select: { isScholastic: true } },
          _count: { select: { marks: true } },
        },
      },
    },
  });

  const canCreate = session.role === "ADMIN" || session.role === "PRINCIPAL";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader title="Exams" meta={`Academic year ${year.name}`} />

      {exams.length === 0 ? (
        <Empty>No exams set up for this year yet.</Empty>
      ) : (
        <div className="space-y-3">
          {exams.map((e) => {
            const scholastic = e.papers.filter((p) => p.subject.isScholastic);
            const co = e.papers.filter((p) => !p.subject.isScholastic);

            const marked = scholastic.filter((p) => p._count.marks > 0).length;
            const graded = co.filter((p) => p._count.marks > 0).length;

            return (
              <Panel key={e.id} className="p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span className="text-sm font-semibold">{e.name}</span>
                    <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                      {e.type.toLowerCase().replace("_", " ")} ·{" "}
                      {marked}/{scholastic.length} papers marked
                      {co.length > 0 && ` · ${graded}/${co.length} graded`}
                      {Number(e.weightPercent) > 0 &&
                        ` · ${Number(e.weightPercent)}% weight`}
                    </p>
                  </div>

                  <span
                    className={`text-xs ${
                      e.publishedAt
                        ? "text-[var(--color-good)]"
                        : "text-[var(--color-warn)]"
                    }`}
                  >
                    {e.publishedAt
                      ? `published ${date(e.publishedAt)}`
                      : "not published"}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/exams/${e.id}`} className={btnQuiet}>
                    Enter marks
                  </Link>

                  {co.length > 0 && (
                    <Link href={`/exams/${e.id}/grades`} className={btnQuiet}>
                      Co-scholastic grades
                    </Link>
                  )}

                  {e.publishedAt && (
                    <Link href={`/exams/${e.id}/cards`} className={btnQuiet}>
                      Report cards
                    </Link>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {canCreate && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">New exam</h2>

          <Panel className="p-5">
            <Form action={createExam}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="name" className={label}>Name</label>
                  <input id="name" name="name" required placeholder="Term 2" className={`mt-1 ${input}`} />
                </div>

                <div>
                  <label htmlFor="type" className={label}>Type</label>
                  <select id="type" name="type" defaultValue="TERM" className={`mt-1 ${input}`}>
                    <option value="UNIT_TEST">Unit test</option>
                    <option value="TERM">Term</option>
                    <option value="PRE_BOARD">Pre-board</option>
                    <option value="ANNUAL">Annual</option>
                    <option value="PRACTICAL">Practical</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="maxMarks" className={label}>Max marks per paper</label>
                  <input id="maxMarks" name="maxMarks" type="number" min={1} defaultValue={80} className={`mt-1 ${input}`} />
                </div>

                <div>
                  <label htmlFor="passMarks" className={label}>Pass marks</label>
                  <input id="passMarks" name="passMarks" type="number" min={0} defaultValue={26} className={`mt-1 ${input}`} />
                </div>

                <div>
                  <label htmlFor="weightPercent" className={label}>Weight toward final (%)</label>
                  <input id="weightPercent" name="weightPercent" type="number" min={0} max={100} defaultValue={0} className={`mt-1 ${input}`} />
                </div>

                <div className="flex items-end">
                  <Submit className={btnQuiet} pendingLabel="Creating…">Create exam</Submit>
                </div>
              </div>

              <p className="mt-2 text-xs text-[var(--color-faint)]">
                A paper is created for every class and every subject.
                Co-scholastic subjects get graded rather than marked.
              </p>
            </Form>
          </Panel>
        </section>
      )}
    </div>
  );
}
