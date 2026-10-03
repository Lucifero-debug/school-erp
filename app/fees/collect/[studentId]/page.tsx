// app/fees/collect/[studentId]/page.tsx
//
// The collection screen. Shows exactly what is owed and why, because
// the clerk has to be able to answer "what is this 600 for?" without
// leaving the page.
//
// Payment allocates oldest demand first — see CONTEXT.md §5. The form
// defaults to the full outstanding, which is what parents usually pay.

import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole, CAN_HANDLE_MONEY } from "@/lib/session";
import { collectFee } from "@/lib/actions/fees";
import { rupees, date, studentName } from "@/lib/format";
import { Form, Submit } from "@/app/form";
import { Panel, PageHeader, input, label, btnPrimary, th, td, TableHead } from "@/app/ui";

export default async function CollectPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const session = await requireRole(CAN_HANDLE_MONEY);

  const student = await db.student.findFirst({
    where: { id: studentId, schoolId: session.schoolId, deletedAt: null },
    include: {
      guardians: { where: { isPrimary: true }, take: 1 },
      enrollments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { section: { include: { klass: true } } },
      },
      demands: {
        where: { cancelledAt: null, status: { in: ["OPEN", "PART_PAID"] } },
        orderBy: { dueOn: "asc" },
        include: {
          installment: { select: { name: true } },
          lines: true,
        },
      },
    },
  });

  if (!student) notFound();

  const totalDue = student.demands.reduce(
    (t, d) => t + Number(d.net) + Number(d.lateFee) - Number(d.paid),
    0
  );

  const enrollment = student.enrollments[0];
  const guardian = student.guardians[0];

  const collect = collectFee.bind(null, student.id);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={studentName(student)}
        meta={
          <>
            {student.admissionNo}
            {enrollment
              ? ` · ${enrollment.section.klass.name}-${enrollment.section.name}`
              : ""}
            {guardian ? ` · ${guardian.name}, ${guardian.phone}` : ""}
          </>
        }
        action={
          <Link
            href={`/students/${student.id}`}
            className="text-sm text-[var(--color-accent)] underline underline-offset-2"
          >
            Full record
          </Link>
        }
      />

      {totalDue <= 0 ? (
        <Panel className="p-8 text-center">
          <p className="text-sm text-[var(--color-good)]">
            Nothing outstanding. All fees are clear.
          </p>
          <Link
            href="/fees"
            className="mt-3 inline-block text-sm text-[var(--color-accent)] underline underline-offset-2"
          >
            Back to fees
          </Link>
        </Panel>
      ) : (
        <>
          {/* What is owed, broken down. The clerk reads from this. */}
          <Panel className="mb-5 overflow-hidden">
            <table className="w-full text-sm">
              <TableHead>
                <th className={th}>Installment</th>
                <th className={th}>Due on</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={`${th} text-right`}>Paid</th>
                <th className={`${th} text-right`}>Outstanding</th>
              </TableHead>
              <tbody>
                {student.demands.map((d) => {
                  const owed =
                    Number(d.net) + Number(d.lateFee) - Number(d.paid);
                  const overdue = d.dueOn < new Date();

                  return (
                    <tr
                      key={d.id}
                      className="border-b border-[var(--color-line)] last:border-0 align-top"
                    >
                      <td className={td}>
                        <div className="font-medium">{d.installment.name}</div>

                        {/* Line detail, so "what is this for" is
                            answerable without clicking. */}
                        <div className="mt-1 space-y-0.5">
                          {d.lines.map((l) => (
                            <div
                              key={l.id}
                              className="text-xs text-[var(--color-muted)]"
                            >
                              {l.description} {rupees(Number(l.gross))}
                              {Number(l.concession) > 0 && (
                                <span className="text-[var(--color-good)]">
                                  {" "}
                                  − {rupees(Number(l.concession))}
                                  {l.concessionReason
                                    ? ` (${l.concessionReason.toLowerCase().replace("_", " ")})`
                                    : ""}
                                </span>
                              )}
                            </div>
                          ))}

                          {Number(d.lateFee) > 0 && (
                            <div className="text-xs text-[var(--color-due)]">
                              Late fee {rupees(Number(d.lateFee))}
                            </div>
                          )}
                        </div>
                      </td>

                      <td className={`${td} whitespace-nowrap`}>
                        <span
                          className={overdue ? "text-[var(--color-due)]" : ""}
                        >
                          {date(d.dueOn)}
                        </span>
                      </td>

                      <td className={`${td} text-right`}>
                        {rupees(Number(d.net) + Number(d.lateFee))}
                      </td>
                      <td className={`${td} text-right text-[var(--color-muted)]`}>
                        {Number(d.paid) > 0 ? rupees(Number(d.paid)) : "—"}
                      </td>
                      <td className={`${td} text-right font-medium`}>
                        {rupees(owed)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-[var(--color-surface)]">
                  <td className={`${td} font-semibold`} colSpan={4}>
                    Total outstanding
                  </td>
                  <td
                    className={`${td} text-right text-base font-semibold text-[var(--color-due)]`}
                  >
                    {rupees(totalDue)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </Panel>

          <Panel className="p-5">
            <Form action={collect}>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-36">
                  <label htmlFor="amount" className={label}>
                    Amount received
                  </label>
                  <input
                    id="amount"
                    name="amount"
                    type="number"
                    min={1}
                    max={totalDue}
                    step="0.01"
                    defaultValue={totalDue}
                    autoFocus
                    className={`mt-1 ${input} text-base font-semibold`}
                  />
                </div>

                <div className="w-40">
                  <label htmlFor="mode" className={label}>
                    Mode
                  </label>
                  <select id="mode" name="mode" className={`mt-1 ${input}`}>
                    <option value="CASH">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="CHEQUE">Cheque</option>
                    <option value="CARD">Card</option>
                    <option value="BANK_TRANSFER">Bank transfer</option>
                    <option value="DD">Demand draft</option>
                    <option value="ONLINE">Online gateway</option>
                  </select>
                </div>

                <div className="min-w-44 flex-1">
                  <label htmlFor="reference" className={label}>
                    Reference
                  </label>
                  <input
                    id="reference"
                    name="reference"
                    placeholder="Cheque no. / UPI ref"
                    className={`mt-1 ${input}`}
                  />
                </div>

                <Submit className={btnPrimary} pendingLabel="Saving…">
                  Take payment and print
                </Submit>
              </div>

              <p className="mt-3 text-xs text-[var(--color-faint)]">
                Part payment is allowed and settles the oldest installment
                first. More than the outstanding is refused — there is no
                advance balance in this version.
              </p>
            </Form>
          </Panel>
        </>
      )}
    </div>
  );
}
