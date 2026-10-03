// app/students/[id]/tc/page.tsx
//
// Issue a transfer certificate, or print the one already issued.
//
// A TC is a legal document. Numbered, never deleted, and gated on
// cleared dues with a recorded override — because schools do
// occasionally let someone go, and pretending otherwise just means
// they work around the software.

import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole, currentAcademicYear } from "@/lib/session";
import { issueTC } from "@/lib/actions/leaving";
import { rupees, date, studentName } from "@/lib/format";
import { PrintButton } from "@/app/print-button";
import { Form, ConfirmSubmit } from "@/app/form";
import { Panel, PageHeader, input, label, btnQuiet } from "@/app/ui";

export default async function TcPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireRole(["ADMIN", "PRINCIPAL"]);
  const year = await currentAcademicYear();

  const student = await db.student.findFirst({
    where: { id, schoolId: session.schoolId, deletedAt: null },
    include: {
      school: true,
      tc: true,
      guardians: { where: { isPrimary: true }, take: 1 },
      enrollments: {
        orderBy: { academicYear: { startsOn: "desc" } },
        take: 1,
        include: {
          section: { include: { klass: true } },
          academicYear: { select: { name: true } },
        },
      },
      demands: {
        where: { cancelledAt: null, status: { in: ["OPEN", "PART_PAID"] } },
      },
    },
  });

  if (!student) notFound();

  const outstanding = student.demands.reduce(
    (t, d) => t + Number(d.net) + Number(d.lateFee) - Number(d.paid),
    0
  );

  const enrollment = student.enrollments[0];
  const guardian = student.guardians[0];
  const school = student.school;

  // ---------------------------------------------------------------
  // Already issued — print it
  // ---------------------------------------------------------------
  if (student.tc) {
    const tc = student.tc;

    return (
      <div className="mx-auto max-w-[190mm] print:max-w-none">
        <div className="no-print mb-4 flex gap-3">
          <PrintButton label="Print certificate" />
          <Link href={`/students/${student.id}`} className={btnQuiet}>
            Back to student
          </Link>
        </div>

        <article className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-8 text-sm shadow-[var(--shadow-panel)] print:border-0 print:p-0 print:shadow-none">
          <header className="border-b-2 border-[var(--color-ink)] pb-3 text-center">
            <h1 className="text-xl font-semibold tracking-tight">
              {school.name}
            </h1>
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
            <p className="mt-3 text-sm font-medium tracking-wide">
              TRANSFER CERTIFICATE
            </p>
          </header>

          <div className="flex justify-between py-3 text-xs">
            <span>
              <span className="text-[var(--color-muted)]">TC No.</span>{" "}
              <span className="font-medium">{tc.number}</span>
            </span>
            <span>
              <span className="text-[var(--color-muted)]">Date</span>{" "}
              {date(tc.issuedOn)}
            </span>
          </div>

          <dl className="space-y-2 border-y border-[var(--color-line)] py-4 text-sm">
            <Line n={1} label="Name of the student" value={studentName(student)} />
            <Line
              n={2}
              label="Father's / Guardian's name"
              value={guardian?.name ?? "—"}
            />
            <Line n={3} label="Admission number" value={student.admissionNo} />
            {student.srNo && (
              <Line n={4} label="Scholar register number" value={student.srNo} />
            )}
            <Line
              n={5}
              label="Date of birth"
              value={student.dob ? date(student.dob) : "—"}
            />
            <Line
              n={6}
              label="Date of admission"
              value={student.admittedOn ? date(student.admittedOn) : "—"}
            />
            <Line n={7} label="Class last attended" value={tc.lastClass} />
            <Line n={8} label="Date of leaving" value={date(tc.issuedOn)} />
            <Line
              n={9}
              label="Reason for leaving"
              value={tc.reason ?? "At guardian's request"}
            />
            <Line n={10} label="Conduct" value={tc.conduct ?? "Satisfactory"} />
            <Line
              n={11}
              label="All dues cleared"
              value={tc.duesCleared ? "Yes" : "No"}
            />
          </dl>

          <p className="mt-4 text-xs text-[var(--color-muted)]">
            Certified that the particulars above are correct as per the
            school records.
          </p>

          <footer className="mt-16 flex justify-between text-xs">
            <div className="min-w-40 border-t border-[var(--color-ink)] pt-1 text-center">
              Class Teacher
            </div>
            <div className="min-w-40 border-t border-[var(--color-ink)] pt-1 text-center">
              Office
            </div>
            <div className="min-w-40 border-t border-[var(--color-ink)] pt-1 text-center">
              Principal
            </div>
          </footer>
        </article>
      </div>
    );
  }

  // ---------------------------------------------------------------
  // Not issued — issue it
  // ---------------------------------------------------------------
  const issue = issueTC.bind(null, student.id);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Issue transfer certificate"
        meta={`${studentName(student)} · ${student.admissionNo}${
          enrollment
            ? ` · ${enrollment.section.klass.name}-${enrollment.section.name}`
            : ""
        }`}
        action={
          <Link href={`/students/${student.id}`} className={btnQuiet}>
            Back
          </Link>
        }
      />

      {outstanding > 0 && (
        <div className="mb-4 rounded-md border border-[var(--color-due)] px-3 py-2 text-sm text-[var(--color-due)]">
          {rupees(outstanding)} is still outstanding. Collect it first, or
          tick the override below — the override is recorded on the
          certificate and in the audit log.
        </div>
      )}

      <Panel className="p-5">
        <Form action={issue} className="space-y-4">
          <div>
            <label htmlFor="reason" className={label}>
              Reason for leaving
            </label>
            <input
              id="reason"
              name="reason"
              placeholder="Family relocating to Pune"
              className={`mt-1 ${input}`}
            />
          </div>

          <div>
            <label htmlFor="conduct" className={label}>
              Conduct
            </label>
            <select
              id="conduct"
              name="conduct"
              defaultValue="Satisfactory"
              className={`mt-1 ${input}`}
            >
              <option>Excellent</option>
              <option>Good</option>
              <option>Satisfactory</option>
            </select>
          </div>

          {outstanding > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="overrideDues" className="mt-0.5" />
              <span>
                Issue anyway despite {rupees(outstanding)} outstanding.
              </span>
            </label>
          )}

          <div className="rounded-md bg-[var(--color-surface)] p-3 text-xs text-[var(--color-muted)]">
            Issuing a TC marks the student as left and closes their
            enrolment for {year.name}. It cannot be undone, and the
            certificate number is never reused.
          </div>

          <ConfirmSubmit
            message="Issue the transfer certificate? This marks the student as left and cannot be undone."
            className="inline-flex items-center rounded-md bg-[var(--color-accent)] px-3.5 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-ink)]"
          >
            Issue certificate
          </ConfirmSubmit>
        </Form>
      </Panel>
    </div>
  );
}

function Line({
  n,
  label: l,
  value,
}: {
  n: number;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3">
      <dt className="w-6 shrink-0 text-[var(--color-muted)]">{n}.</dt>
      <dt className="w-56 shrink-0 text-[var(--color-muted)]">{l}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
