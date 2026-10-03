// app/fees/installments/page.tsx
//
// Raising demands for an installment — the once-a-quarter job that
// turns a fee structure into money owed.
//
// Generation is idempotent: running it twice does not double-bill,
// because FeeDemand is unique on (student, installment). That matters
// because someone will always click it twice.

import { db } from "@/lib/db";
import { requireRole, currentAcademicYear, CAN_HANDLE_MONEY } from "@/lib/session";
import { raiseDemands } from "@/lib/actions/fees";
import { rupees, date } from "@/lib/format";
import { Form, Submit } from "@/app/form";
import { Panel, PageHeader, input, label, btnPrimary, th, td, TableHead } from "@/app/ui";

export default async function InstallmentsPage() {
  const session = await requireRole(CAN_HANDLE_MONEY);
  const year = await currentAcademicYear();

  const [installments, klasses, structures] = await Promise.all([
    db.feeInstallment.findMany({
      where: { academicYearId: year.id },
      orderBy: { seq: "asc" },
      include: { _count: { select: { demands: true } } },
    }),
    db.klass.findMany({
      where: { schoolId: session.schoolId, deletedAt: null },
      orderBy: { rank: "asc" },
    }),
    db.feeStructure.findMany({
      where: { academicYearId: year.id },
      include: {
        klass: true,
        items: { include: { feeHead: true } },
      },
    }),
  ]);

  const withoutStructure = klasses.filter(
    (k) => !structures.some((s) => s.klassId === k.id)
  );

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader title="Raise demands" meta={`Academic year ${year.name}`} />

      {withoutStructure.length > 0 && (
        <div className="rounded-md border border-[var(--color-warn)] bg-[var(--color-panel)] px-3 py-2 text-sm text-[var(--color-warn)]">
          No fee structure set for{" "}
          {withoutStructure.map((k) => k.name).join(", ")}. Students in those
          classes will be skipped.
        </div>
      )}

      <section className="space-y-4">
        {installments.map((i) => {
          const raise = raiseDemands.bind(null, i.id);
          const alreadyRaised = i._count.demands > 0;

          return (
            <Panel key={i.id} className="p-5">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">{i.name}</h2>
                  <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                    Due {date(i.dueOn)}
                    {Number(i.lateFeePerDay) > 0 &&
                      ` · late fee ${rupees(Number(i.lateFeePerDay))}/day after ${i.lateFeeAfterDays} days, max ${rupees(Number(i.lateFeeMax))}`}
                  </p>
                </div>

                <span
                  className={`text-xs ${
                    alreadyRaised
                      ? "text-[var(--color-good)]"
                      : "text-[var(--color-warn)]"
                  }`}
                >
                  {alreadyRaised
                    ? `${i._count.demands} demands raised`
                    : "not raised yet"}
                </span>
              </div>

              <Form action={raise}>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-44">
                    <label htmlFor={`cadence_${i.id}`} className={label}>
                      Billing cadence
                    </label>
                    <select
                      id={`cadence_${i.id}`}
                      name="cadence"
                      defaultValue="QUARTERLY"
                      className={`mt-1 ${input}`}
                    >
                      <option value="MONTHLY">Monthly</option>
                      <option value="QUARTERLY">Quarterly</option>
                      <option value="HALF_YEARLY">Half yearly</option>
                      <option value="ANNUAL">Annual</option>
                    </select>
                  </div>

                  <div className="w-44">
                    <label htmlFor={`klass_${i.id}`} className={label}>
                      Class
                    </label>
                    <select
                      id={`klass_${i.id}`}
                      name="klassId"
                      defaultValue=""
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

                  <Submit className={btnPrimary} pendingLabel="Raising…">
                    Raise demands
                  </Submit>
                </div>

                <p className="mt-2 text-xs text-[var(--color-faint)]">
                  Safe to run more than once — students already billed for
                  this installment are skipped.
                </p>
              </Form>
            </Panel>
          );
        })}
      </section>

      {/* The structures the generator reads from, so a mistake is
          visible before demands go out to 500 parents. */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Fee structures</h2>

        <div className="space-y-3">
          {structures.map((s) => (
            <Panel key={s.id} className="overflow-hidden">
              <div className="border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium">
                Class {s.klass.name}
              </div>

              <table className="w-full text-sm">
                <TableHead>
                  <th className={th}>Head</th>
                  <th className={th}>Frequency</th>
                  <th className={`${th} text-right`}>Amount each time</th>
                </TableHead>
                <tbody>
                  {s.items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-[var(--color-line)] last:border-0"
                    >
                      <td className={td}>{item.feeHead.name}</td>
                      <td className={`${td} text-[var(--color-muted)]`}>
                        {item.frequency.toLowerCase().replace("_", " ")}
                      </td>
                      <td className={`${td} text-right`}>
                        {rupees(Number(item.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          ))}
        </div>
      </section>
    </div>
  );
}
