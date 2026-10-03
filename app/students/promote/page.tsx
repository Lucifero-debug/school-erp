// app/students/promote/page.tsx
//
// Year-end promotion, one class at a time.
//
// The school sees the list before anything happens, with outstanding
// fees and attendance beside each name — because those are the two
// things that make a school hesitate over a particular child.
//
// Detention is a tick on the row, not a separate screen.

import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole, currentAcademicYear } from "@/lib/session";
import {
  promotionPreview,
  promoteClass,
  markPassedOut,
} from "@/lib/actions/leaving";
import { rupees } from "@/lib/format";
import { Form, Submit, ConfirmSubmit } from "@/app/form";
import { Panel, PageHeader, Empty, input, label, btnQuiet, th, td, TableHead } from "@/app/ui";

export default async function PromotePage({
  searchParams,
}: {
  searchParams: Promise<{ klass?: string; to?: string }>;
}) {
  const session = await requireRole(["ADMIN", "PRINCIPAL"]);
  const year = await currentAcademicYear();

  const { klass, to } = await searchParams;

  const [klasses, years] = await Promise.all([
    db.klass.findMany({
      where: { schoolId: session.schoolId, deletedAt: null },
      orderBy: { rank: "asc" },
    }),
    db.academicYear.findMany({
      where: { schoolId: session.schoolId, id: { not: year.id }, lockedAt: null },
      orderBy: { startsOn: "desc" },
    }),
  ]);

  if (years.length === 0) {
    return (
      <div className="mx-auto max-w-lg">
        <Empty href="/settings" cta="Create next year">
          There is no other academic year to promote into. Create next
          year in Settings first.
        </Empty>
      </div>
    );
  }

  const chosenKlass = klasses.find((k) => k.id === klass) ?? klasses[0];
  const chosenYear = years.find((y) => y.id === to) ?? years[0];

  const preview = chosenKlass
    ? await promotionPreview(chosenKlass.id, chosenYear.id)
    : { candidates: [], targetKlass: null, alreadyEnrolled: 0 };

  const promote = chosenKlass ? promoteClass.bind(null, chosenKlass.id) : null;
  const passOut = chosenKlass ? markPassedOut.bind(null, chosenKlass.id) : null;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Promote students"
        meta={`From ${year.name} into ${chosenYear.name}`}
        action={
          <Link href="/students" className={btnQuiet}>
            Back to students
          </Link>
        }
      />

      <div className="mb-5 rounded-md bg-[var(--color-surface)] p-3 text-xs text-[var(--color-muted)]">
        Promotion creates next year&rsquo;s enrolment. It does not move
        fees, marks or attendance — those stay attached to the year they
        happened in. Safe to run twice: anyone who already has a place
        next year is skipped.
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-44">
          <label htmlFor="klass" className={label}>
            Class
          </label>
          <select
            id="klass"
            name="klass"
            defaultValue={chosenKlass?.id}
            className={`mt-1 ${input}`}
          >
            {klasses.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </div>

        <div className="w-44">
          <label htmlFor="to" className={label}>
            Into year
          </label>
          <select
            id="to"
            name="to"
            defaultValue={chosenYear.id}
            className={`mt-1 ${input}`}
          >
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
        </div>

        <button className={btnQuiet}>Show</button>
      </form>

      {preview.alreadyEnrolled > 0 && (
        <p className="mb-3 text-sm text-[var(--color-muted)]">
          {preview.alreadyEnrolled} student
          {preview.alreadyEnrolled === 1 ? " already has" : "s already have"} a
          place in {chosenYear.name} and will not be touched.
        </p>
      )}

      {preview.candidates.length === 0 ? (
        <Empty>
          Nothing to promote from {chosenKlass?.name}.
        </Empty>
      ) : !preview.targetKlass ? (
        // Highest class — these students finish rather than promote.
        <Panel className="p-5">
          <p className="mb-3 text-sm">
            {chosenKlass?.name} is the highest class, so there is nothing
            above it. {preview.candidates.length} student
            {preview.candidates.length === 1 ? "" : "s"} would be marked as
            passed out.
          </p>

          {passOut && (
            <Form action={passOut}>
              <ConfirmSubmit
                message={`Mark ${preview.candidates.length} students as passed out?`}
                className={btnQuiet}
              >
                Mark passed out
              </ConfirmSubmit>
            </Form>
          )}
        </Panel>
      ) : (
        promote && (
          <Form action={promote}>
            <input type="hidden" name="toYearId" value={chosenYear.id} />

            <Panel className="overflow-hidden">
              <div className="border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-sm">
                {preview.candidates.length} students ·{" "}
                <span className="font-medium">
                  {chosenKlass?.name} → {preview.targetKlass}
                </span>
              </div>

              <table className="w-full text-sm">
                <TableHead>
                  <th className={th}>Roll</th>
                  <th className={th}>Student</th>
                  <th className={`${th} text-right`}>Dues</th>
                  <th className={`${th} text-right`}>Attendance</th>
                  <th className={`${th} text-right`}>Detain</th>
                </TableHead>
                <tbody>
                  {preview.candidates.map((c) => (
                    <tr
                      key={c.enrollmentId}
                      className="border-b border-[var(--color-line)] last:border-0"
                    >
                      <td className={`${td} text-[var(--color-faint)]`}>
                        {c.rollNo ?? "—"}
                      </td>

                      <td className={td}>
                        <Link
                          href={`/students/${c.studentId}`}
                          className="font-medium hover:underline"
                        >
                          {c.name}
                        </Link>
                        <span className="ml-2 text-xs text-[var(--color-faint)]">
                          {c.admissionNo}
                        </span>
                      </td>

                      <td
                        className={`${td} text-right ${
                          c.outstanding > 0
                            ? "text-[var(--color-due)]"
                            : "text-[var(--color-faint)]"
                        }`}
                      >
                        {c.outstanding > 0 ? rupees(c.outstanding) : "—"}
                      </td>

                      <td
                        className={`${td} text-right ${
                          c.attendancePercent !== null &&
                          c.attendancePercent < 75
                            ? "text-[var(--color-due)]"
                            : "text-[var(--color-muted)]"
                        }`}
                      >
                        {c.attendancePercent !== null
                          ? `${c.attendancePercent.toFixed(0)}%`
                          : "—"}
                      </td>

                      <td className={`${td} text-right`}>
                        <input
                          type="checkbox"
                          name={`detain_${c.enrollmentId}`}
                          aria-label={`Detain ${c.name}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <ConfirmSubmit
                message={`Promote ${preview.candidates.length} students into ${chosenYear.name}? Ticked students stay in ${chosenKlass?.name}.`}
                className="inline-flex items-center rounded-md bg-[var(--color-accent)] px-3.5 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-ink)]"
              >
                Promote this class
              </ConfirmSubmit>

              <span className="text-xs text-[var(--color-faint)]">
                Ticked students are enrolled in {chosenKlass?.name} again.
                Outstanding dues do not block promotion — they follow the
                student.
              </span>
            </div>
          </Form>
        )
      )}
    </div>
  );
}
