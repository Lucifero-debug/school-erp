// app/fees/receipt/[id]/page.tsx
//
// The printed fee receipt. A parent keeps this, sometimes for years,
// and brings it back when there is a dispute — so it must show WHICH
// installment was settled and what the concession was, not just a
// total.
//
// Laid out for A5. Two copies on one A4 page would be the next
// improvement if a school asks.

import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole, CAN_HANDLE_MONEY } from "@/lib/session";
import { cancelReceipt, markChequeBounced } from "@/lib/actions/fees";
import { rupees, date, dateTime, studentName } from "@/lib/format";
import { PrintButton } from "@/app/print-button";
import { Form, ConfirmSubmit } from "@/app/form";
import { Panel, input, label, btnQuiet, btnDanger } from "@/app/ui";

// Indian cheque-writing convention, used on printed receipts.
function inWords(n: number): string {
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
    "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
    "Sixteen", "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy",
    "Eighty", "Ninety",
  ];

  function under100(x: number): string {
    if (x < 20) return ones[x];
    return `${tens[Math.floor(x / 10)]}${x % 10 ? " " + ones[x % 10] : ""}`;
  }

  function under1000(x: number): string {
    if (x < 100) return under100(x);
    return `${ones[Math.floor(x / 100)]} Hundred${
      x % 100 ? " " + under100(x % 100) : ""
    }`;
  }

  let rupeesPart = Math.floor(n);
  const parts: string[] = [];

  // Indian grouping: crore, lakh, thousand, hundred.
  const crore = Math.floor(rupeesPart / 10_000_000);
  if (crore) parts.push(`${under1000(crore)} Crore`);
  rupeesPart %= 10_000_000;

  const lakh = Math.floor(rupeesPart / 100_000);
  if (lakh) parts.push(`${under1000(lakh)} Lakh`);
  rupeesPart %= 100_000;

  const thousand = Math.floor(rupeesPart / 1000);
  if (thousand) parts.push(`${under1000(thousand)} Thousand`);
  rupeesPart %= 1000;

  if (rupeesPart) parts.push(under1000(rupeesPart));

  return parts.length ? `${parts.join(" ")} Rupees Only` : "Zero Rupees Only";
}

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireRole(CAN_HANDLE_MONEY);

  const receipt = await db.receipt.findFirst({
    where: { id, student: { schoolId: session.schoolId } },
    include: {
      student: {
        include: {
          school: true,
          guardians: { where: { isPrimary: true }, take: 1 },
          enrollments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { section: { include: { klass: true } } },
          },
        },
      },
      collectedBy: { select: { name: true } },
      academicYear: { select: { name: true } },
      allocations: {
        include: {
          demand: { include: { installment: { select: { name: true } } } },
        },
      },
    },
  });

  if (!receipt) notFound();

  const { student } = receipt;
  const school = student.school;
  const enrollment = student.enrollments[0];
  const guardian = student.guardians[0];

  const void_ = receipt.cancelledAt !== null;
  const bounced = receipt.bouncedAt !== null;
  const canVoid = session.role === "ADMIN" || session.role === "PRINCIPAL";

  const cancel = cancelReceipt.bind(null, receipt.id);
  const bounce = markChequeBounced.bind(null, receipt.id);

  return (
    <div className="mx-auto max-w-[148mm] print:max-w-none">
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <PrintButton label="Print receipt" />
        <Link href="/fees" className={btnQuiet}>
          Back to fees
        </Link>
        <Link
          href={`/students/${student.id}`}
          className="ml-auto text-sm text-[var(--color-accent)] underline underline-offset-2"
        >
          Student record
        </Link>
      </div>

      {(void_ || bounced) && (
        <div className="no-print mb-4 rounded-md border border-[var(--color-due)] px-3 py-2 text-sm text-[var(--color-due)]">
          {void_
            ? `Cancelled ${dateTime(receipt.cancelledAt!)} — ${receipt.cancelledReason}`
            : `Cheque bounced ${dateTime(receipt.bouncedAt!)} — ${receipt.bouncedReason}`}
        </div>
      )}

      <article
        className={`rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-6 text-sm shadow-[var(--shadow-panel)] print:border-0 print:p-0 print:shadow-none ${
          void_ || bounced ? "opacity-60" : ""
        }`}
      >
        <header className="border-b border-[var(--color-ink)] pb-3 text-center">
          <h1 className="text-lg font-semibold tracking-tight">{school.name}</h1>
          <p className="text-xs text-[var(--color-muted)]">
            {school.address}, {school.city} {school.pincode ?? ""} ·{" "}
            {school.phone}
          </p>
          {school.affiliationNo && (
            <p className="text-xs text-[var(--color-muted)]">
              Affiliation No. {school.affiliationNo}
              {school.udiseCode ? ` · UDISE ${school.udiseCode}` : ""}
            </p>
          )}
          <p className="mt-2 text-sm font-medium">FEE RECEIPT</p>
        </header>

        <div className="flex justify-between border-b border-[var(--color-line)] py-2 text-xs">
          <span>
            <span className="text-[var(--color-muted)]">No.</span>{" "}
            <span className="font-medium">{receipt.number}</span>
          </span>
          <span>
            <span className="text-[var(--color-muted)]">Date</span>{" "}
            {date(receipt.receivedAt)}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-b border-[var(--color-line)] py-3 text-xs">
          <Row label="Student" value={studentName(student)} />
          <Row label="Admission No." value={student.admissionNo} />
          <Row
            label="Class"
            value={
              enrollment
                ? `${enrollment.section.klass.name}-${enrollment.section.name}`
                : "—"
            }
          />
          <Row label="Session" value={receipt.academicYear.name} />
          {guardian && <Row label="Guardian" value={guardian.name} />}
          {enrollment?.rollNo && (
            <Row label="Roll No." value={String(enrollment.rollNo)} />
          )}
        </dl>

        <table className="mt-3 w-full text-xs">
          <thead className="text-left text-[var(--color-muted)]">
            <tr>
              <th className="py-1 font-medium">Towards</th>
              <th className="py-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {receipt.allocations.map((a) => (
              <tr key={a.id} className="border-t border-[var(--color-line)]">
                <td className="py-1.5">
                  {a.demand.installment.name}
                  <span className="ml-2 text-[var(--color-muted)]">
                    due {date(a.demand.dueOn)}
                  </span>
                </td>
                <td className="py-1.5 text-right">
                  {rupees(Number(a.amount), true)}
                </td>
              </tr>
            ))}

            {receipt.allocations.length === 0 && (
              <tr className="border-t border-[var(--color-line)]">
                <td className="py-1.5 text-[var(--color-muted)]" colSpan={2}>
                  Allocations reversed — this receipt is {void_ ? "cancelled" : "bounced"}.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--color-ink)]">
              <td className="py-1.5 font-semibold">Total</td>
              <td className="py-1.5 text-right font-semibold">
                {rupees(Number(receipt.amount), true)}
              </td>
            </tr>
          </tfoot>
        </table>

        <p className="mt-2 text-xs">
          <span className="text-[var(--color-muted)]">In words:</span>{" "}
          {inWords(Number(receipt.amount))}
        </p>

        <p className="mt-1 text-xs">
          <span className="text-[var(--color-muted)]">Paid by:</span>{" "}
          {receipt.mode.toLowerCase().replace("_", " ")}
          {receipt.reference ? ` · ${receipt.reference}` : ""}
        </p>

        {(void_ || bounced) && (
          <p className="mt-3 text-center text-sm font-semibold text-[var(--color-due)]">
            {void_ ? "CANCELLED" : "CHEQUE RETURNED"}
          </p>
        )}

        <footer className="mt-10 flex items-end justify-between text-xs">
          <span className="text-[var(--color-muted)]">
            Fees once paid are not refundable.
          </span>

          <div className="min-w-40 border-t border-[var(--color-ink)] pt-1 text-right">
            {receipt.collectedBy?.name ?? "Cashier"}
          </div>
        </footer>
      </article>

      {/* --- corrections --- */}
      {!void_ && !bounced && (
        <details className="no-print mt-5">
          <summary className="cursor-pointer text-sm text-[var(--color-muted)]">
            Something wrong with this receipt?
          </summary>

          <div className="mt-3 space-y-4">
            {(receipt.mode === "CHEQUE" || receipt.mode === "DD") && (
              <Panel className="p-4">
                <p className="mb-2 text-sm">
                  Mark the cheque as returned. The fees go back to
                  outstanding, but the receipt stays on record — the money
                  was taken in good faith.
                </p>

                <Form action={bounce} className="flex items-end gap-3">
                  <div className="flex-1">
                    <label htmlFor="bounceReason" className={label}>
                      Reason
                    </label>
                    <input
                      id="bounceReason"
                      name="reason"
                      placeholder="Insufficient funds"
                      className={`mt-1 ${input}`}
                    />
                  </div>

                  <ConfirmSubmit
                    message="Mark this cheque as bounced?"
                    className={btnQuiet}
                  >
                    Mark bounced
                  </ConfirmSubmit>
                </Form>
              </Panel>
            )}

            {canVoid && (
              <Panel className="p-4">
                <p className="mb-2 text-sm">
                  Cancel the receipt. The number {receipt.number} is not
                  reused — a gap in the sequence causes more trouble at
                  audit than a cancelled row.
                </p>

                <Form action={cancel} className="flex items-end gap-3">
                  <div className="flex-1">
                    <label htmlFor="cancelReason" className={label}>
                      Reason
                    </label>
                    <input
                      id="cancelReason"
                      name="reason"
                      required
                      placeholder="Entered against the wrong student"
                      className={`mt-1 ${input}`}
                    />
                  </div>

                  <ConfirmSubmit
                    message="Cancel this receipt? The fees become outstanding again."
                    className={btnDanger}
                  >
                    Cancel receipt
                  </ConfirmSubmit>
                </Form>
              </Panel>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function Row({ label: l, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-[var(--color-muted)]">{l}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
