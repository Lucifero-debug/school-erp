// app/settings/fees/page.tsx — fee heads, structures, installments
//
// The riskiest screen in the app. A wrong number here becomes 500
// wrong bills the moment someone raises demands, so the page shows
// the whole structure per class rather than hiding it behind a modal.

import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole, currentAcademicYear } from "@/lib/session";
import {
  addFeeHead,
  setStructureItem,
  addInstallment,
} from "@/lib/actions/settings";
import { rupees, date } from "@/lib/format";
import { Form, Submit } from "@/app/form";
import { Panel, PageHeader, input, label, btnQuiet, th, td, TableHead } from "@/app/ui";

export default async function FeeSetupPage() {
  const session = await requireRole(["ADMIN", "PRINCIPAL"]);
  const year = await currentAcademicYear();

  const [heads, klasses, structures, installments] = await Promise.all([
    db.feeHead.findMany({
      where: { schoolId: session.schoolId, deletedAt: null },
      orderBy: { name: "asc" },
    }),
    db.klass.findMany({
      where: { schoolId: session.schoolId, deletedAt: null },
      orderBy: { rank: "asc" },
    }),
    db.feeStructure.findMany({
      where: { academicYearId: year.id },
      include: { items: { include: { feeHead: true } } },
    }),
    db.feeInstallment.findMany({
      where: { academicYearId: year.id },
      orderBy: { seq: "asc" },
      include: { _count: { select: { demands: true } } },
    }),
  ]);

  const byKlass = new Map(structures.map((s) => [s.klassId, s]));
  const billable = heads.filter((h) => h.active && !h.isLateFee);

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <PageHeader
        title="Fee setup"
        meta={`Academic year ${year.name}`}
        action={
          <Link href="/settings" className={btnQuiet}>
            Back to settings
          </Link>
        }
      />

      <div className="rounded-md border border-[var(--color-warn)] bg-[var(--color-panel)] px-3 py-2 text-sm text-[var(--color-warn)]">
        Changes here affect demands raised <em>from now on</em>. Bills
        already issued are never rewritten.
      </div>

      {/* --- heads --- */}
      <section>
        <h2 className="mb-1 text-sm font-semibold">Fee heads</h2>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          The things a school charges for. Refundable heads (caution money)
          come back to the parent when the student leaves.
        </p>

        <Panel className="p-4">
          <ul className="mb-4 grid gap-1 text-sm sm:grid-cols-2">
            {heads.map((h) => (
              <li key={h.id} className="flex justify-between">
                <span>{h.name}</span>
                <span className="text-xs text-[var(--color-muted)]">
                  {h.isLateFee ? "late fee" : h.refundable ? "refundable" : ""}
                </span>
              </li>
            ))}
          </ul>

          <Form action={addFeeHead}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-44 flex-1">
                <label htmlFor="headName" className={label}>
                  New fee head
                </label>
                <input
                  id="headName"
                  name="name"
                  required
                  placeholder="Laboratory fee"
                  className={`mt-1 ${input}`}
                />
              </div>

              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" name="refundable" />
                Refundable
              </label>

              <Submit className={btnQuiet}>Add head</Submit>
            </div>
          </Form>
        </Panel>
      </section>

      {/* --- structures --- */}
      <section>
        <h2 className="mb-1 text-sm font-semibold">What each class pays</h2>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          Amount is <strong>per occurrence</strong>. A monthly tuition of
          2,000 means 2,000 each month — the generator multiplies it by how
          many months the installment covers.
        </p>

        <div className="space-y-4">
          {klasses.map((k) => {
            const structure = byKlass.get(k.id);
            const save = setStructureItem.bind(null, k.id);

            const annualTotal = (structure?.items ?? []).reduce((t, i) => {
              const perYear =
                i.frequency === "MONTHLY"
                  ? 12
                  : i.frequency === "QUARTERLY"
                    ? 4
                    : i.frequency === "HALF_YEARLY"
                      ? 2
                      : 1;
              return t + Number(i.amount) * perYear;
            }, 0);

            return (
              <Panel key={k.id} className="overflow-hidden">
                <div className="flex items-baseline justify-between border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2">
                  <span className="text-sm font-medium">Class {k.name}</span>
                  <span className="text-xs text-[var(--color-muted)]">
                    {annualTotal > 0
                      ? `${rupees(annualTotal)} per year`
                      : "no structure set"}
                  </span>
                </div>

                {structure && structure.items.length > 0 && (
                  <table className="w-full text-sm">
                    <TableHead>
                      <th className={th}>Head</th>
                      <th className={th}>Frequency</th>
                      <th className={`${th} text-right`}>Each time</th>
                      <th className={`${th} text-right`}>Per year</th>
                    </TableHead>
                    <tbody>
                      {structure.items.map((i) => {
                        const perYear =
                          i.frequency === "MONTHLY"
                            ? 12
                            : i.frequency === "QUARTERLY"
                              ? 4
                              : i.frequency === "HALF_YEARLY"
                                ? 2
                                : 1;

                        return (
                          <tr
                            key={i.id}
                            className="border-b border-[var(--color-line)] last:border-0"
                          >
                            <td className={td}>{i.feeHead.name}</td>
                            <td className={`${td} text-[var(--color-muted)]`}>
                              {i.frequency.toLowerCase().replace("_", " ")}
                            </td>
                            <td className={`${td} text-right`}>
                              {rupees(Number(i.amount))}
                            </td>
                            <td className={`${td} text-right text-[var(--color-muted)]`}>
                              {rupees(Number(i.amount) * perYear)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                <div className="border-t border-[var(--color-line)] p-4">
                  <Form action={save}>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="w-48">
                        <label htmlFor={`head_${k.id}`} className={label}>
                          Head
                        </label>
                        <select
                          id={`head_${k.id}`}
                          name="feeHeadId"
                          required
                          className={`mt-1 ${input}`}
                        >
                          {billable.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="w-32">
                        <label htmlFor={`amt_${k.id}`} className={label}>
                          Amount
                        </label>
                        <input
                          id={`amt_${k.id}`}
                          name="amount"
                          type="number"
                          min={0}
                          required
                          className={`mt-1 ${input}`}
                        />
                      </div>

                      <div className="w-40">
                        <label htmlFor={`freq_${k.id}`} className={label}>
                          Frequency
                        </label>
                        <select
                          id={`freq_${k.id}`}
                          name="frequency"
                          defaultValue="MONTHLY"
                          className={`mt-1 ${input}`}
                        >
                          <option value="MONTHLY">Monthly</option>
                          <option value="QUARTERLY">Quarterly</option>
                          <option value="HALF_YEARLY">Half yearly</option>
                          <option value="ANNUAL">Annual</option>
                          <option value="ONE_TIME">One time</option>
                        </select>
                      </div>

                      <Submit className={btnQuiet}>Set</Submit>
                    </div>
                  </Form>
                </div>
              </Panel>
            );
          })}
        </div>
      </section>

      {/* --- installments --- */}
      <section>
        <h2 className="mb-1 text-sm font-semibold">Billing calendar</h2>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          When fees fall due, and the late fee that applies after the grace
          period.
        </p>

        <Panel className="overflow-hidden">
          <table className="w-full text-sm">
            <TableHead>
              <th className={th}>Installment</th>
              <th className={th}>Due</th>
              <th className={th}>Late fee</th>
              <th className={`${th} text-right`}>Raised</th>
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
                  <td className={`${td} text-xs text-[var(--color-muted)]`}>
                    {Number(i.lateFeePerDay) > 0
                      ? `${rupees(Number(i.lateFeePerDay))}/day after ${i.lateFeeAfterDays} days, max ${rupees(Number(i.lateFeeMax))}`
                      : "none"}
                  </td>
                  <td className={`${td} text-right`}>{i._count.demands}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="border-t border-[var(--color-line)] bg-[var(--color-surface)] p-4">
            <Form action={addInstallment}>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-44">
                  <label htmlFor="instName" className={label}>Name</label>
                  <input id="instName" name="name" required placeholder="Quarter 3" className={`mt-1 ${input}`} />
                </div>
                <div className="w-40">
                  <label htmlFor="instDue" className={label}>Due on</label>
                  <input id="instDue" name="dueOn" type="date" required className={`mt-1 ${input}`} />
                </div>
                <div className="w-24">
                  <label htmlFor="instGrace" className={label}>Grace days</label>
                  <input id="instGrace" name="lateFeeAfterDays" type="number" min={0} defaultValue={10} className={`mt-1 ${input}`} />
                </div>
                <div className="w-28">
                  <label htmlFor="instPerDay" className={label}>Late ₹/day</label>
                  <input id="instPerDay" name="lateFeePerDay" type="number" min={0} defaultValue={20} className={`mt-1 ${input}`} />
                </div>
                <div className="w-28">
                  <label htmlFor="instMax" className={label}>Late max</label>
                  <input id="instMax" name="lateFeeMax" type="number" min={0} defaultValue={1000} className={`mt-1 ${input}`} />
                </div>
                <Submit className={btnQuiet}>Add</Submit>
              </div>
            </Form>
          </div>
        </Panel>
      </section>
    </div>
  );
}
