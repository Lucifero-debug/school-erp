# school-erp

School and college ERP for small Indian private institutions —
roughly 200 to 2,000 students, one campus.

Students, **fee collection**, attendance, exams and report cards,
parent messaging. Fees first, because that is what schools buy.

**Read `CONTEXT.md` before working on this.** §4 has the four
architectural decisions that must not be reversed, §5 lists things that
look like bugs but are not, and **§8 is everything that remains**.

## Setup

```
npm install
copy .env.example .env
```

Fill in `.env`:

- `DATABASE_URL` — free Postgres from neon.tech or supabase.com. Use
  the **direct** connection string, not the pooled one.
- `SESSION_SECRET` — generate with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Then:

```
npx prisma generate
npm run db:push
npm run db:seed
npm run dev
```

Demo logins, all password `school123`:

| Phone | Who | Role |
|---|---|---|
| 9810000001 | Sunita Rao | admin |
| 9810000002 | Ramesh Kulkarni | accountant |
| 9810000003 | Priya Menon | teacher (VI-A) |
| 9810000005 | Kavita Joshi | clerk |

**Delete these before any real deployment.**

## Demo in this order

1. Sign in as the **accountant**. Fees → search a name → see what is
   owed, broken down by head with the concession and its reason.
2. Collect the full amount. The A5 receipt prints with the amount in
   words and which installments it settled.
3. **Defaulters** — grouped per student, sorted by amount, with
   guardian phone numbers and days overdue. Printable.
4. Sign in as the **teacher**. Fees has vanished from the nav and
   Students shows only VI-A. That separation is enforced in the
   actions, not by hiding buttons.
5. Sign in as the **admin**. Students → Import, paste a few CSV rows,
   press Check — it reports row by row before anything is saved.
6. Students → Promote. Every student with their dues and attendance,
   detention ticks, into next year.

## What works

Students (search, admit, **bulk CSV import**, edit, move section,
**transfer certificates**, **promotion with detention**) · Fees (heads,
structures, installments, raise demands, collect, receipt, cancel,
cheque bounce, late fees, defaulters) · Attendance (mark, monthly
register, holidays, shortage list) · Exams (marks, **co-scholastic
grades**, publish gate, report cards) · Messaging (fee reminders,
absence alerts, consent-gated) · Settings · Export (CSV + JSON backup)
· Audit log · Five roles.

## What remains

See `CONTEXT.md` §8. Short version:

- **Not code, and first**: two hours at a real fee counter, demos to
  three schools, a CA on GST, a lawyer on DPDP.
- **Deployment**: Neon with point-in-time recovery, Vercel, switch from
  `db push` to migrations, delete the demo data, error reporting.
- **Operational**: scheduled reminders, Meta template approval, prune
  login attempts.
- **Features schools will ask for**: bulk report card printing,
  per-student fee overrides, advance payments, sibling linkage.
- **Tests**: none exist. Fee generation and receipt numbering first.

## Non-negotiables

1. Class and section live on `Enrollment`, never on `Student`.
2. Outstanding is computed from demands and allocations. No balance
   column, ever.
3. Receipt numbers are sequential and gapless, generated in a
   transaction. A cancelled receipt keeps its number.
4. Every query filters by `schoolId`. Ids from forms are re-checked.
5. Nothing is hard deleted.
6. A child's record needs recorded guardian consent (DPDP Act 2023).

## Stack

Next.js 15 (App Router, server components) · TypeScript · PostgreSQL ·
Prisma · Tailwind v4. Three client components in the whole app.
