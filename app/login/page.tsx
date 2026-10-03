import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { optionalSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await optionalSession();

  if (session) {
    // Only bounce to the app if the session still points at a school
    // that exists. A stale cookie — after a database reset, say —
    // would otherwise ping-pong between here and the layout forever.
    // Signing in again overwrites the cookie, which is the fix.
    const school = await db.school.findUnique({
      where: { id: session.schoolId },
      select: { id: true },
    });

    if (school) redirect("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            School management
          </p>
        </div>

        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-6 shadow-[var(--shadow-panel)]">
          <LoginForm />
        </div>

        <p className="mt-4 text-xs text-[var(--color-faint)]">
          These are children&rsquo;s records. Do not share your password, and
          sign out on any shared computer.
        </p>
      </div>
    </div>
  );
}
