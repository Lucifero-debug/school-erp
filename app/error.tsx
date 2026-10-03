"use client";

// Catches anything a page or action throws. Office staff must never see
// a stack trace — they get a readable message and a way to carry on.
// The real error goes to the server log.

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("page error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-lg font-semibold tracking-tight">
        Something went wrong
      </h1>

      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Nothing was saved. Try again, and if it keeps happening, note what
        you were doing and tell whoever supports this system.
      </p>

      <div className="mt-6 flex justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-md bg-[var(--color-accent)] px-3.5 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-ink)]"
        >
          Try again
        </button>

        <a
          href="/"
          className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3.5 py-2 text-sm font-medium hover:bg-[var(--color-surface)]"
        >
          Back to overview
        </a>
      </div>

      {error.digest && (
        <p className="mt-6 text-xs text-[var(--color-faint)]">
          Reference {error.digest}
        </p>
      )}
    </div>
  );
}
