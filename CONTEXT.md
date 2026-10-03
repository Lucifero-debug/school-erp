# CONTEXT.md — read this first

Complete context for **school-erp**, written for an AI assistant
(ChatGPT, Gemini, Claude, Cursor) that has never seen this codebase, so
the work can continue without the original conversation.

Read the whole file before editing anything. It contains scope
boundaries and decisions that are deliberate. Reversing one by accident
can make a year of fee records unexplainable, or lose a child's academic
history.

Copy to `AGENTS.md` or `.cursorrules` if your tool expects that name.

---

## 1. What this is

A school and college ERP for small and mid-size Indian private
institutions — roughly 200 to 2,000 students, one campus.

**Fees first.** That is what schools buy. The budget comes out of fee
collection, the pain is chasing defaulters, and everything else is a
reason to keep the software open during the day.

What schools pay for, in order:

1. **Fee collection and defaulter lists.** Money in, visible, provable.
2. **Report cards** that print correctly for their board.
3. **Attendance**, because boards require a minimum to sit exams.
4. **Parent messaging**, which cuts both defaulters and phone calls.

What they do not pay for: dashboards, analytics, "insights".

Market note: unusually fragmented in India — many small regional
vendors, no national winner, low switching costs. Easy to enter, easy
to be left.

---

## 2. Current state

**v1 is feature-complete. Never deployed. No school has used it.**

Everything in §3 (scope) that is in-scope is built and works locally
against a seeded database.

### Working flows

- Sign in with throttling (8 failures / 15 min on phone and IP), sign
  out, change own password, admin resets another's
- Overview: collected today, outstanding, recent receipts
- Students: search, filter by section, admit one at a time, **bulk CSV
  import with dry-run**, edit, move section, full record
- **Fees**: fee heads, per-class structures, billing calendar, raise
  demands (idempotent), collect with oldest-first allocation, printable
  A5 receipt with amount in words, cancel receipt, mark cheque bounced,
  late fees, defaulter list with ageing and guardian phones
- Attendance: mark a section in one submit, monthly register, holidays,
  below-75% shortage list
- Exams: create with papers per class and subject, scholastic mark
  entry, **co-scholastic grade entry**, publish gate, report card index
  per section, printable report card
- **Transfer certificates**: numbered, dues-gated with recorded
  override, marks the student as left
- **Promotion**: per class into next year, with detention ticks,
  outstanding fees and attendance shown before committing; passed-out
  for the highest class
- Messaging: fee reminders and absence alerts over WhatsApp Cloud API,
  consent-gated, deduplicated per day, logged
- Settings: school, classes, sections, class teachers, subjects, staff,
  academic years (create / switch / lock), fee setup
- Export: students, fee demands, receipts, attendance, marks as CSV;
  full JSON backup
- Audit log on every student view and every money movement

### File map

```
prisma/schema.prisma      data model, heavily commented
prisma/seed.ts            demo school: 50 students, 2 quarters, receipts

lib/db.ts                 Prisma singleton
lib/auth.ts               scrypt passwords, HMAC-signed session cookie
lib/session.ts            auth gate, roles, current academic year
lib/result.ts             ActionState + validators
lib/format.ts             IST dates, Indian rupee grouping
lib/audit.ts              audit() helper
lib/fees.ts               THE FEE ENGINE — read before touching money
lib/numbering.ts          gapless receipt / admission / TC numbers
lib/whatsapp.ts           Cloud API template send

lib/actions/auth.ts       sign in, passwords
lib/actions/students.ts   admit, update, guardians, section change
lib/actions/import.ts     CSV parse, dry run, bulk import
lib/actions/leaving.ts    transfer certificates, promotion, passed out
lib/actions/fees.ts       raise, collect, cancel, bounce, concessions
lib/actions/attendance.ts mark, holidays
lib/actions/exams.ts      marks, grades, publish, create exam
lib/actions/messaging.ts  reminders, absence alerts
lib/actions/settings.ts   school setup, years, staff

app/ui.tsx                shared classNames + Panel / PageHeader / Stat
app/form.tsx              Form / Submit / ConfirmSubmit
app/print-button.tsx      window.print()
app/error.tsx             page error boundary
app/export/route.ts       CSV + JSON downloads
```

Screens live under `app/` by feature: `students/` (with `import/`,
`promote/`, `[id]/tc/`, `[id]/edit/`), `fees/`, `attendance/`,
`exams/` (with `[examId]/grades/`, `/cards/`, `/report/`), `messages/`,
`settings/`.

### Stack

Next.js 15 (App Router, server components, server actions) ·
TypeScript · PostgreSQL · Prisma · Tailwind v4.

No auth library, no validation library, no UI library, no date library.
Three client components in the whole app: the print button, the form
wrapper, and the import form (it needs the dry-run round trip). The
constraint is an old office desktop on patchy broadband. If you add a
dependency, say why it earns its weight.

### Running it

```
npm install
copy .env.example .env     # DATABASE_URL + SESSION_SECRET
npx prisma generate
npm run db:push
npm run db:seed
npm run dev
```

Demo logins, all password `school123`: 9810000001 admin, 9810000002
accountant, 9810000003 teacher (VI-A), 9810000005 clerk.

---

## 3. Scope — what is OUT

Do not build these without an explicit decision. Each has sunk a school
ERP before.

- Transport, bus routes, GPS
- Hostel and mess
- Library
- Payroll and HR (staff exist only to log in and teach)
- LMS: online classes, assignments, content
- Biometric / RFID attendance hardware
- Inventory: uniforms, books
- **Period-wise attendance** — day-wise only. Colleges want this and it
  is the most likely thing to get promoted into scope. Do it properly
  or not at all
- **Payment gateway** — record the reference from whatever gateway the
  school already uses; do not become a payments company
- Parent mobile app
- Multi-branch / trust-level consolidation

---

## 4. The four decisions everything rests on

### 4.1 Enrollment is per academic year

Class and section live on `Enrollment`, **never** on `Student`.
Students move up every year, and last year's attendance, marks and fees
must stay attached to last year's class.

Putting `classId` on `Student` is the most common mistake in school
software and it is unrecoverable once there is history. If you want it
"just for the list page", join through `Enrollment` filtered by the
current year instead.

A mid-year section change is an UPDATE to the one enrollment row.
Promotion CREATES next year's row and marks the old one PROMOTED.

### 4.2 Fees are demands and allocations, never a balance

```
FeeStructure  (class VIII owes tuition 2000/month)
     ↓  generateDemands()
FeeDemand     (THIS student owes 6000 for Q1, after concession)
     ↓  collectFee()
Receipt + ReceiptAllocation  (this 4000 settled that demand)
```

Outstanding is **always computed**: `sum(net + lateFee) − sum(paid)`.

There is no balance column on `Student` and you must not add one. It
drifts the first time someone cancels a receipt, and then nobody can
explain the number to a parent at the counter.

### 4.3 Numbers are sequential and gapless

Receipts, admission numbers, TCs. Generated inside a transaction in
`lib/numbering.ts`. A cancelled receipt **keeps its number** — the row
stays, marked cancelled. A hole in the sequence is an audit question.

### 4.4 Multi-tenant, nothing hard deleted

Every table carries `schoolId`; every query filters by it. Ids from
URLs and forms are re-checked against the session. Use
`findFirst`/`updateMany` with a `schoolId` filter rather than
`findUnique`/`update` by id alone — the latter has nowhere to put the
filter.

`deletedAt` everywhere. Receipts cancelled, demands waived, marks
amended.

---

## 5. Things that look like bugs but are not

- **Absent is not zero.** `Mark.absent` is separate from
  `Mark.obtained`. Blank means not entered. Exported as "ABSENT".
- **Concession reasons and fee head names are snapshotted onto demand
  lines.** Renaming a head or changing a concession must not rewrite
  bills already raised.
- **A one-time head is billed only in installment 1.**
- **An annual head billed quarterly is charged once, not split.** See
  §7 — this is the open question.
- **Overpayment is refused, not held.** No advance balance in v1.
- **Payments allocate oldest demand first.**
- **Money is computed in paise as integers.** Floating-point rupees
  lose money on percentage concessions.
- **Late counts as present (weight 1) for attendance.** Punctuality is
  a separate conversation from exam eligibility.
- **Approved leave counts as absent for the 75% figure.**
- **A cheque bounce is not a cancellation.** The receipt stays,
  flagged; the fees reopen.
- **Switching the academic year does not promote students.** Promotion
  is its own screen and its own decision.
- **Import is all-or-nothing** and forces a dry run first. A partial
  import leaves a school unable to tell what went in.
- **Import reads dates day-first** (14/03/2012 is 14 March) and rejects
  anything else rather than guessing.
- **Publishing only blocks on missing scholastic marks**, so a school
  that hasn't graded art can still release results.
- **`db push`, not `migrate`.** No `prisma/migrations` folder exists.
  Do NOT run `prisma migrate reset` — it drops everything and applies
  nothing. Use `npm run db:reset`.
- **A stale session cookie after `db:reset` sends you to /login, not
  to an error.** The cookie is signed and valid but points at a
  school id that no longer exists, and the first write fails with a
  foreign key error. The root layout checks the school exists and
  redirects; `/login` checks the same thing before bouncing back,
  otherwise the two ping-pong forever. **A layout cannot clear the
  cookie** — Next only allows cookie writes in a server action or
  route handler — so signing in again is what replaces it.

---

## 6. Roles

| Role | Can do |
|---|---|
| ADMIN | everything |
| PRINCIPAL | everything except school settings and staff |
| ACCOUNTANT | fees and money; sees students, cannot edit marks |
| TEACHER | own sections only: attendance and marks. **No money.** |
| CLERK | admissions and records. No money, no marks. |

The two separations schools care about: **a teacher must never see the
fee ledger**, and **a clerk must never collect money**.

Enforced in `requireRole()` inside each page and action, not by hiding
nav items. `assertCanTouchSection()` stops a teacher posting marks or
attendance for a section that is not theirs by editing a form id.

---

## 7. India-specific requirements

Verify with a professional before going live. General knowledge, not
legal advice.

- **DPDP Act 2023 — children's data.** Processing a child's personal
  data requires **verifiable consent from a parent or lawful
  guardian**, and the Act additionally prohibits tracking, behavioural
  monitoring and targeted advertising directed at children. Nearly
  every record here is a child's. `Guardian.consentGivenAt` and
  `consentMethod` exist for this; admission and import both refuse
  without the tick. Treat it as a design constraint: no analytics SDKs,
  no third-party trackers, no engagement scoring on children.
- **Academic year is April to March**, matching the financial year.
- **UDISE+ code** identifies every recognised school.
- **Transfer Certificate** is legally required when a student leaves.
- **Minimum attendance** (commonly 75%) is a board requirement to sit
  exams. Holidays are excluded from the denominator.
- **Fees are GST-exempt** for recognised educational institutions. No
  tax field on fees, deliberately. Confirm with a CA, especially if the
  school sells uniforms or books.
- **RTE 25% quota** students have fees reimbursed by the state.
- **Report card formats differ by board.** `GRADE_BANDS` in
  `app/exams/[examId]/report/[enrollmentId]/page.tsx` is the CBSE-style
  scale; change it there and nowhere else.

### The open question that matters most

**Does the school split an annual charge across installments, or bill
it once in Quarter 1?** This code bills it once, in installment 1. If a
real school splits it, every bill is wrong by a large amount. There are
probably four or five more decisions like this buried in the fee
engine. They can only be settled by asking.

---

## 8. WHAT IS REMAINING

Ordered. Nothing below is blocked by anything above it except where
stated.

### A. Not code — do this first

**A1. Two hours at a real school's fee counter during collection
week.** Watch what the clerk does. Bring the annual-charge question
from §7 and these: how do they handle a parent paying for two siblings
at once; what happens when someone pays in advance; do they charge late
fees in practice or just threaten to; what does their current receipt
look like. Expect three things in the schema to be wrong.

**A2. Demo to three or four schools.** Free, no promises, no dates.
Write down every "but we do it differently". That list should replace
the guesses in this file.

**A3. Get a CA to confirm GST treatment**, especially if the school
sells uniforms, books or runs transport.

**A4. Get a lawyer to review DPDP obligations.** You would be a data
processor handling children's data on a school's behalf, which carries
duties beyond the school's own.

**A5. Write a one-page agreement** covering who owns the data, what
uptime is promised (probably nothing), and what happens on exit.

### B. Deployment — before any school touches it

**B1. Database.** Neon or Supabase. Use the **direct** connection
string for Prisma, not the pooled one. **Turn on point-in-time
recovery** — this is the backup and it is not optional for a school's
only copy of its records.

**B2. Vercel.** Set `DATABASE_URL` and `SESSION_SECRET` in project
environment variables. `npm run build` already runs `prisma generate`.

**B3. Schema to production.** Run `npx prisma db push` once by hand.
**Then switch to migrations** — `prisma migrate dev` — before a school
has live data, because `db push` can silently drop columns.

**B4. Delete the demo school and the seeded passwords.** Create the
real school and its admin by hand. `school123` is in the README.

**B5. Error reporting.** Sentry or similar. Right now errors go to the
Vercel log and nowhere anyone looks.

**B6. Uptime monitoring.** Anything that emails you when it is down.

### C. Operational gaps

**C1. Prune `LoginAttempt`.** It grows forever. A scheduled function
deleting rows older than a day.

**C2. Scheduled fee reminders.** Messaging is a button; it should be a
Vercel cron running the evening before a due date and again a week
after. The action already exists — `sendFeeReminders()` — it just needs
a scheduled route and a secret header check.

**C3. WhatsApp templates approved by Meta.** Until then messaging is
inert. Two templates: fee reminder with `{{1}}` student name and
`{{2}}` amount; absence alert with `{{1}}` name and `{{2}}` date.

**C4. Backup download on a schedule.** `/export?type=full` by hand is
fine for now, but a weekly copy somewhere the school also controls is
what protects them if your account is the thing that fails.

### D. Features a school will ask for

Roughly in the order they will come up.

**D1. Print a whole class of report cards in one go.** Currently one at
a time. A print stylesheet with `page-break-after` on each card and a
route that renders a section's worth.

**D2. Fee structure overrides per student.** For cases a concession
cannot express — a transport slab by distance, a different tuition for
a mid-year joiner. Add a `StudentFeeOverride` table keyed on
(student, feeHead) and consult it in `generateDemands()` before the
structure.

**D3. Advance payments.** Currently refused. The honest fix is a credit
balance as a negative demand, or an `Advance` table allocated against
future demands. Do not bolt it on as a column.

**D4. Sibling linkage.** Paying for two children in one receipt, and
automatic sibling concession. Needs a `Family` or
`guardian → many students` relation; today a shared phone is the only
hint.

**D5. Bulk marks import.** Teachers have the marks in a spreadsheet.
Same dry-run pattern as the student import.

**D6. Exam weighting into a final result.** `Exam.weightPercent`
exists and is unused. A final report card combining terms by weight.

**D7. Guardian mobile view.** Not an app — a read-only page per student
behind a one-time link, showing fees due and attendance. Cheap, and it
cuts the phone calls schools complain about.

**D8. UDISE+ export.** The government return every recognised school
files. Ask a school for the current format; it changes.

### E. Tests, in value order

There are none. The highest-value ones:

**E1. Fee demand generation.** Frequencies and concessions —
`occurrencesInInstallment()` and `concessionFor()` in `lib/fees.ts`.
Pure functions, trivial to test, and the place a bug costs real money.

**E2. Receipt number sequencing under concurrency.** Two collections at
the same instant must not produce the same number.

**E3. Tenancy isolation.** School A cannot read or write school B.
Worth a test per action.

**E4. Attendance percentage with holidays.** The number that decides
exam eligibility.

**E5. CSV import parsing.** Date formats, quoted fields, missing
columns.

### F. Known rough edges

- Import holds the whole file in memory and runs inside one
  transaction with a 2-minute timeout. Fine for 500 students, not for
  5,000.
- `promotionPreview()` runs a query per student for the
  already-enrolled check. Fine at this scale, visibly slow at 2,000.
- No pagination anywhere. Student list caps at 300 rows.
- The report card grade scale is hardcoded to one board.
- No way to delete a class or subject, only to stop using it.
- Audit log grows forever. Fine for years at this scale; plan an
  archive eventually.

---

## 9. Who is building this

Solo developer in Delhi, final-year AI student, working a full-time job
at an AI ad studio. Builds evenings and weekends. Strong with Next.js,
TypeScript and LLM work. No prior experience of school administration.

**Important for any assistant working on this:** there are several
other half-finished projects — a clinic management system, a WhatsApp
enquiry agent, a WhatsApp-to-Tally tool, a salon automation MVP, a
billing app. None has a paying user yet. The constraint here is not
technical ability. It is time, and the habit of starting new builds
instead of finding customers.

So: when asked what to do next, prefer §8A over §8D. The product is
further along than the business by a wide margin, and another feature
is almost never the right answer. A school ERP is a bad product to
guess at — the fee rules alone vary enough between two schools in the
same city that one afternoon at a real fee counter beats any amount of
reasoning from outside.

---

## 10. Prompt for a fresh AI session

> I'm working on school-erp, a school and college ERP for small Indian
> institutions. Read the attached CONTEXT.md in full before suggesting
> anything. It has deliberate scope boundaries (§3), four architectural
> decisions that must not be reversed (§4), a list of things that look
> like bugs but are not (§5), and an ordered list of what remains (§8).
> Tell me what you think the next step is and why, before writing any
> code.

Attach `CONTEXT.md`, `prisma/schema.prisma`, and:

- anything touching money → `lib/fees.ts`, `lib/numbering.ts`,
  `lib/actions/fees.ts`
- anything touching writes → `lib/session.ts` (tenancy and roles)
- a screen → that page plus `app/ui.tsx` and `app/form.tsx`
- import or promotion → `lib/actions/import.ts`,
  `lib/actions/leaving.ts`
