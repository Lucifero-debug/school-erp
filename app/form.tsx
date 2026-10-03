"use client";

// app/form.tsx
//
// Wraps a server action so errors appear above the form instead of
// replacing the page with a stack trace, and so the submit button
// disables while the action runs — double-submitting a fee receipt is
// a real problem at a counter with a queue.
//
// Children stay server components; they are passed through untouched.

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/result";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function Form({
  action,
  children,
  className = "",
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className={className}>
      {state?.error && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-[var(--color-due)] bg-[var(--color-panel)] px-3 py-2 text-sm text-[var(--color-due)]"
        >
          {state.error}
        </p>
      )}

      {state?.ok && (
        <p
          role="status"
          className="mb-4 rounded-md border border-[var(--color-accent)] bg-[var(--color-accent-wash)] px-3 py-2 text-sm text-[var(--color-accent-ink)]"
        >
          {state.ok}
        </p>
      )}

      {children}
    </form>
  );
}

export function Submit({
  children,
  className = "",
  pendingLabel,
  name,
  value,
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={`${className} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}

// For destructive or irreversible actions. A native confirm rather than
// a modal — one less thing to build, and office staff already know it.
export function ConfirmSubmit({
  children,
  message,
  className = "",
}: {
  children: React.ReactNode;
  message: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
      className={`${className} disabled:opacity-60`}
    >
      {pending ? "Working…" : children}
    </button>
  );
}
