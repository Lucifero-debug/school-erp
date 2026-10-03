// app/attendance/register/page.tsx
//
// The monthly register, printable, plus the shortage list.
//
// Shortage matters: boards commonly require a minimum attendance (75%
// is the usual figure) to sit the exam, and a school needs to warn
// parents long before that becomes a problem. Holidays are excluded
// from the denominator — counting them would understate everyone.

import Link from "next/link";
import { db } from "@/lib/db";
import {
  requireRole,
  currentAcademicYear,
  CAN_EDIT_MARKS,
} from "@/lib/session";
import { addHoliday } from "@/lib/actions/attendance";
import { isoDate, studentName, date as fmtDate } from "@/lib/format";
import { PrintButton } from "@/app/print-button";
import { Form, Submit } from "@/app/form";
import { Panel, PageHeader, Empty, input, label, btnQuiet, Stat } from "@/app/ui";

const MARK: Record<string, string> = {
  PRESENT: "P",
  ABSENT: "A",
  LATE: "L",
  LEAVE: "Lv",
  HALF_DAY: "H",
  HOLIDAY: "—",
};

// A half day counts as half a day present. Late counts as present —
// punctuality is a separate conversation from eligibility.
const WEIGHT: Record<string, number> = {
  PRESENT: 1,
  LATE: 1,
  HALF_DAY: 0.5,
  LEAVE: 0,
  ABSENT: 0,
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; month?: string }>;
}) {
  const session = await requireRole(CAN_EDIT_MARKS);
  const year = await currentAcademicYear();

  const { section, month } = await searchParams;

  const now = new Date();
  const monthStr = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [y, m] = monthStr.split("-").map(Number);
  const from = new Date(y, m - 1, 1);
  const to = new Date(y, m, 0, 23, 59, 59, 999);
  const daysInMonth = to.getDate();

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

  const [enrollments, records, holidays, yearRecords] = await Promise.all([
    db.enrollment.findMany({
      where: { sectionId: chosen.id, academicYearId: year.id, status: "ACTIVE" },
      orderBy: { rollNo: "asc" },
      include: { student: { select: { id: true, firstName: true, lastName: true } } },
    }),
    db.attendance.findMany({
      where: {
        onDate: { gte: from, lte: to },
        enrollment: { sectionId: chosen.id },
      },
    }),
    db.holiday.findMany({
      where: { academicYearId: year.id },
      orderBy: { onDate: "asc" },
    }),
    // Whole-year totals, for the shortage list.
    db.attendance.findMany({
      where: { enrollment: { sectionId: chosen.id, academicYearId: year.id } },
      select: { enrollmentId: true, status: true },
    }),
  ]);

  const holidayDates = new Set(holidays.map((h) => isoDate(h.onDate)));

  // month grid: enrollmentId -> day -> status
  const grid = new Map<string, Map<number, string>>();

  for (const r of records) {
    const day = r.onDate.getDate();
    const row = grid.get(r.enrollmentId) ?? new Map<number, string>();
    row.set(day, r.status);
    grid.set(r.enrollmentId, row);
  }

  // year totals for shortage
  const totals = new Map<string, { present: number; marked: number }>();

  for (const r of yearRecords) {
    const t = totals.get(r.enrollmentId) ?? { present: 0, marked: 0 };
    t.present += WEIGHT[r.status] ?? 0;
    t.marked += 1;
    totals.set(r.enrollmentId, t);
  }

  const shortage = enrollments
    .map((e) => {
      const t = totals.get(e.id) ?? { present: 0, marked: 0 };
      const pct = t.marked > 0 ? (t.present / t.marked) * 100 : 100;
      return { e, pct, marked: t.marked };
    })
    .filter((r) => r.marked >= 10 && r.pct < 75)
    .sort((a, b) => a.pct - b.pct);

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Attendance register"
        meta={`${chosen.klass.name}-${chosen.name} · ${from.toLocaleString("en-IN", { month: "long", year: "numeric" })}`}
        action={
          <div className="no-print flex gap-2">
            <Link href="/attendance" className={btnQuiet}>
              Mark today
            </Link>
            <PrintButton label="Print register" />
          </div>
        }
      />

      <form className="no-print mb-4 flex flex-wrap items-end gap-3">
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
          type="month"
          name="month"
          defaultValue={monthStr}
          className={`w-44 ${input}`}
          aria-label="Month"
        />

        <button className={btnQuiet}>Show</button>
      </form>

      {shortage.length > 0 && (
        <Panel className="mb-5 p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-[var(--color-due)]">
              Below 75% for the year
            </h2>
            <Stat label="" value={String(shortage.length)} tone="due" />
          </div>

          <ul className="space-y-1 text-sm">
            {shortage.map((r) => (
              <li key={r.e.id} className="flex justify-between">
                <Link
                  href={`/students/${r.e.student.id}`}
                  className="hover:underline"
                >
                  {r.e.rollNo ? `${r.e.rollNo}. ` : ""}
                  {studentName(r.e.student)}
                </Link>
                <span className="text-[var(--color-due)]">
                  {r.pct.toFixed(0)}% of {r.marked} days
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-2 text-xs text-[var(--color-faint)]">
            Boards usually require 75% to sit the exam. Holidays are
            excluded; approved leave counts as absent for this figure.
          </p>
        </Panel>
      )}

      <Panel className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
            <tr>
              <th className="sticky left-0 bg-[var(--color-surface)] px-2 py-2 text-left font-medium text-[var(--color-muted)]">
                Student
              </th>
              {days.map((d) => {
                const iso = isoDate(new Date(y, m - 1, d));
                const isHoliday = holidayDates.has(iso);
                const dow = new Date(y, m - 1, d).getDay();

                return (
                  <th
                    key={d}
                    className={`w-7 py-2 text-center font-medium ${
                      isHoliday || dow === 0
                        ? "text-[var(--color-faint)]"
                        : "text-[var(--color-muted)]"
                    }`}
                  >
                    {d}
                  </th>
                );
              })}
              <th className="px-2 py-2 text-right font-medium text-[var(--color-muted)]">
                %
              </th>
            </tr>
          </thead>
          <tbody>
            {enrollments.map((e) => {
              const row = grid.get(e.id) ?? new Map();

              let present = 0;
              let marked = 0;

              for (const [, status] of row) {
                present += WEIGHT[status] ?? 0;
                marked += 1;
              }

              const pct = marked > 0 ? (present / marked) * 100 : 0;

              return (
                <tr
                  key={e.id}
                  className="border-b border-[var(--color-line)] last:border-0"
                >
                  <td className="sticky left-0 whitespace-nowrap bg-[var(--color-panel)] px-2 py-1.5">
                    {e.rollNo ? `${e.rollNo}. ` : ""}
                    {studentName(e.student)}
                  </td>

                  {days.map((d) => {
                    const status = row.get(d);
                    const iso = isoDate(new Date(y, m - 1, d));
                    const isHoliday = holidayDates.has(iso);

                    return (
                      <td
                        key={d}
                        className={`text-center ${
                          status === "ABSENT"
                            ? "font-semibold text-[var(--color-due)]"
                            : isHoliday
                              ? "text-[var(--color-faint)]"
                              : "text-[var(--color-muted)]"
                        }`}
                      >
                        {isHoliday ? "—" : (MARK[status] ?? "")}
                      </td>
                    );
                  })}

                  <td
                    className={`px-2 py-1.5 text-right ${
                      marked > 0 && pct < 75 ? "text-[var(--color-due)]" : ""
                    }`}
                  >
                    {marked > 0 ? `${pct.toFixed(0)}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {/* Holidays, so the register's blanks are explainable. */}
      <section className="no-print mt-6">
        <h2 className="mb-2 text-sm font-semibold">Holidays</h2>

        <Panel className="p-4">
          {holidays.length > 0 && (
            <ul className="mb-4 space-y-1 text-sm">
              {holidays.map((h) => (
                <li key={h.id} className="flex justify-between">
                  <span>{h.name}</span>
                  <span className="text-[var(--color-muted)]">
                    {fmtDate(h.onDate)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Form action={addHoliday}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-44">
                <label htmlFor="holidayDate" className={label}>
                  Date
                </label>
                <input
                  id="holidayDate"
                  name="onDate"
                  type="date"
                  required
                  className={`mt-1 ${input}`}
                />
              </div>

              <div className="min-w-48 flex-1">
                <label htmlFor="holidayName" className={label}>
                  Name
                </label>
                <input
                  id="holidayName"
                  name="name"
                  required
                  placeholder="Diwali"
                  className={`mt-1 ${input}`}
                />
              </div>

              <Submit className={btnQuiet}>Add holiday</Submit>
            </div>
          </Form>
        </Panel>
      </section>
    </div>
  );
}
