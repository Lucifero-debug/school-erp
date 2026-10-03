// app/students/page.tsx — student list and search
//
// Class and section come from Enrollment filtered to the current year,
// never from Student — see CONTEXT.md §4.1.

import Link from "next/link";
import { db } from "@/lib/db";
import {
  requireSession,
  currentAcademicYear,
  CAN_EDIT_STUDENTS,
  CAN_HANDLE_MONEY,
} from "@/lib/session";
import { studentName, ageYears } from "@/lib/format";
import { Panel, PageHeader, Empty, input, btnPrimary, btnQuiet, th, td, TableHead } from "@/app/ui";

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; section?: string }>;
}) {
  const session = await requireSession();
  const year = await currentAcademicYear();

  const { q, section } = await searchParams;
  const query = (q ?? "").trim();

  const canAdmit = CAN_EDIT_STUDENTS.includes(session.role as never);
  const canSeeMoney = CAN_HANDLE_MONEY.includes(session.role as never);
  const canPromote = session.role === "ADMIN" || session.role === "PRINCIPAL";

  const sections = await db.section.findMany({
    where: { klass: { schoolId: session.schoolId, deletedAt: null } },
    include: { klass: true },
    orderBy: [{ klass: { rank: "asc" } }, { name: "asc" }],
  });

  // Teachers see only their own sections — enforced here and in
  // assertCanTouchSection() on writes.
  const visibleSections =
    session.role === "TEACHER"
      ? sections.filter((s) => s.classTeacherId === session.staffId)
      : sections;

  const enrollments = await db.enrollment.findMany({
    where: {
      academicYearId: year.id,
      status: "ACTIVE",
      student: {
        schoolId: session.schoolId,
        deletedAt: null,
        ...(query
          ? {
              OR: [
                { firstName: { contains: query, mode: "insensitive" } },
                { lastName: { contains: query, mode: "insensitive" } },
                { admissionNo: { contains: query, mode: "insensitive" } },
                { guardians: { some: { phone: { contains: query } } } },
              ],
            }
          : {}),
      },
      ...(section ? { sectionId: section } : {}),
      ...(session.role === "TEACHER"
        ? { section: { classTeacherId: session.staffId } }
        : {}),
    },
    include: {
      section: { include: { klass: true } },
      student: {
        include: {
          guardians: { where: { isPrimary: true }, take: 1 },
          ...(canSeeMoney
            ? {
                demands: {
                  where: {
                    cancelledAt: null,
                    status: { in: ["OPEN" as const, "PART_PAID" as const] },
                  },
                },
              }
            : {}),
        },
      },
    },
    orderBy: [{ section: { klass: { rank: "asc" } } }, { rollNo: "asc" }],
    take: 300,
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Students"
        meta={`${enrollments.length} shown · academic year ${year.name}`}
        action={
          canAdmit ? (
            <div className="flex flex-wrap gap-2">
              {canPromote && (
                <Link href="/students/promote" className={btnQuiet}>
                  Promote
                </Link>
              )}
              <Link href="/students/import" className={btnQuiet}>
                Import
              </Link>
              <Link href="/students/new" className={btnPrimary}>
                Admit student
              </Link>
            </div>
          ) : null
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-3">
        <input
          name="q"
          defaultValue={query}
          autoFocus
          placeholder="Name, admission number or guardian phone"
          className={`max-w-sm ${input}`}
        />

        <select
          name="section"
          defaultValue={section ?? ""}
          className={`w-48 ${input}`}
          aria-label="Section"
        >
          <option value="">All sections</option>
          {visibleSections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.klass.name}-{s.name}
            </option>
          ))}
        </select>

        <button className="inline-flex items-center rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 text-sm font-medium hover:bg-[var(--color-surface)]">
          Filter
        </button>
      </form>

      {enrollments.length === 0 ? (
        <Empty
          href={canAdmit ? "/students/import" : undefined}
          cta={canAdmit ? "Import your existing list" : undefined}
        >
          {query
            ? `No student matches “${query}”.`
            : "No students enrolled this year."}
        </Empty>
      ) : (
        <Panel className="overflow-hidden">
          <table className="w-full text-sm">
            <TableHead>
              <th className={th}>Roll</th>
              <th className={th}>Student</th>
              <th className={th}>Class</th>
              <th className={th}>Guardian</th>
              <th className={th}>Age</th>
              {canSeeMoney && <th className={`${th} text-right`}>Due</th>}
            </TableHead>
            <tbody>
              {enrollments.map((e) => {
                const s = e.student;
                const g = s.guardians[0];

                const due =
                  canSeeMoney && "demands" in s
                    ? (s.demands as { net: unknown; lateFee: unknown; paid: unknown }[]).reduce(
                        (t, d) =>
                          t + Number(d.net) + Number(d.lateFee) - Number(d.paid),
                        0
                      )
                    : 0;

                return (
                  <tr
                    key={e.id}
                    className="border-b border-[var(--color-line)] last:border-0"
                  >
                    <td className={`${td} text-[var(--color-faint)]`}>
                      {e.rollNo ?? "—"}
                    </td>

                    <td className={td}>
                      <Link
                        href={`/students/${s.id}`}
                        className="font-medium hover:underline"
                      >
                        {studentName(s)}
                      </Link>
                      <span className="ml-2 text-xs text-[var(--color-faint)]">
                        {s.admissionNo}
                      </span>
                    </td>

                    <td className={`${td} text-[var(--color-muted)]`}>
                      {e.section.klass.name}-{e.section.name}
                    </td>

                    <td className={`${td} text-[var(--color-muted)]`}>
                      {g ? (
                        <>
                          {g.name}
                          <div className="text-xs">{g.phone}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td className={`${td} text-[var(--color-muted)]`}>
                      {ageYears(s.dob)}
                    </td>

                    {canSeeMoney && (
                      <td
                        className={`${td} text-right ${
                          due > 0
                            ? "font-medium text-[var(--color-due)]"
                            : "text-[var(--color-faint)]"
                        }`}
                      >
                        {due > 0 ? `₹${due.toLocaleString("en-IN")}` : "—"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
