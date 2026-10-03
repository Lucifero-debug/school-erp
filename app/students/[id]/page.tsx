// app/students/[id]/page.tsx — the student record
//
// Opening a child's record is an audited event. Fee details are hidden
// from teachers and clerks — see CONTEXT.md §6.

import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import {
  requireSession,
  currentAcademicYear,
  CAN_HANDLE_MONEY,
  CAN_EDIT_STUDENTS,
} from "@/lib/session";
import { audit } from "@/lib/audit";
import { rupees, date, studentName, ageYears } from "@/lib/format";
import { Panel, PageHeader, btnPrimary, btnQuiet, th, td, TableHead } from "@/app/ui";

export default async function StudentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  const year = await currentAcademicYear();

  const canSeeMoney = CAN_HANDLE_MONEY.includes(session.role as never);
  const canEdit = CAN_EDIT_STUDENTS.includes(session.role as never);
  const canIssueTc = session.role === "ADMIN" || session.role === "PRINCIPAL";

  const student = await db.student.findFirst({
    where: { id, schoolId: session.schoolId, deletedAt: null },
    include: {
      tc: true,
      guardians: { where: { deletedAt: null } },
      enrollments: {
        orderBy: { academicYear: { startsOn: "desc" } },
        include: {
          academicYear: { select: { name: true } },
          section: { include: { klass: true } },
        },
      },
      ...(canSeeMoney
        ? {
            concessions: {
              where: { deletedAt: null },
              include: { feeHead: { select: { name: true } } },
            },
            demands: {
              where: { cancelledAt: null },
              orderBy: { dueOn: "asc" },
              include: { installment: { select: { name: true } } },
            },
            receipts: { orderBy: { receivedAt: "desc" }, take: 10 },
          }
        : {}),
    },
  });

  if (!student) notFound();

  await audit({
    action: "student.view",
    entityType: "Student",
    entityId: student.id,
  });

  const current = student.enrollments.find((e) => e.academicYearId === year.id);

  const demands = canSeeMoney
    ? ((student as unknown as { demands: { net: unknown; lateFee: unknown; paid: unknown; status: string; dueOn: Date; id: string; installment: { name: string } }[] }).demands ?? [])
    : [];

  const due = demands.reduce(
    (t, d) => t + Number(d.net) + Number(d.lateFee) - Number(d.paid),
    0
  );

  const concessions = canSeeMoney
    ? ((student as unknown as { concessions: { id: string; type: string; value: unknown; reason: string; feeHead: { name: string } | null }[] }).concessions ?? [])
    : [];

  const receipts = canSeeMoney
    ? ((student as unknown as { receipts: { id: string; number: string; amount: unknown; mode: string; receivedAt: Date; cancelledAt: Date | null; bouncedAt: Date | null }[] }).receipts ?? [])
    : [];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={studentName(student)}
        meta={
          <>
            {student.admissionNo}
            {current
              ? ` · ${current.section.klass.name}-${current.section.name}`
              : " · not enrolled this year"}
            {current?.rollNo ? ` · roll ${current.rollNo}` : ""}
            {student.dob ? ` · ${ageYears(student.dob)}` : ""}
          </>
        }
        action={
          <div className="flex flex-wrap gap-2">
            {canEdit && student.status === "ACTIVE" && (
              <Link href={`/students/${student.id}/edit`} className={btnQuiet}>
                Edit
              </Link>
            )}

            {canIssueTc && (
              <Link href={`/students/${student.id}/tc`} className={btnQuiet}>
                {student.tc ? "View TC" : "Issue TC"}
              </Link>
            )}

            {canSeeMoney && due > 0 && (
              <Link href={`/fees/collect/${student.id}`} className={btnPrimary}>
                Collect {rupees(due)}
              </Link>
            )}
          </div>
        }
      />

      {student.status !== "ACTIVE" && (
        <div className="mb-4 rounded-md border border-[var(--color-warn)] px-3 py-2 text-sm text-[var(--color-warn)]">
          This student is marked{" "}
          {student.status.toLowerCase().replace("_", " ")}
          {student.leftOn ? ` on ${date(student.leftOn)}` : ""}
          {student.tc ? ` · TC ${student.tc.number}` : ""}.
        </div>
      )}

      {/* --- guardians --- */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold">Guardians</h2>

        <Panel className="divide-y divide-[var(--color-line)] text-sm">
          {student.guardians.map((g) => (
            <div
              key={g.id}
              className="flex flex-wrap justify-between gap-2 px-4 py-2.5"
            >
              <div>
                <span className="font-medium">{g.name}</span>
                <span className="ml-2 text-xs text-[var(--color-muted)]">
                  {g.relation.toLowerCase()}
                  {g.isPrimary ? " · primary" : ""}
                </span>
                <div className="text-[var(--color-muted)]">{g.phone}</div>
              </div>

              <div className="text-right text-xs text-[var(--color-muted)]">
                {g.consentGivenAt ? (
                  <div>
                    Consent {date(g.consentGivenAt)} ({g.consentMethod})
                  </div>
                ) : (
                  <div className="text-[var(--color-due)]">
                    No consent recorded
                  </div>
                )}
                <div>
                  {g.messagingConsent
                    ? "Messages allowed"
                    : "No messaging consent"}
                </div>
              </div>
            </div>
          ))}
        </Panel>
      </section>

      {/* --- fees --- */}
      {canSeeMoney && (
        <>
          {concessions.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 text-sm font-semibold">Concessions</h2>
              <Panel className="divide-y divide-[var(--color-line)] text-sm">
                {concessions.map((c) => (
                  <div key={c.id} className="px-4 py-2">
                    {c.type === "PERCENT"
                      ? `${Number(c.value)}%`
                      : rupees(Number(c.value))}{" "}
                    on {c.feeHead?.name ?? "all heads"}
                    <span className="ml-2 text-xs text-[var(--color-muted)]">
                      {c.reason.toLowerCase().replace("_", " ")}
                    </span>
                  </div>
                ))}
              </Panel>
            </section>
          )}

          <section className="mb-6">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Fees</h2>
              <span
                className={
                  due > 0
                    ? "text-sm font-medium text-[var(--color-due)]"
                    : "text-sm text-[var(--color-good)]"
                }
              >
                {due > 0 ? `${rupees(due)} outstanding` : "All clear"}
              </span>
            </div>

            <Panel className="overflow-hidden">
              <table className="w-full text-sm">
                <TableHead>
                  <th className={th}>Installment</th>
                  <th className={th}>Due</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={`${th} text-right`}>Paid</th>
                  <th className={th}>Status</th>
                </TableHead>
                <tbody>
                  {demands.map((d) => (
                    <tr
                      key={d.id}
                      className="border-b border-[var(--color-line)] last:border-0"
                    >
                      <td className={td}>{d.installment.name}</td>
                      <td className={`${td} text-[var(--color-muted)]`}>
                        {date(d.dueOn)}
                      </td>
                      <td className={`${td} text-right`}>
                        {rupees(Number(d.net) + Number(d.lateFee))}
                      </td>
                      <td className={`${td} text-right text-[var(--color-muted)]`}>
                        {Number(d.paid) > 0 ? rupees(Number(d.paid)) : "—"}
                      </td>
                      <td
                        className={`${td} text-xs ${
                          d.status === "PAID"
                            ? "text-[var(--color-good)]"
                            : "text-[var(--color-due)]"
                        }`}
                      >
                        {d.status.toLowerCase().replace("_", " ")}
                      </td>
                    </tr>
                  ))}

                  {demands.length === 0 && (
                    <tr>
                      <td className={`${td} text-[var(--color-muted)]`} colSpan={5}>
                        No fee demands raised yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Panel>
          </section>

          {receipts.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 text-sm font-semibold">Receipts</h2>
              <Panel className="divide-y divide-[var(--color-line)] text-sm">
                {receipts.map((r) => (
                  <div key={r.id} className="flex justify-between px-4 py-2">
                    <Link
                      href={`/fees/receipt/${r.id}`}
                      className="hover:underline"
                    >
                      {r.number}
                      <span className="ml-2 text-xs text-[var(--color-muted)]">
                        {date(r.receivedAt)} · {r.mode.toLowerCase()}
                      </span>
                    </Link>
                    <span
                      className={
                        r.cancelledAt || r.bouncedAt
                          ? "text-[var(--color-faint)] line-through"
                          : ""
                      }
                    >
                      {rupees(Number(r.amount))}
                    </span>
                  </div>
                ))}
              </Panel>
            </section>
          )}
        </>
      )}

      {/* --- history --- */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Enrollment history</h2>
        <Panel className="divide-y divide-[var(--color-line)] text-sm">
          {student.enrollments.map((e) => (
            <div key={e.id} className="flex justify-between px-4 py-2">
              <span>
                {e.academicYear.name} · {e.section.klass.name}-{e.section.name}
                {e.rollNo ? ` · roll ${e.rollNo}` : ""}
              </span>
              <span className="text-[var(--color-muted)]">
                {e.status.toLowerCase()}
              </span>
            </div>
          ))}
        </Panel>
      </section>
    </div>
  );
}
