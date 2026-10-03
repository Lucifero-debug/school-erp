// app/students/import/page.tsx

import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole, currentAcademicYear, CAN_EDIT_STUDENTS } from "@/lib/session";
import { ImportForm } from "./import-form";
import { Panel, PageHeader, btnQuiet } from "@/app/ui";

const SAMPLE = `admission_no,first_name,last_name,class,section,roll_no,dob,gender,category,address,guardian_name,guardian_relation,guardian_phone,messaging_consent
2026/0051,Aarav,Sharma,VIII,A,1,14/03/2012,M,GENERAL,"12 Rohini, Delhi",Rajesh Sharma,father,9811111111,yes
,Diya,Verma,VIII,A,2,02/07/2012,F,,,Sunita Verma,mother,9811111112,yes
,Imran,Khan,IX,B,,21/11/2011,M,OBC,,Yusuf Khan,father,9811111113,no`;

export default async function ImportPage() {
  const session = await requireRole(CAN_EDIT_STUDENTS);
  const year = await currentAcademicYear();

  const sections = await db.section.findMany({
    where: { klass: { schoolId: session.schoolId, deletedAt: null } },
    include: { klass: true },
    orderBy: [{ klass: { rank: "asc" } }, { name: "asc" }],
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Import students"
        meta={`They will be enrolled in ${year.name}`}
        action={
          <Link href="/students" className={btnQuiet}>
            Back to students
          </Link>
        }
      />

      <Panel className="p-5 text-sm">
        <h2 className="mb-2 font-semibold">How it works</h2>

        <ol className="list-decimal space-y-1 pl-5 text-[var(--color-muted)]">
          <li>Export your existing list as CSV and paste it below.</li>
          <li>
            Press <strong>Check the file</strong>. You get a row-by-row
            report. Nothing is saved.
          </li>
          <li>Fix anything it flags, paste again, check again.</li>
          <li>
            Import. All or nothing — if one row fails, none are saved.
          </li>
        </ol>

        <h3 className="mb-1 mt-4 font-medium">Columns</h3>

        <p className="text-xs text-[var(--color-muted)]">
          Required: <code>first_name</code>, <code>class</code>,{" "}
          <code>guardian_name</code>, <code>guardian_phone</code>.
          <br />
          Optional: <code>admission_no</code> (generated if blank),{" "}
          <code>last_name</code>, <code>section</code> (defaults to A),{" "}
          <code>roll_no</code>, <code>dob</code>, <code>gender</code>,{" "}
          <code>category</code>, <code>address</code>,{" "}
          <code>guardian_relation</code>, <code>messaging_consent</code>.
          <br />
          Column order does not matter. Extra columns are ignored.
        </p>

        <p className="mt-2 text-xs text-[var(--color-muted)]">
          Dates are read day-first — <code>14/03/2012</code> is 14 March,
          not 3 February. <code>yyyy-mm-dd</code> also works. Anything else
          is rejected rather than guessed, because a wrong date of birth
          follows a child for years.
        </p>

        <h3 className="mb-1 mt-4 font-medium">Classes that exist</h3>

        <p className="text-xs text-[var(--color-muted)]">
          {sections.length > 0
            ? sections.map((s) => `${s.klass.name}-${s.name}`).join(", ")
            : "None yet — create them in Settings first."}
          <br />
          A row naming anything else is rejected. The names must match
          exactly, apart from capitalisation.
        </p>

        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-[var(--color-accent)]">
            Show a sample file
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-[var(--color-surface)] p-3 text-xs">
            {SAMPLE}
          </pre>
        </details>
      </Panel>

      <ImportForm />
    </div>
  );
}
