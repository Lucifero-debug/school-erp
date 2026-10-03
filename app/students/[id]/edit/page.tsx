// app/students/[id]/edit/page.tsx

import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole, currentAcademicYear, CAN_EDIT_STUDENTS } from "@/lib/session";
import { updateStudent, changeSection } from "@/lib/actions/students";
import { isoDate, studentName } from "@/lib/format";
import { Form, Submit } from "@/app/form";
import { Panel, PageHeader, input, label, btnPrimary, btnQuiet } from "@/app/ui";

export default async function EditStudentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireRole(CAN_EDIT_STUDENTS);
  const year = await currentAcademicYear();

  const student = await db.student.findFirst({
    where: { id, schoolId: session.schoolId, deletedAt: null },
    include: { enrollments: { where: { academicYearId: year.id }, take: 1 } },
  });

  if (!student) notFound();

  const sections = await db.section.findMany({
    where: { klass: { schoolId: session.schoolId, deletedAt: null } },
    include: { klass: true },
    orderBy: [{ klass: { rank: "asc" } }, { name: "asc" }],
  });

  const update = updateStudent.bind(null, student.id);
  const move = changeSection.bind(null, student.id);

  const current = student.enrollments[0];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Edit student"
        meta={`${studentName(student)} · ${student.admissionNo}`}
        action={
          <Link href={`/students/${student.id}`} className={btnQuiet}>
            Cancel
          </Link>
        }
      />

      <Panel className="p-5">
        <Form action={update} className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="firstName" className={label}>First name</label>
            <input id="firstName" name="firstName" required defaultValue={student.firstName} className={`mt-1 ${input}`} />
          </div>

          <div>
            <label htmlFor="lastName" className={label}>Last name</label>
            <input id="lastName" name="lastName" defaultValue={student.lastName ?? ""} className={`mt-1 ${input}`} />
          </div>

          <div>
            <label htmlFor="dob" className={label}>Date of birth</label>
            <input id="dob" name="dob" type="date" defaultValue={student.dob ? isoDate(student.dob) : ""} className={`mt-1 ${input}`} />
          </div>

          <div>
            <label htmlFor="gender" className={label}>Gender</label>
            <select id="gender" name="gender" defaultValue={student.gender ?? ""} className={`mt-1 ${input}`}>
              <option value="">Not recorded</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </select>
          </div>

          <div>
            <label htmlFor="srNo" className={label}>Scholar register no.</label>
            <input id="srNo" name="srNo" defaultValue={student.srNo ?? ""} className={`mt-1 ${input}`} />
          </div>

          <div>
            <label htmlFor="apaarId" className={label}>APAAR / ABC ID</label>
            <input id="apaarId" name="apaarId" defaultValue={student.apaarId ?? ""} className={`mt-1 ${input}`} />
          </div>

          <div>
            <label htmlFor="category" className={label}>Category</label>
            <select id="category" name="category" defaultValue={student.category ?? ""} className={`mt-1 ${input}`}>
              <option value="">Not recorded</option>
              <option value="GENERAL">General</option>
              <option value="OBC">OBC</option>
              <option value="SC">SC</option>
              <option value="ST">ST</option>
              <option value="EWS">EWS</option>
            </select>
          </div>

          <div>
            <label htmlFor="city" className={label}>City</label>
            <input id="city" name="city" defaultValue={student.city ?? ""} className={`mt-1 ${input}`} />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="address" className={label}>Address</label>
            <input id="address" name="address" defaultValue={student.address ?? ""} className={`mt-1 ${input}`} />
          </div>

          <div className="sm:col-span-2">
            <Submit className={btnPrimary} pendingLabel="Saving…">Save changes</Submit>
          </div>
        </Form>
      </Panel>

      {/* Section change is a separate action, because it updates the
          enrollment rather than the student — see CONTEXT.md §4.1. */}
      {current && (
        <Panel className="p-5">
          <h2 className="mb-1 text-sm font-semibold">Move to another section</h2>
          <p className="mb-3 text-xs text-[var(--color-muted)]">
            Updates this year&rsquo;s enrolment and gives a new roll number.
            Past years are untouched.
          </p>

          <Form action={move}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-48">
                <label htmlFor="sectionId" className={label}>Section</label>
                <select id="sectionId" name="sectionId" defaultValue={current.sectionId} className={`mt-1 ${input}`}>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.klass.name}-{s.name}
                    </option>
                  ))}
                </select>
              </div>

              <Submit className={btnQuiet}>Move</Submit>
            </div>
          </Form>
        </Panel>
      )}
    </div>
  );
}
