import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import "./globals.css";
import { db } from "@/lib/db";
import { optionalSession } from "@/lib/session";
import { signOut } from "@/lib/actions/auth";

export const metadata: Metadata = {
  title: "School",
  description: "School management",
};

// Nav is filtered by role. A teacher must never see Fees — see
// CONTEXT.md §6. The filter here is convenience; the real enforcement
// is requireRole() inside each page and action.
const nav: { href: string; label: string; roles: string[] }[] = [
  { href: "/", label: "Overview", roles: ["ADMIN", "PRINCIPAL", "ACCOUNTANT", "TEACHER", "CLERK"] },
  { href: "/students", label: "Students", roles: ["ADMIN", "PRINCIPAL", "ACCOUNTANT", "TEACHER", "CLERK"] },
  { href: "/fees", label: "Fees", roles: ["ADMIN", "PRINCIPAL", "ACCOUNTANT"] },
  { href: "/fees/defaulters", label: "Defaulters", roles: ["ADMIN", "PRINCIPAL", "ACCOUNTANT"] },
  { href: "/attendance", label: "Attendance", roles: ["ADMIN", "PRINCIPAL", "TEACHER"] },
  { href: "/attendance/register", label: "Register", roles: ["ADMIN", "PRINCIPAL", "TEACHER"] },
  { href: "/exams", label: "Exams", roles: ["ADMIN", "PRINCIPAL", "TEACHER"] },
  { href: "/messages", label: "Messages", roles: ["ADMIN", "PRINCIPAL", "ACCOUNTANT"] },
  { href: "/settings", label: "Settings", roles: ["ADMIN"] },
];

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await optionalSession();

  // Signed out (the login page) renders bare, with no chrome.
  if (!session) {
    return (
      <html lang="en">
        <body className="min-h-screen bg-[var(--color-surface)]">
          {children}
        </body>
      </html>
    );
  }

  const [school, year] = await Promise.all([
    db.school.findUnique({
      where: { id: session.schoolId },
      select: { name: true, city: true },
    }),
    db.academicYear.findFirst({
      where: { schoolId: session.schoolId, isCurrent: true },
      select: { name: true, lockedAt: true },
    }),
  ]);

  const items = nav.filter((n) => n.roles.includes(session.role));

  // The cookie is signed and valid but points at a school that is no
  // longer there — almost always `npm run db:reset` with a browser
  // session still open. Without this the app 500s on the first write
  // with a foreign key error instead of saying "sign in again".
  //
  // The cookie is NOT cleared here: a layout cannot write cookies in
  // Next, only a server action or route handler can. /login checks
  // the same thing so the two do not bounce off each other.
  if (!school) redirect("/login");

  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="flex min-h-screen">
          <nav className="no-print flex w-52 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)]">
            <div className="border-b border-[var(--color-line)] px-4 py-4">
              <div className="text-sm font-semibold leading-tight tracking-tight">
                {school?.name ?? "School"}
              </div>
              {school?.city && (
                <div className="mt-0.5 text-xs text-[var(--color-faint)]">
                  {school.city}
                </div>
              )}
            </div>

            <ul className="flex-1 space-y-0.5 p-3">
              {items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="block rounded-md px-2.5 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-panel)] hover:text-[var(--color-ink)]"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>

            <div className="border-t border-[var(--color-line)] px-4 py-3">
              <div className="text-sm font-medium leading-tight">
                {session.name}
              </div>
              <div className="text-xs text-[var(--color-faint)]">
                {session.role.toLowerCase()}
              </div>

              <form action={signOut}>
                <button className="mt-2 text-xs text-[var(--color-muted)] underline underline-offset-2 hover:text-[var(--color-ink)]">
                  Sign out
                </button>
              </form>
            </div>
          </nav>

          <div className="min-w-0 flex-1">
            <header className="no-print flex items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-panel)] px-6 py-2.5 text-xs">
              <span className="text-[var(--color-muted)]">
                Academic year {year?.name ?? "not set"}
              </span>

              {year?.lockedAt && (
                <span className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-[var(--color-warn)]">
                  locked — read only
                </span>
              )}
            </header>

            <main className="p-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
