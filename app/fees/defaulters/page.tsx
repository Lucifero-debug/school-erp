// app/fees/defaulters/page.tsx
//
// The list the principal actually wants, and the main reason a school
// buys this software. Sorted by amount owed, printable, filterable by
// class, with the guardian's phone right there so somebody can call.

import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole, currentAcademicYear, CAN_HANDLE_MONEY } from "@/lib/session";
import { applyLateFees } from "@/lib/actions/fees";
import { rupees, date, studentName } from "@/lib/format";
import { PrintButton } from "@/app/print-button";
import { Form, Submit } from "@/app/form";
import { Panel, PageHeader, Empty, Stat, btnQuiet, th, td, TableHead, input } from "@/app/ui";

export default async function DefaultersPage({
  searchParams,
}: {
  searchParams: Promise<{ klass?: string; days?: string }>;
}) {
  const session = await requireRole(CAN_HANDLE_MONEY);
  const year = await currentAcademicYear();

  const { klass, days } = await searchParams;
  const minDays = Number(days ?? 0) || 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - minDays);

  const klasses = await db.klass.findMany({
    where: { schoolId: session.schoolId, deletedAt: null },
    orderBy: { rank: "asc" },
  });

  const demands = await db.feeDemand.findMany({
    where: {
      cancelledAt: null,
      status: { in: ["OPEN", "PART_PAID"] },
      dueOn: { lt: cutoff },
      installment: { academicYearId: year.id },
      ...(klass
        ? { enrollment: { section: { klassId: klass } } }
        : {}),
    },
    include: {
      installment: { select: { name: true } },
      enrollment: { include: { section: { include: { klass: true } } } },
      student: {
        include: { guardians: { where: { isPrimary: true }, take: 1 } },
      },
    },
    orderBy: { dueOn: "asc" },
  });

  // Group by student — a principal wants one row per child, not one
  // per installment.
  type Row = {
    studentId: string;
    name: string;
    admissionNo: string;
    klass: string;
    phone: string;
    guardian: string;
    due: number;
    oldest: Date;
    installments: string[];
  };

  const byStudent = new Map<string, Row>();

  for (const d of demands) {
    const owed = Number(d.net) + Number(d.lateFee) - Number(d.paid);
    if (owed <= 0) continue;

    const existing = byStudent.get(d.studentId);
    const g = d.student.guardians[0];

    if (existing) {
      existing.due += owed;
      existing.installments.push(d.installment.name);
      if (d.dueOn < existing.oldest) existing.oldest = d.dueOn;
    } else {
      byStudent.set(d.studentId, {
        studentId: d.studentId,
        name: studentName(d.student),
        admissionNo: d.student.admissionNo,
        klass: `${d.enrollment.section.klass.name}-${d.enrollment.section.name}`,
        phone: g?.phone ?? "—",
        guardian: g?.name ?? "—",
        due: owed,
        oldest: d.dueOn,
        installments: [d.installment.name],
      });
    }
  }

  const rows = [...byStudent.values()].sort((a, b) => b.due - a.due);
  const total = rows.reduce((t, r) => t + r.due, 0);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Defaulters"
        meta={`Academic year ${year.name}`}
        action={
          <div className="no-print flex gap-2">
            <Form action={applyLateFees}>
              <Submit className={btnQuiet} pendingLabel="Updating…">
                Update late fees
              </Submit>
            </Form>
            <PrintButton label="Print list" />
          </div>
        }
      />

      <Panel className="mb-5 flex flex-wrap gap-10 p-5">
        <Stat label="Students owing" value={String(rows.length)} />
        <Stat label="Total outstanding" value={rupees(total)} tone="due" />
      </Panel>

      <form className="no-print mb-4 flex flex-wrap items-end gap-3">
        <div className="w-44">
          <label htmlFor="klass" className="block text-xs font-medium text-[var(--color-muted)]">
            Class
          </label>
          <select
            id="klass"
            name="klass"
            defaultValue={klass ?? ""}
            className={`mt-1 ${input}`}
          >
            <option value="">All classes</option>
            {klasses.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </div>

        <div className="w-44">
          <label htmlFor="days" className="block text-xs font-medium text-[var(--color-muted)]">
            Overdue by at least
          </label>
          <select
            id="days"
            name="days"
            defaultValue={days ?? "0"}
            className={`mt-1 ${input}`}
          >
            <option value="0">Any</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
          </select>
        </div>

        <button className={btnQuiet}>Apply</button>
      </form>

      {rows.length === 0 ? (
        <Empty>No overdue fees. Everything raised has been collected.</Empty>
      ) : (
        <Panel className="overflow-hidden">
          <table className="w-full text-sm">
            <TableHead>
              <th className={th}>Student</th>
              <th className={th}>Class</th>
              <th className={th}>Guardian</th>
              <th className={th}>Pending</th>
              <th className={`${th} text-right`}>Amount</th>
              <th className={`${th} no-print`}></th>
            </TableHead>
            <tbody>
              {rows.map((r) => {
                const overdueDays = Math.floor(
                  (Date.now() - r.oldest.getTime()) / 86_400_000
                );

                return (
                  <tr
                    key={r.studentId}
                    className="border-b border-[var(--color-line)] last:border-0"
                  >
                    <td className={td}>
                      <Link
                        href={`/students/${r.studentId}`}
                        className="font-medium hover:underline"
                      >
                        {r.name}
                      </Link>
                      <span className="ml-2 text-xs text-[var(--color-faint)]">
                        {r.admissionNo}
                      </span>
                    </td>

                    <td className={`${td} text-[var(--color-muted)]`}>
                      {r.klass}
                    </td>

                    <td className={`${td} text-[var(--color-muted)]`}>
                      {r.guardian}
                      <div className="text-xs">{r.phone}</div>
                    </td>

                    <td className={`${td} text-xs text-[var(--color-muted)]`}>
                      {r.installments.join(", ")}
                      <div className="text-[var(--color-due)]">
                        {overdueDays} days overdue · since {date(r.oldest)}
                      </div>
                    </td>

                    <td
                      className={`${td} text-right font-semibold text-[var(--color-due)]`}
                    >
                      {rupees(r.due)}
                    </td>

                    <td className={`${td} no-print text-right`}>
                      <Link
                        href={`/fees/collect/${r.studentId}`}
                        className="inline-flex items-center rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-accent-ink)]"
                      >
                        Collect
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-[var(--color-surface)]">
                <td className={`${td} font-semibold`} colSpan={4}>
                  Total
                </td>
                <td className={`${td} text-right font-semibold`}>
                  {rupees(total)}
                </td>
                <td className="no-print"></td>
              </tr>
            </tfoot>
          </table>
        </Panel>
      )}
    </div>
  );
}
