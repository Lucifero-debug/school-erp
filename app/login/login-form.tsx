"use client";

import { useActionState } from "react";
import { signIn } from "@/lib/actions/auth";
import { input, label, btnPrimary } from "@/app/ui";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, null);

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="phone" className={label}>
          Phone number
        </label>
        <input
          id="phone"
          name="phone"
          inputMode="numeric"
          autoComplete="username"
          autoFocus
          required
          className={`mt-1 ${input}`}
        />
      </div>

      <div>
        <label htmlFor="password" className={label}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={`mt-1 ${input}`}
        />
      </div>

      {state?.error && (
        <p
          role="alert"
          className="rounded-md border border-[var(--color-due)] bg-white px-3 py-2 text-sm text-[var(--color-due)]"
        >
          {state.error}
        </p>
      )}

      <button
        disabled={pending}
        className={`w-full justify-center ${btnPrimary} disabled:opacity-60`}
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
