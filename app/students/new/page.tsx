// app/students/new/page.tsx — admission
//
// The admission number is generated, not typed. Guardian consent is a
// required tick, not an optional one: under the DPDP Act a child's
// data cannot be processed without verifiable guardian consent, and
// recording that it was given is part of the obligation.

import { db } from "@/lib/db";
import { requireRole, currentAcademicYear, CAN_EDIT_STUDENTS } from "@/lib/session";
import { admitStudent } from "@/lib/actions/students";
import { Form, Submit } from "@/app/form";
import { Panel, PageHeader, Empty, input, label, btnPrimary } from "@/app/ui";

export default async function NewStudentPage() {
  const session = await requireRole(CAN_EDIT_STUDENTS);
  const year = await currentAcademicYear();

  const sections = await db.section.findMany({
    where: { klass: { schoolId: session.schoolId, deletedAt: null } },
    include: { klass: true },
    orderBy: [{ klass: { rank: "asc" } }, { name: "asc" }],
  });

  if (sections.length === 0) {
    return (
      <div className="mx-auto max-w-lg">
        <Empty href="/settings" cta="Set up classes">
          No classes have been created yet.
        </Empty>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Admit student"
        meta={`Academic year ${year.name} · admission number is generated automatically`}
      />

      <Panel className="p-5">
        <Form action={admitStudent} className="space-y-6">
          {/* --- child --- */}
          <div>
            <h2 className="mb-3 text-sm font-semibold">Student</h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="firstName" className={label}>
                  First name
                </label>
                <input
                  id="firstName"
                  name="firstName"
                  required
                  autoFocus
                  className={`mt-1 ${input}`}
                />
              </div>

              <div>
                <label htmlFor="lastName" className={label}>
                  Last name
                </label>
                <input id="lastName" name="lastName" className={`mt-1 ${input}`} />
              </div>

              <div>
                <label htmlFor="dob" className={label}>
                  Date of birth
                </label>
                <input
                  id="dob"
                  name="dob"
                  type="date"
                  className={`mt-1 ${input}`}
                />
              </div>

              <div>
                <label htmlFor="gender" className={label}>
                  Gender
                </label>
                <select
                  id="gender"
                  name="gender"
                  defaultValue=""
                  className={`mt-1 ${input}`}
                >
                  <option value="">Not recorded</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>

              <div>
                <label htmlFor="sectionId" className={label}>
                  Class and section
                </label>
                <select
                  id="sectionId"
                  name="sectionId"
                  required
                  className={`mt-1 ${input}`}
                >
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.klass.name}-{s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="category" className={label}>
                  Category
                </label>
                <select
                  id="category"
                  name="category"
                  defaultValue=""
                  className={`mt-1 ${input}`}
                >
                  <option value="">Not recorded</option>
                  <option value="GENERAL">General</option>
                  <option value="OBC">OBC</option>
                  <option value="SC">SC</option>
                  <option value="ST">ST</option>
                  <option value="EWS">EWS</option>
                </select>
                <p className="mt-1 text-xs text-[var(--color-faint)]">
                  Only for UDISE+ returns and RTE reporting. Leave blank if
                  the school does not need it.
                </p>
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="address" className={label}>
                  Address
                </label>
                <input id="address" name="address" className={`mt-1 ${input}`} />
              </div>
            </div>
          </div>

          {/* --- guardian --- */}
          <div className="border-t border-[var(--color-line)] pt-5">
            <h2 className="mb-3 text-sm font-semibold">Guardian</h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="guardianName" className={label}>
                  Name
                </label>
                <input
                  id="guardianName"
                  name="guardianName"
                  required
                  className={`mt-1 ${input}`}
                />
              </div>

              <div>
                <label htmlFor="relation" className={label}>
                  Relation
                </label>
                <select
                  id="relation"
                  name="relation"
                  defaultValue="FATHER"
                  className={`mt-1 ${input}`}
                >
                  <option value="FATHER">Father</option>
                  <option value="MOTHER">Mother</option>
                  <option value="GUARDIAN">Guardian</option>
                </select>
              </div>

              <div>
                <label htmlFor="guardianPhone" className={label}>
                  Phone
                </label>
                <input
                  id="guardianPhone"
                  name="guardianPhone"
                  required
                  inputMode="numeric"
                  className={`mt-1 ${input}`}
                />
                <p className="mt-1 text-xs text-[var(--color-faint)]">
                  Fee reminders and absence alerts go here.
                </p>
              </div>

              <div>
                <label htmlFor="guardianEmail" className={label}>
                  Email
                </label>
                <input
                  id="guardianEmail"
                  name="guardianEmail"
                  type="email"
                  className={`mt-1 ${input}`}
                />
              </div>
            </div>
          </div>

          {/* --- consent --- */}
          <div className="border-t border-[var(--color-line)] pt-5">
            <h2 className="mb-3 text-sm font-semibold">Consent</h2>

            <div className="space-y-3">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="consent" required className="mt-0.5" />
                <span>
                  The guardian has given consent for the school to store and
                  process this child&rsquo;s personal details.{" "}
                  <span className="text-[var(--color-muted)]">
                    Required by law before the record can be created.
                  </span>
                </span>
              </label>

              <div className="w-64">
                <label htmlFor="consentMethod" className={label}>
                  How it was given
                </label>
                <select
                  id="consentMethod"
                  name="consentMethod"
                  defaultValue="admission form"
                  className={`mt-1 ${input}`}
                >
                  <option value="admission form">Signed admission form</option>
                  <option value="signed undertaking">Signed undertaking</option>
                  <option value="in person">In person at the office</option>
                </select>
              </div>

              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="messagingConsent" className="mt-0.5" />
                <span>
                  Guardian agrees to receive fee reminders and school notices
                  on WhatsApp. Separate from the consent above, and can be
                  withdrawn.
                </span>
              </label>
            </div>
          </div>

          <Submit className={btnPrimary} pendingLabel="Admitting…">
            Admit student
          </Submit>
        </Form>
      </Panel>
    </div>
  );
}
