import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-lg font-semibold tracking-tight">Not found</h1>

      <p className="mt-2 text-sm text-[var(--color-muted)]">
        That record does not exist, or it belongs to another school.
      </p>

      <Link
        href="/"
        className="mt-6 inline-block rounded-md bg-[var(--color-accent)] px-3.5 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-ink)]"
      >
        Back to overview
      </Link>
    </div>
  );
}
