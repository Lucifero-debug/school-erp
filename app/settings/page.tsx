// app/settings/page.tsx — school, classes, subjects, staff, years, export

import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole, currentAcademicYear } from "@/lib/session";
import {
  saveSchool,
  addClass,
  addSection,
  setClassTeacher,
  addSubject,
  addStaff,
  deactivateStaff,
  createAcademicYear,
  makeYearCurrent,
  lockYear,
} from "@/lib/actions/settings";
import { changeOwnPassword, resetStaffPassword } from "@/lib/actions/auth";
import { date } from "@/lib/format";
import { Form, Submit, ConfirmSubmit } from "@/app/form";
import { Panel, PageHeader, input, label, btnPrimary, btnQuiet } from "@/app/ui";

export default async function SettingsPage() {
  const session = await requireRole(["ADMIN"]);
  const year = await currentAcademicYear();

  const [school, klasses, subjects, staff, years, me] = await Promise.all([
    db.school.findUnique({ where: { id: session.schoolId } }),
    db.klass.findMany({
      where: { schoolId: session.schoolId, deletedAt: null },
      orderBy: { rank: "asc" },
      include: {
        sections: {
          where: { deletedAt: null },
          orderBy: { name: "asc" },
          include: {
            classTeacher: { select: { id: true, name: true } },
            _count: { select: { enrollments: true } },
          },
        },
      },
    }),
    db.subject.findMany({
      where: { schoolId: session.schoolId, deletedAt: null },
      orderBy: [{ isScholastic: "desc" }, { name: "asc" }],
    }),
    db.staff.findMany({
      where: { schoolId: session.schoolId, deletedAt: null },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    db.academicYear.findMany({
      where: { schoolId: session.schoolId },
      orderBy: { startsOn: "desc" },
    }),
    db.staff.findUnique({ where: { id: session.staffId } }),
  ]);

  if (!school) return null;

  const teachers = staff.filter(
    (s) => s.active && (s.role === "TEACHER" || s.role === "PRINCIPAL")
  );

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <PageHeader
        title="Settings"
        meta={`Academic year ${year.name}`}
        action={
          <Link href="/settings/fees" className={btnQuiet}>
            Fee setup
          </Link>
        }
      />

      {me?.passwordSetByAdmin && (
        <div className="rounded-md border border-[var(--color-warn)] bg-[var(--color-panel)] px-3 py-2 text-sm text-[var(--color-warn)]">
          Your password was set by someone else. Change it below so only you
          know it.
        </div>
      )}

      {/* --- school --- */}
      <section>
        <h2 className="mb-1 text-sm font-semibold">School details</h2>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          These print on every fee receipt and report card.
        </p>

        <Panel className="p-5">
          <Form action={saveSchool} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="name" className={label}>Name</label>
              <input id="name" name="name" defaultValue={school.name} className={`mt-1 ${input}`} />
            </div>

            <div>
              <label htmlFor="phone" className={label}>Phone</label>
              <input id="phone" name="phone" defaultValue={school.phone} className={`mt-1 ${input}`} />
            </div>

            <div>
              <label htmlFor="email" className={label}>Email</label>
              <input id="email" name="email" type="email" defaultValue={school.email ?? ""} className={`mt-1 ${input}`} />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="address" className={label}>Address</label>
              <input id="address" name="address" defaultValue={school.address} className={`mt-1 ${input}`} />
            </div>

            <div>
              <label htmlFor="city" className={label}>City</label>
              <input id="city" name="city" defaultValue={school.city} className={`mt-1 ${input}`} />
            </div>

            <div>
              <label htmlFor="state" className={label}>State</label>
              <input id="state" name="state" defaultValue={school.state} className={`mt-1 ${input}`} />
            </div>

            <div>
              <label htmlFor="pincode" className={label}>Pincode</label>
              <input id="pincode" name="pincode" defaultValue={school.pincode ?? ""} className={`mt-1 ${input}`} />
            </div>

            <div>
              <label htmlFor="board" className={label}>Board</label>
              <select id="board" name="board" defaultValue={school.board} className={`mt-1 ${input}`}>
                <option value="CBSE">CBSE</option>
                <option value="ICSE">ICSE</option>
                <option value="STATE">State board</option>
                <option value="IB">IB</option>
                <option value="CAMBRIDGE">Cambridge</option>
                <option value="UNIVERSITY">University</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            <div>
              <label htmlFor="udiseCode" className={label}>UDISE+ code</label>
              <input id="udiseCode" name="udiseCode" defaultValue={school.udiseCode ?? ""} className={`mt-1 ${input}`} />
            </div>

            <div>
              <label htmlFor="affiliationNo" className={label}>Affiliation number</label>
              <input id="affiliationNo" name="affiliationNo" defaultValue={school.affiliationNo ?? ""} className={`mt-1 ${input}`} />
            </div>

            <div className="sm:col-span-2">
              <Submit className={btnPrimary} pendingLabel="Saving…">Save details</Submit>
            </div>
          </Form>
        </Panel>
      </section>

      {/* --- classes --- */}
      <section>
        <h2 className="mb-1 text-sm font-semibold">Classes and sections</h2>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          Order decides the sequence on lists and the promotion order.
        </p>

        <div className="space-y-3">
          {klasses.map((k) => (
            <Panel key={k.id} className="p-4">
              <div className="mb-2 text-sm font-medium">Class {k.name}</div>

              <div className="space-y-2">
                {k.sections.map((s) => {
                  const setTeacher = setClassTeacher.bind(null, s.id);

                  return (
                    <Form key={s.id} action={setTeacher}>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="w-16 font-medium">
                          {k.name}-{s.name}
                        </span>
                        <span className="w-24 text-xs text-[var(--color-muted)]">
                          {s._count.enrollments} students
                        </span>

                        <select
                          name="classTeacherId"
                          defaultValue={s.classTeacherId ?? ""}
                          className="w-52 rounded-md border border-[var(--color-line)] px-2 py-1 text-sm"
                          aria-label={`Class teacher for ${k.name}-${s.name}`}
                        >
                          <option value="">No class teacher</option>
                          {teachers.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>

                        <Submit className="text-xs text-[var(--color-accent)] underline underline-offset-2">
                          Save
                        </Submit>
                      </div>
                    </Form>
                  );
                })}
              </div>

              <Form action={addSection.bind(null, k.id)} className="mt-3">
                <div className="flex items-end gap-2">
                  <input
                    name="name"
                    required
                    placeholder="New section, e.g. C"
                    className="w-40 rounded-md border border-[var(--color-line)] px-2 py-1 text-sm"
                    aria-label={`Add section to ${k.name}`}
                  />
                  <Submit className="text-xs text-[var(--color-accent)] underline underline-offset-2">
                    Add section
                  </Submit>
                </div>
              </Form>
            </Panel>
          ))}
        </div>

        <Panel className="mt-3 p-4">
          <Form action={addClass}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-40">
                <label htmlFor="className" className={label}>New class</label>
                <input id="className" name="name" required placeholder="XI" className={`mt-1 ${input}`} />
              </div>
              <div className="w-28">
                <label htmlFor="classRank" className={label}>Order</label>
                <input id="classRank" name="rank" type="number" required defaultValue={klasses.length + 6} className={`mt-1 ${input}`} />
              </div>
              <Submit className={btnQuiet}>Add class</Submit>
            </div>
          </Form>
        </Panel>
      </section>

      {/* --- subjects --- */}
      <section>
        <h2 className="mb-1 text-sm font-semibold">Subjects</h2>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          Scholastic subjects are marked; co-scholastic are graded and print
          in a separate block on the report card.
        </p>

        <Panel className="p-4">
          <ul className="mb-4 grid gap-1 text-sm sm:grid-cols-2">
            {subjects.map((s) => (
              <li key={s.id} className="flex justify-between">
                <span>{s.name}</span>
                {!s.isScholastic && (
                  <span className="text-xs text-[var(--color-muted)]">
                    co-scholastic
                  </span>
                )}
              </li>
            ))}
          </ul>

          <Form action={addSubject}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-44 flex-1">
                <label htmlFor="subjectName" className={label}>New subject</label>
                <input id="subjectName" name="name" required className={`mt-1 ${input}`} />
              </div>
              <div className="w-28">
                <label htmlFor="subjectCode" className={label}>Code</label>
                <input id="subjectCode" name="code" className={`mt-1 ${input}`} />
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" name="isScholastic" defaultChecked />
                Scholastic
              </label>
              <Submit className={btnQuiet}>Add subject</Submit>
            </div>
          </Form>
        </Panel>
      </section>

      {/* --- staff --- */}
      <section>
        <h2 className="mb-1 text-sm font-semibold">Staff</h2>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          Everyone signs in with their own phone number. Shared logins make
          the audit trail meaningless.
        </p>

        <div className="space-y-3">
          {staff.map((s) => {
            const reset = resetStaffPassword.bind(null, s.id);

            return (
              <Panel key={s.id} className="p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span className={`font-medium ${s.active ? "" : "text-[var(--color-faint)] line-through"}`}>
                      {s.name}
                    </span>
                    <span className="ml-2 text-xs text-[var(--color-muted)]">
                      {s.phone} · {s.role.toLowerCase()}
                    </span>
                  </div>

                  {s.active && s.id !== session.staffId && (
                    <form action={deactivateStaff.bind(null, s.id)}>
                      <button className="text-xs text-[var(--color-muted)] hover:text-[var(--color-due)]">
                        Remove access
                      </button>
                    </form>
                  )}
                </div>

                {s.active && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-[var(--color-muted)]">
                      Reset password
                    </summary>

                    <Form action={reset} className="mt-2">
                      <div className="flex items-end gap-3">
                        <div className="flex-1">
                          <label htmlFor={`pw_${s.id}`} className={label}>
                            New password (8 or more characters)
                          </label>
                          <input id={`pw_${s.id}`} name="password" type="text" minLength={8} required className={`mt-1 ${input}`} />
                          <p className="mt-1 text-xs text-[var(--color-faint)]">
                            Plain text so you can read it out. Ask them to
                            change it after signing in.
                          </p>
                        </div>
                        <ConfirmSubmit message={`Reset the password for ${s.name}?`} className={btnQuiet}>
                          Reset
                        </ConfirmSubmit>
                      </div>
                    </Form>
                  </details>
                )}
              </Panel>
            );
          })}
        </div>

        <Panel className="mt-3 p-5">
          <h3 className="mb-3 text-sm font-medium">Add a staff member</h3>

          <Form action={addStaff} className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="staffName" className={label}>Name</label>
              <input id="staffName" name="name" required className={`mt-1 ${input}`} />
            </div>
            <div>
              <label htmlFor="staffPhone" className={label}>Phone (used to sign in)</label>
              <input id="staffPhone" name="phone" required inputMode="numeric" className={`mt-1 ${input}`} />
            </div>
            <div>
              <label htmlFor="staffRole" className={label}>Role</label>
              <select id="staffRole" name="role" defaultValue="TEACHER" className={`mt-1 ${input}`}>
                <option value="TEACHER">Teacher — own sections, no money</option>
                <option value="CLERK">Clerk — records, no money, no marks</option>
                <option value="ACCOUNTANT">Accountant — fees only</option>
                <option value="PRINCIPAL">Principal</option>
                <option value="ADMIN">Admin — everything</option>
              </select>
            </div>
            <div>
              <label htmlFor="staffPassword" className={label}>Password (8 or more)</label>
              <input id="staffPassword" name="password" type="text" minLength={8} required className={`mt-1 ${input}`} />
            </div>
            <div>
              <label htmlFor="staffQual" className={label}>Qualification</label>
              <input id="staffQual" name="qualification" placeholder="M.Sc, B.Ed" className={`mt-1 ${input}`} />
            </div>
            <div>
              <label htmlFor="staffDesig" className={label}>Designation</label>
              <input id="staffDesig" name="designation" className={`mt-1 ${input}`} />
            </div>
            <div className="sm:col-span-2">
              <Submit className={btnQuiet}>Add staff member</Submit>
            </div>
          </Form>
        </Panel>
      </section>

      {/* --- my password --- */}
      <section>
        <h2 className="mb-3 text-sm font-semibold">Your password</h2>

        <Panel className="p-5">
          <Form action={changeOwnPassword} className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="current" className={label}>Current</label>
              <input id="current" name="current" type="password" autoComplete="current-password" required className={`mt-1 ${input}`} />
            </div>
            <div>
              <label htmlFor="next" className={label}>New</label>
              <input id="next" name="next" type="password" autoComplete="new-password" minLength={8} required className={`mt-1 ${input}`} />
            </div>
            <div>
              <label htmlFor="confirm" className={label}>Repeat new</label>
              <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required className={`mt-1 ${input}`} />
            </div>
            <div className="sm:col-span-3">
              <Submit className={btnPrimary} pendingLabel="Changing…">Change password</Submit>
            </div>
          </Form>
        </Panel>
      </section>

      {/* --- academic years --- */}
      <section>
        <h2 className="mb-1 text-sm font-semibold">Academic years</h2>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          Switching the current year changes what every screen shows.
          Students are not promoted automatically — enrollment for a new
          year has to be created deliberately.
        </p>

        <div className="space-y-2">
          {years.map((y) => {
            const makeCurrent = makeYearCurrent.bind(null, y.id);
            const toggleLock = lockYear.bind(null, y.id);

            return (
              <Panel key={y.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="text-sm">
                  <span className="font-medium">{y.name}</span>
                  <span className="ml-2 text-xs text-[var(--color-muted)]">
                    {date(y.startsOn)} – {date(y.endsOn)}
                  </span>
                  {y.isCurrent && (
                    <span className="ml-2 text-xs text-[var(--color-good)]">current</span>
                  )}
                  {y.lockedAt && (
                    <span className="ml-2 text-xs text-[var(--color-warn)]">locked</span>
                  )}
                </div>

                <div className="flex gap-2">
                  {!y.isCurrent && (
                    <Form action={makeCurrent}>
                      <ConfirmSubmit
                        message={`Switch to ${y.name}? Every screen will show that year.`}
                        className={btnQuiet}
                      >
                        Make current
                      </ConfirmSubmit>
                    </Form>
                  )}

                  {!y.isCurrent && (
                    <Form action={toggleLock}>
                      <Submit className="text-xs text-[var(--color-muted)] underline underline-offset-2">
                        {y.lockedAt ? "Unlock" : "Lock"}
                      </Submit>
                    </Form>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>

        <Panel className="mt-3 p-4">
          <Form action={createAcademicYear}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-32">
                <label htmlFor="yearName" className={label}>Name</label>
                <input id="yearName" name="name" required placeholder="2027-28" className={`mt-1 ${input}`} />
              </div>
              <div className="w-44">
                <label htmlFor="startsOn" className={label}>Starts</label>
                <input id="startsOn" name="startsOn" type="date" required className={`mt-1 ${input}`} />
              </div>
              <div className="w-44">
                <label htmlFor="endsOn" className={label}>Ends</label>
                <input id="endsOn" name="endsOn" type="date" required className={`mt-1 ${input}`} />
              </div>
              <Submit className={btnQuiet}>Create year</Submit>
            </div>
          </Form>
        </Panel>
      </section>

      {/* --- export --- */}
      <section>
        <h2 className="mb-1 text-sm font-semibold">Your data</h2>
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          Everything here belongs to the school. Download it any time, in
          formats other software can read. Every export is recorded in the
          audit log.
        </p>

        <Panel className="p-5">
          <div className="flex flex-wrap gap-2">
            <a href="/export?type=students" className={btnQuiet}>Students (CSV)</a>
            <a href="/export?type=fees" className={btnQuiet}>Fee demands (CSV)</a>
            <a href="/export?type=receipts" className={btnQuiet}>Receipts (CSV)</a>
            <a href="/export?type=attendance" className={btnQuiet}>Attendance (CSV)</a>
            <a href="/export?type=marks" className={btnQuiet}>Marks (CSV)</a>
            <a href="/export?type=full" className={btnPrimary}>Full backup (JSON)</a>
          </div>

          <p className="mt-3 text-xs text-[var(--color-faint)]">
            These files contain children&rsquo;s personal information. Keep
            them somewhere private and do not email them.
          </p>
        </Panel>
      </section>
    </div>
  );
}
