// app/fees/page.tsx — the fee counter
//
// One person, a queue of parents, a printer. Everything here is tuned
// for that: search is autofocused, searching by admission number or
// phone works, and the outstanding total is the biggest thing on the
// row so the clerk can read it out without clicking through.

import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole, currentAcademicYear, CAN_HANDLE_MONEY } from "@/lib/session";
import { rupees, date } from "@/lib/format";
import { Panel, PageHeader, Empty, input, th, td, TableHead, btnQuiet } from "@/app/ui";

export default async function FeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireRole(CAN_HANDLE_MONEY);
  const year = await currentAcademicYear();

  const { q } = await searchParams;
  const query = (q ?? "").trim();

  // No query means no list. A school with 2,000 students does not want
  // all of them rendered, and the clerk always knows who is in front
  // of them.
  const students = query
    ? await db.student.findMany({
        where: {
          schoolId: session.schoolId,
          deletedAt: null,
          status: "ACTIVE",
          OR: [
            { firstName: { contains: query, mode: "insensitive" } },
            { lastName: { contains: query, mode: "insensitive" } },
            { admissionNo: { contains: query, mode: "insensitive" } },
            { guardians: { some: { phone: { contains: query } } } },
          ],
        },
        take: 25,
        orderBy: { firstName: "asc" },
        include: {
          enrollments: {
            where: { academicYearId: year.id },
            include: { section: { include: { klass: true } } },
          },
          demands: {
            where: {
              cancelledAt: null,
              status: { in: ["OPEN", "PART_PAID"] },
            },
            orderBy: { dueOn: "asc" },
          },
        },
      })
    : [];

  const installments = await db.feeInstallment.findMany({
    where: { academicYearId: year.id },
    orderBy: { seq: "asc" },
    include: { _count: { select: { demands: true } } },
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Fees"
        meta="Search by name, admission number or guardian phone"
        action={
          <Link href="/fees/installments" className={btnQuiet}>
            Raise demands
          </Link>
        }
      />

      <form className="mb-5">
        <input
          name="q"
          defaultValue={query}
          autoFocus
          placeholder="Name, admission number, or phone"
          className={`max-w-lg ${input}`}
        />
      </form>

      {query && students.length === 0 && (
        <Empty>No student matches &ldquo;{query}&rdquo;.</Empty>
      )}

      {students.length > 0 && (
        <Panel className="mb-8 overflow-hidden">
          <table className="w-full text-sm">
            <TableHead>
              <th className={th}>Student</th>
              <th className={th}>Class</th>
              <th className={`${th} text-right`}>Outstanding</th>
              <th className={th}>Oldest due</th>
              <th className={th}></th>
            </TableHead>
            <tbody>
              {students.map((s) => {
                const due = s.demands.reduce(
                  (t, d) =>
                    t + Number(d.net) + Number(d.lateFee) - Number(d.paid),
                  0
                );

                const oldest = s.demands[0];
                const overdue = oldest && oldest.dueOn < new Date();
                const enrollment = s.enrollments[0];

                return (
                  <tr
                    key={s.id}
                    className="border-b border-[var(--color-line)] last:border-0"
                  >
                    <td className={td}>
                      <Link
                        href={`/students/${s.id}`}
                        className="font-medium hover:underline"
                      >
                        {s.firstName} {s.lastName ?? ""}
                      </Link>
                      <span className="ml-2 text-xs text-[var(--color-faint)]">
                        {s.admissionNo}
                      </span>
                    </td>

                    <td className={`${td} text-[var(--color-muted)]`}>
                      {enrollment
                        ? `${enrollment.section.klass.name}-${enrollment.section.name}`
                        : "not enrolled"}
                    </td>

                    <td
                      className={`${td} text-right text-base font-semibold ${
                        due > 0 ? "text-[var(--color-due)]" : "text-[var(--color-good)]"
                      }`}
                    >
                      {due > 0 ? rupees(due) : "Clear"}
                    </td>

                    <td className={`${td} text-[var(--color-muted)]`}>
                      {oldest ? (
                        <span className={overdue ? "text-[var(--color-due)]" : ""}>
                          {date(oldest.dueOn)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>

                    <td className={`${td} text-right`}>
                      {due > 0 && (
                        <Link
                          href={`/fees/collect/${s.id}`}
                          className="inline-flex items-center rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-accent-ink)]"
                        >
                          Collect
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}

      {/* Installment status, so somebody notices when a quarter has not
          been raised yet. */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">This year&rsquo;s installments</h2>

        <Panel className="overflow-hidden">
          <table className="w-full text-sm">
            <TableHead>
              <th className={th}>Installment</th>
              <th className={th}>Due</th>
              <th className={`${th} text-right`}>Demands raised</th>
            </TableHead>
            <tbody>
              {installments.map((i) => (
                <tr
                  key={i.id}
                  className="border-b border-[var(--color-line)] last:border-0"
                >
                  <td className={td}>{i.name}</td>
                  <td className={`${td} text-[var(--color-muted)]`}>
                    {date(i.dueOn)}
                  </td>
                  <td className={`${td} text-right`}>
                    {i._count.demands === 0 ? (
                      <Link
                        href="/fees/installments"
                        className="text-[var(--color-warn)] underline underline-offset-2"
                      >
                        not raised
                      </Link>
                    ) : (
                      i._count.demands
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </section>
    </div>
  );
}
