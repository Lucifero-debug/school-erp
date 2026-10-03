"use client";

// app/students/import/import-form.tsx
//
// Paste the CSV, press Check, read the report, then import. The check
// step is not optional — an import that half works is worse than one
// that refuses, and nobody reads a warning they were not forced to
// look at.

import { useActionState, useState, useTransition } from "react";
import { dryRunImport, runImport, type DryRun } from "@/lib/actions/import";
import { input, label, btnPrimary, btnQuiet, Panel } from "@/app/ui";

export function ImportForm() {
  const [csv, setCsv] = useState("");
  const [report, setReport] = useState<DryRun | null>(null);
  const [checking, startCheck] = useTransition();
  const [state, action, pending] = useActionState(runImport, null);

  const clean =
    report !== null && report.problems.length === 0 && report.willCreate > 0;

  return (
    <div className="space-y-5">
      <Panel className="p-5">
        <label htmlFor="csv" className={label}>
          Paste the CSV
        </label>

        <textarea
          id="csv"
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setReport(null); // the report is stale the moment the file changes
          }}
          rows={10}
          spellCheck={false}
          placeholder="admission_no,first_name,last_name,class,section,..."
          className={`mt-1 font-mono text-xs ${input}`}
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!csv.trim() || checking}
            onClick={() =>
              startCheck(async () => {
                setReport(await dryRunImport(csv));
              })
            }
            className={`${btnQuiet} disabled:opacity-60`}
          >
            {checking ? "Checking…" : "Check the file"}
          </button>

          <span className="text-xs text-[var(--color-faint)]">
            Nothing is saved until you import.
          </span>
        </div>
      </Panel>

      {report && (
        <Panel className="p-5">
          <h2 className="mb-3 text-sm font-semibold">
            {report.total} rows read · {report.willCreate} would be created
          </h2>

          {report.missingSections.length > 0 && (
            <div className="mb-3 rounded-md border border-[var(--color-due)] px-3 py-2 text-sm text-[var(--color-due)]">
              These classes do not exist yet:{" "}
              {report.missingSections.join(", ")}. Create them in Settings
              first, or fix the spelling in the file.
            </div>
          )}

          {report.problems.length > 0 ? (
            <>
              <p className="mb-2 text-sm text-[var(--color-due)]">
                {report.problems.length} row
                {report.problems.length === 1 ? "" : "s"} need fixing. Nothing
                will import until every row is clean.
              </p>

              <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
                {report.problems.slice(0, 50).map((p) => (
                  <li key={p.line}>
                    <span className="text-[var(--color-muted)]">
                      Line {p.line}:
                    </span>{" "}
                    {p.error}
                  </li>
                ))}
                {report.problems.length > 50 && (
                  <li className="text-[var(--color-muted)]">
                    …and {report.problems.length - 50} more
                  </li>
                )}
              </ul>
            </>
          ) : (
            <>
              <p className="mb-2 text-sm text-[var(--color-good)]">
                Every row is usable. First few:
              </p>

              <ul className="space-y-1 text-xs">
                {report.sample.map((s) => (
                  <li key={s.line}>
                    <span className="font-medium">{s.name}</span> · {s.klass} ·{" "}
                    <span className="text-[var(--color-muted)]">
                      {s.guardian}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      )}

      {clean && (
        <Panel className="p-5">
          <form action={action} className="space-y-4">
            <input type="hidden" name="csv" value={csv} />

            {state?.error && (
              <p
                role="alert"
                className="rounded-md border border-[var(--color-due)] px-3 py-2 text-sm text-[var(--color-due)]"
              >
                {state.error}
              </p>
            )}

            {state?.ok && (
              <p
                role="status"
                className="rounded-md border border-[var(--color-accent)] bg-[var(--color-accent-wash)] px-3 py-2 text-sm text-[var(--color-accent-ink)]"
              >
                {state.ok}
              </p>
            )}

            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="consent" required className="mt-0.5" />
              <span>
                The school holds guardian consent to store and process these
                children&rsquo;s details.{" "}
                <span className="text-[var(--color-muted)]">
                  Required by law before the records can be created.
                </span>
              </span>
            </label>

            <button
              disabled={pending}
              className={`${btnPrimary} disabled:opacity-60`}
            >
              {pending
                ? "Importing…"
                : `Import ${report.willCreate} students`}
            </button>

            <p className="text-xs text-[var(--color-faint)]">
              All or nothing — if any row fails, none are saved. Large files
              can take a minute.
            </p>
          </form>
        </Panel>
      )}
    </div>
  );
}
