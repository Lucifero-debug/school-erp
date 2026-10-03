// app/messages/page.tsx
//
// Who would be messaged, who cannot be, and what has already gone out.
//
// The "cannot be messaged" count is shown deliberately. A school that
// cannot reach half its defaulters needs to see that, and the fix is
// collecting consent at admission, not a bigger send button.

import { db } from "@/lib/db";
import { requireRole, currentAcademicYear, CAN_HANDLE_MONEY } from "@/lib/session";
import { sendFeeReminders, sendAbsenceAlerts } from "@/lib/actions/messaging";
import { isConfigured, feeTemplate, absenceTemplate } from "@/lib/whatsapp";
import { dateTime, isoDate, studentName, rupees } from "@/lib/format";
import { Form, Submit } from "@/app/form";
import { Panel, PageHeader, Stat, input, label, btnPrimary, th, td, TableHead } from "@/app/ui";

export default async function MessagesPage() {
  await requireRole(CAN_HANDLE_MONEY);
  const year = await currentAcademicYear();

  const configured = isConfigured() && Boolean(feeTemplate());

  const overdue = await db.feeDemand.findMany({
    where: {
      cancelledAt: null,
      status: { in: ["OPEN", "PART_PAID"] },
      dueOn: { lt: new Date() },
      installment: { academicYearId: year.id },
    },
    include: {
      student: {
        include: { guardians: { where: { isPrimary: true }, take: 1 } },
      },
    },
  });

  const reachable = new Set<string>();
  const unreachable = new Set<string>();
  let totalDue = 0;

  for (const d of overdue) {
    const owed = Number(d.net) + Number(d.lateFee) - Number(d.paid);
    if (owed <= 0) continue;

    totalDue += owed;

    const g = d.student.guardians[0];

    if (g?.messagingConsent) reachable.add(d.studentId);
    else unreachable.add(d.studentId);
  }

  const recent = await db.messageLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { student: { select: { firstName: true, lastName: true } } },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader title="Parent messages" meta={`Academic year ${year.name}`} />

      {!configured && (
        <div className="rounded-md border border-[var(--color-warn)] bg-[var(--color-panel)] px-3 py-3 text-sm">
          <p className="font-medium text-[var(--color-warn)]">
            WhatsApp is not connected
          </p>
          <p className="mt-1 text-[var(--color-muted)]">
            The lists below still show who would be contacted, but nothing
            can be sent. Add WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID
            and the template names to the environment, and get the templates
            approved in Meta Business Manager first.
          </p>
        </div>
      )}

      {/* --- fee reminders --- */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Fee reminders</h2>

        <Panel className="p-5">
          <div className="mb-4 flex flex-wrap gap-10">
            <Stat
              label="Can be messaged"
              value={String(reachable.size)}
              note="guardian consented"
            />
            <Stat
              label="Cannot be messaged"
              value={String(unreachable.size)}
              tone={unreachable.size > 0 ? "due" : "plain"}
              note="no consent on file"
            />
            <Stat label="Overdue total" value={rupees(totalDue)} tone="due" />
          </div>

          <Form action={sendFeeReminders}>
            <Submit
              className={btnPrimary}
              pendingLabel="Sending…"
            >
              Send {reachable.size} reminder{reachable.size === 1 ? "" : "s"}
            </Submit>

            <p className="mt-2 text-xs text-[var(--color-faint)]">
              One message per student, not per installment. Anyone already
              reminded today is skipped.
            </p>
          </Form>
        </Panel>
      </section>

      {/* --- absence alerts --- */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Absence alerts</h2>

        <Panel className="p-5">
          <Form action={sendAbsenceAlerts}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-44">
                <label htmlFor="day" className={label}>
                  For which day
                </label>
                <input
                  id="day"
                  name="day"
                  type="date"
                  defaultValue={isoDate(new Date())}
                  className={`mt-1 ${input}`}
                />
              </div>

              <Submit className={btnPrimary} pendingLabel="Sending…">
                Send alerts
              </Submit>
            </div>

            <p className="mt-2 text-xs text-[var(--color-faint)]">
              Goes to guardians of students marked absent that day, once.
              {absenceTemplate()
                ? ""
                : " WHATSAPP_ABSENCE_TEMPLATE is not set."}
            </p>
          </Form>
        </Panel>
      </section>

      {/* --- log --- */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Recently sent</h2>

        {recent.length === 0 ? (
          <Panel className="p-8 text-center text-sm text-[var(--color-muted)]">
            Nothing sent yet.
          </Panel>
        ) : (
          <Panel className="overflow-hidden">
            <table className="w-full text-sm">
              <TableHead>
                <th className={th}>Student</th>
                <th className={th}>Kind</th>
                <th className={th}>To</th>
                <th className={th}>Status</th>
              </TableHead>
              <tbody>
                {recent.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-[var(--color-line)] last:border-0"
                  >
                    <td className={td}>
                      {m.student ? studentName(m.student) : "—"}
                    </td>
                    <td className={`${td} text-[var(--color-muted)]`}>
                      {m.kind.toLowerCase().replace("_", " ")}
                    </td>
                    <td className={`${td} text-[var(--color-muted)]`}>
                      {m.toPhone}
                    </td>
                    <td className={td}>
                      {m.sentAt ? (
                        <span className="text-[var(--color-muted)]">
                          sent {dateTime(m.sentAt)}
                        </span>
                      ) : (
                        <span className="text-[var(--color-due)]">
                          failed — {m.failReason}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </section>
    </div>
  );
}
