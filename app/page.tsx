// app/page.tsx — overview
//
// What the head of school glances at in the morning. Three numbers that
// matter and nothing else: money collected today, money outstanding,
// and who is absent.
//
// The fee figures are hidden from teachers — see CONTEXT.md §6.

import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession, currentAcademicYear, CAN_HANDLE_MONEY } from "@/lib/session";
import { rupees, startOfDay, endOfDay, date } from "@/lib/format";
import { Panel, PageHeader, Stat, btnPrimary, th, td, TableHead } from "@/app/ui";

export default async function OverviewPage() {
  const session = await requireSession();
  const year = await currentAcademicYear();

  const canSeeMoney = CAN_HANDLE_MONEY.includes(session.role as never);

  const today = new Date();
  const dayStart = startOfDay(today);
  const dayEnd = endOfDay(today);

  const [studentCount, collectedToday, outstanding, overdueCount, recent] =
    await Promise.all([
      db.student.count({
        where: { schoolId: session.schoolId, status: "ACTIVE", deletedAt: null },
      }),

      canSeeMoney
        ? db.receipt.aggregate({
            where: {
              academicYearId: year.id,
              cancelledAt: null,
              bouncedAt: null,
              receivedAt: { gte: dayStart, lte: dayEnd },
            },
            _sum: { amount: true },
            _count: true,
          })
        : null,

      // Outstanding is computed, never read from a balance column.
      canSeeMoney
        ? db.feeDemand.aggregate({
            where: {
              cancelledAt: null,
              status: { in: ["OPEN", "PART_PAID"] },
              installment: { academicYearId: year.id },
            },
            _sum: { net: true, lateFee: true, paid: true },
          })
        : null,

      canSeeMoney
        ? db.feeDemand.count({
            where: {
              cancelledAt: null,
              status: { in: ["OPEN", "PART_PAID"] },
              dueOn: { lt: today },
              installment: { academicYearId: year.id },
            },
          })
        : 0,

      canSeeMoney
        ? db.receipt.findMany({
            where: { academicYearId: year.id, cancelledAt: null },
            orderBy: { receivedAt: "desc" },
            take: 8,
            include: {
              student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
            },
          })
        : [],
    ]);

  const due = outstanding
    ? Number(outstanding._sum.net ?? 0) +
      Number(outstanding._sum.lateFee ?? 0) -
      Number(outstanding._sum.paid ?? 0)
    : 0;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`Good ${today.getHours() < 12 ? "morning" : "afternoon"}, ${session.name.split(" ")[0]}`}
        meta={date(today)}
        action={
          canSeeMoney ? (
            <Link href="/fees" className={btnPrimary}>
              Collect fees
            </Link>
          ) : null
        }
      />

      <Panel className="mb-6 flex flex-wrap gap-10 p-5">
        <Stat label="Students on roll" value={String(studentCount)} />

        {canSeeMoney && collectedToday && (
          <Stat
            label="Collected today"
            value={rupees(Number(collectedToday._sum.amount ?? 0))}
            tone="good"
            note={`${collectedToday._count} receipt${
              collectedToday._count === 1 ? "" : "s"
            }`}
          />
        )}

        {canSeeMoney && (
          <Stat
            label="Outstanding"
            value={rupees(due)}
            tone={due > 0 ? "due" : "plain"}
            note={`${overdueCount} overdue demand${overdueCount === 1 ? "" : "s"}`}
          />
        )}
      </Panel>

      {canSeeMoney && (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Recent receipts</h2>
            <Link
              href="/fees/defaulters"
              className="text-sm text-[var(--color-accent)] underline underline-offset-2"
            >
              See defaulters
            </Link>
          </div>

          {recent.length === 0 ? (
            <Panel className="p-8 text-center text-sm text-[var(--color-muted)]">
              No fees collected yet this year.
            </Panel>
          ) : (
            <Panel className="overflow-hidden">
              <table className="w-full text-sm">
                <TableHead>
                  <th className={th}>Receipt</th>
                  <th className={th}>Student</th>
                  <th className={th}>Mode</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={th}>Date</th>
                </TableHead>
                <tbody>
                  {recent.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-[var(--color-line)] last:border-0"
                    >
                      <td className={`${td} text-[var(--color-muted)]`}>
                        <Link
                          href={`/fees/receipt/${r.id}`}
                          className="hover:underline"
                        >
                          {r.number}
                        </Link>
                      </td>
                      <td className={td}>
                        <Link
                          href={`/students/${r.student.id}`}
                          className="font-medium hover:underline"
                        >
                          {r.student.firstName} {r.student.lastName ?? ""}
                        </Link>
                        <span className="ml-2 text-xs text-[var(--color-faint)]">
                          {r.student.admissionNo}
                        </span>
                      </td>
                      <td className={`${td} text-[var(--color-muted)]`}>
                        {r.mode.toLowerCase().replace("_", " ")}
                      </td>
                      <td className={`${td} text-right`}>
                        {rupees(Number(r.amount))}
                      </td>
                      <td className={`${td} text-[var(--color-muted)]`}>
                        {date(r.receivedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </section>
      )}

      {!canSeeMoney && (
        <Panel className="p-8 text-center text-sm text-[var(--color-muted)]">
          Your sections and today&rsquo;s attendance will appear here.
          <div className="mt-3">
            <Link
              href="/attendance"
              className="text-[var(--color-accent)] underline underline-offset-2"
            >
              Mark attendance
            </Link>
          </div>
        </Panel>
      )}
    </div>
  );
}
