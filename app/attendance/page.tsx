// app/attendance/page.tsx — mark a section for a day
//
// Everyone defaults to present. A teacher changes the two or three who
// are not, and submits once. That is the whole interaction, and making
// it any richer makes it slower.

import Link from "next/link";
import { db } from "@/lib/db";
import {
  requireRole,
  currentAcademicYear,
  CAN_EDIT_MARKS,
} from "@/lib/session";
import { markAttendance } from "@/lib/actions/attendance";
import { isoDate, startOfDay, date as fmtDate, studentName } from "@/lib/format";
import { Form, Submit } from "@/app/form";
import { Panel, PageHeader, Empty, input, btnPrimary, btnQuiet } from "@/app/ui";

const OPTIONS = [
  { value: "PRESENT", label: "P", title: "Present" },
  { value: "ABSENT", label: "A", title: "Absent" },
  { value: "LATE", label: "L", title: "Late" },
  { value: "LEAVE", label: "Lv", title: "Approved leave" },
  { value: "HALF_DAY", label: "H", title: "Half day" },
];

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; day?: string }>;
}) {
  const session = await requireRole(CAN_EDIT_MARKS);
  const year = await currentAcademicYear();

  const { section, day } = await searchParams;

  const today = startOfDay(new Date());
  const onDate = day ? startOfDay(new Date(`${day}T00:00:00`)) : today;

  const allSections = await db.section.findMany({
    where: { klass: { schoolId: session.schoolId, deletedAt: null } },
    include: { klass: true },
    orderBy: [{ klass: { rank: "asc" } }, { name: "asc" }],
  });

  // Teachers see only their own sections.
  const sections =
    session.role === "TEACHER"
      ? allSections.filter((s) => s.classTeacherId === session.staffId)
      : allSections;

  if (sections.length === 0) {
    return (
      <div className="mx-auto max-w-lg">
        <Empty>
          {session.role === "TEACHER"
            ? "You are not class teacher of any section yet. Ask an admin to assign one."
            : "No sections have been created yet."}
        </Empty>
      </div>
    );
  }

  const sectionId = section ?? sections[0].id;
  const chosen = sections.find((s) => s.id === sectionId) ?? sections[0];

  const [enrollments, existing, holiday] = await Promise.all([
    db.enrollment.findMany({
      where: {
        sectionId: chosen.id,
        academicYearId: year.id,
        status: "ACTIVE",
      },
      orderBy: { rollNo: "asc" },
      include: { student: { select: { firstName: true, lastName: true, admissionNo: true } } },
    }),
    db.attendance.findMany({
      where: { onDate, enrollment: { sectionId: chosen.id } },
    }),
    db.holiday.findFirst({ where: { academicYearId: year.id, onDate } }),
  ]);

  const byEnrollment = new Map(existing.map((a) => [a.enrollmentId, a.status]));
  const alreadyMarked = existing.length > 0;

  const action = markAttendance.bind(null, chosen.id);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Attendance"
        meta={`${chosen.klass.name}-${chosen.name} · ${fmtDate(onDate)}`}
        action={
          <Link href="/attendance/register" className={btnQuiet}>
            Monthly register
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

        <input
          type="date"
          name="day"
          defaultValue={isoDate(onDate)}
          max={isoDate(today)}
          className={`w-44 ${input}`}
          aria-label="Date"
        />

        <button className={btnQuiet}>Show</button>
      </form>

      {holiday ? (
        <Empty>
          {holiday.name} — the school is closed. Nothing to mark.
        </Empty>
      ) : enrollments.length === 0 ? (
        <Empty>No students in this section.</Empty>
      ) : (
        <Form action={action}>
          <input type="hidden" name="onDate" value={isoDate(onDate)} />

          {alreadyMarked && (
            <p className="mb-3 text-xs text-[var(--color-muted)]">
              Already marked for this day. Saving again updates it.
            </p>
          )}

          <Panel className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-muted)]">
                    Roll
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-muted)]">
                    Student
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-muted)]">
                    P / A / L / Lv / H
                  </th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((e) => {
                  const current = byEnrollment.get(e.id) ?? "PRESENT";

                  return (
                    <tr
                      key={e.id}
                      className="border-b border-[var(--color-line)] last:border-0"
                    >
                      <td className="px-3 py-2 text-[var(--color-faint)]">
                        {e.rollNo ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {studentName(e.student)}
                        <span className="ml-2 text-xs text-[var(--color-faint)]">
                          {e.student.admissionNo}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          {OPTIONS.map((o) => (
                            <label
                              key={o.value}
                              title={o.title}
                              className="cursor-pointer"
                            >
                              <input
                                type="radio"
                                name={`s_${e.id}`}
                                value={o.value}
                                defaultChecked={current === o.value}
                                className="peer sr-only"
                              />
                              <span className="inline-flex h-7 w-8 items-center justify-center rounded border border-[var(--color-line)] text-xs peer-checked:border-[var(--color-accent)] peer-checked:bg-[var(--color-accent)] peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--color-accent)]">
                                {o.label}
                              </span>
                            </label>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>

          <div className="mt-4">
            <Submit className={btnPrimary} pendingLabel="Saving…">
              Save attendance
            </Submit>
          </div>
        </Form>
      )}
    </div>
  );
}
