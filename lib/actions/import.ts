// lib/actions/import.ts
//
// Bulk student import from a CSV.
//
// This is the first thing that happens after a school says yes. They
// have a spreadsheet with 400 children in it and nobody is typing that
// in by hand.
//
// Two rules that make this survivable:
//
//   1. DRY RUN FIRST. Nothing is written until the school has seen a
//      row-by-row report of what will happen. An import that half
//      works and half fails on row 287 is worse than one that refuses.
//
//   2. ALL OR NOTHING. The real import runs in one transaction. A
//      partial import leaves a school unable to tell what went in.

"use server";

import { revalidatePath } from "next/cache";
import { db } from "../db";
import { requireRole, currentAcademicYear, CAN_EDIT_STUDENTS } from "../session";
import { audit } from "../audit";
import { fail, done, type ActionState } from "../result";

export type ImportRow = {
  line: number;
  admissionNo: string | null;
  firstName: string;
  lastName: string | null;
  klass: string;
  section: string;
  rollNo: number | null;
  dob: Date | null;
  gender: "MALE" | "FEMALE" | "OTHER" | null;
  category: string | null;
  address: string | null;
  guardianName: string;
  guardianRelation: "FATHER" | "MOTHER" | "GUARDIAN";
  guardianPhone: string;
  messagingConsent: boolean;
};

export type RowResult =
  | { line: number; ok: true; row: ImportRow; note?: string }
  | { line: number; ok: false; raw: string; error: string };

// ---------------------------------------------------------------
// Parsing
//
// Handwritten rather than using a CSV library, because the quoting
// rules are simple and one fewer dependency matters here.
// ---------------------------------------------------------------

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }

  out.push(cur.trim());
  return out;
}

// Schools write dates every possible way. Accept the common ones and
// reject anything ambiguous rather than guessing — a wrong date of
// birth follows a child for years.
function parseDate(raw: string): Date | null | "invalid" {
  const s = raw.trim();
  if (!s) return null;

  // dd/mm/yyyy or dd-mm-yyyy. Day first, which is the Indian
  // convention — NOT the American month-first reading.
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);

  if (dmy) {
    const [, d, m, y] = dmy;
    const day = Number(d);
    const month = Number(m);

    if (month < 1 || month > 12 || day < 1 || day > 31) return "invalid";

    const date = new Date(Number(y), month - 1, day);
    return Number.isNaN(date.getTime()) ? "invalid" : date;
  }

  // yyyy-mm-dd
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (iso) {
    const date = new Date(s);
    return Number.isNaN(date.getTime()) ? "invalid" : date;
  }

  return "invalid";
}

export const IMPORT_HEADERS = [
  "admission_no",
  "first_name",
  "last_name",
  "class",
  "section",
  "roll_no",
  "dob",
  "gender",
  "category",
  "address",
  "guardian_name",
  "guardian_relation",
  "guardian_phone",
  "messaging_consent",
];

export function parseCsv(text: string): RowResult[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0]).map((h) =>
    h.toLowerCase().replace(/\s+/g, "_")
  );

  const col = (name: string) => header.indexOf(name);

  const idx = {
    admissionNo: col("admission_no"),
    firstName: col("first_name"),
    lastName: col("last_name"),
    klass: col("class"),
    section: col("section"),
    rollNo: col("roll_no"),
    dob: col("dob"),
    gender: col("gender"),
    category: col("category"),
    address: col("address"),
    guardianName: col("guardian_name"),
    guardianRelation: col("guardian_relation"),
    guardianPhone: col("guardian_phone"),
    messagingConsent: col("messaging_consent"),
  };

  const results: RowResult[] = [];

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const cells = splitCsvLine(raw);
    const line = i + 1;

    const get = (n: number) => (n >= 0 ? (cells[n] ?? "").trim() : "");

    const firstName = get(idx.firstName);
    const klass = get(idx.klass);
    const section = get(idx.section) || "A";
    const guardianName = get(idx.guardianName);
    const guardianPhone = get(idx.guardianPhone);

    if (!firstName) {
      results.push({ line, ok: false, raw, error: "No first name" });
      continue;
    }

    if (!klass) {
      results.push({ line, ok: false, raw, error: "No class" });
      continue;
    }

    if (!guardianName) {
      results.push({ line, ok: false, raw, error: "No guardian name" });
      continue;
    }

    const digits = guardianPhone.replace(/\D/g, "");

    if (digits.length < 10) {
      results.push({
        line,
        ok: false,
        raw,
        error: `Guardian phone "${guardianPhone}" has fewer than 10 digits`,
      });
      continue;
    }

    const dob = parseDate(get(idx.dob));

    if (dob === "invalid") {
      results.push({
        line,
        ok: false,
        raw,
        error: `Date of birth "${get(idx.dob)}" is not dd/mm/yyyy or yyyy-mm-dd`,
      });
      continue;
    }

    const genderRaw = get(idx.gender).toUpperCase();
    const gender =
      genderRaw.startsWith("M")
        ? "MALE"
        : genderRaw.startsWith("F")
          ? "FEMALE"
          : genderRaw
            ? "OTHER"
            : null;

    const relRaw = get(idx.guardianRelation).toUpperCase();
    const relation =
      relRaw.startsWith("M")
        ? "MOTHER"
        : relRaw.startsWith("G")
          ? "GUARDIAN"
          : "FATHER";

    const rollRaw = get(idx.rollNo);
    const rollNo = rollRaw ? Number(rollRaw) : null;

    const consentRaw = get(idx.messagingConsent).toLowerCase();

    results.push({
      line,
      ok: true,
      row: {
        line,
        admissionNo: get(idx.admissionNo) || null,
        firstName,
        lastName: get(idx.lastName) || null,
        klass,
        section,
        rollNo: rollNo && Number.isFinite(rollNo) ? rollNo : null,
        dob: dob ?? null,
        gender,
        category: get(idx.category) || null,
        address: get(idx.address) || null,
        guardianName,
        guardianRelation: relation,
        guardianPhone,
        messagingConsent: ["yes", "y", "true", "1"].includes(consentRaw),
      },
    });
  }

  return results;
}

// ---------------------------------------------------------------
// Dry run — what WOULD happen
// ---------------------------------------------------------------

export type DryRun = {
  total: number;
  willCreate: number;
  problems: { line: number; error: string }[];
  missingSections: string[];
  duplicateAdmissionNos: string[];
  sample: { line: number; name: string; klass: string; guardian: string }[];
};

export async function dryRunImport(csvText: string): Promise<DryRun> {
  const session = await requireRole(CAN_EDIT_STUDENTS);
  const year = await currentAcademicYear();

  const parsed = parseCsv(csvText);

  const sections = await db.section.findMany({
    where: { klass: { schoolId: session.schoolId, deletedAt: null } },
    include: { klass: true },
  });

  const key = (k: string, s: string) =>
    `${k.trim().toUpperCase()}|${s.trim().toUpperCase()}`;

  const sectionMap = new Map(
    sections.map((s) => [key(s.klass.name, s.name), s.id])
  );

  const existing = await db.student.findMany({
    where: { schoolId: session.schoolId, deletedAt: null },
    select: { admissionNo: true },
  });

  const takenAdmissionNos = new Set(existing.map((e) => e.admissionNo));

  const problems: { line: number; error: string }[] = [];
  const missingSections = new Set<string>();
  const duplicates: string[] = [];
  const seenInFile = new Set<string>();

  let willCreate = 0;

  const sample: DryRun["sample"] = [];

  for (const r of parsed) {
    if (!r.ok) {
      problems.push({ line: r.line, error: r.error });
      continue;
    }

    const sectionKey = key(r.row.klass, r.row.section);

    if (!sectionMap.has(sectionKey)) {
      missingSections.add(`${r.row.klass}-${r.row.section}`);
      problems.push({
        line: r.line,
        error: `Class ${r.row.klass}-${r.row.section} does not exist`,
      });
      continue;
    }

    if (r.row.admissionNo) {
      if (takenAdmissionNos.has(r.row.admissionNo)) {
        duplicates.push(r.row.admissionNo);
        problems.push({
          line: r.line,
          error: `Admission number ${r.row.admissionNo} already exists`,
        });
        continue;
      }

      if (seenInFile.has(r.row.admissionNo)) {
        duplicates.push(r.row.admissionNo);
        problems.push({
          line: r.line,
          error: `Admission number ${r.row.admissionNo} appears twice in this file`,
        });
        continue;
      }

      seenInFile.add(r.row.admissionNo);
    }

    willCreate++;

    if (sample.length < 5) {
      sample.push({
        line: r.line,
        name: `${r.row.firstName} ${r.row.lastName ?? ""}`.trim(),
        klass: `${r.row.klass}-${r.row.section}`,
        guardian: `${r.row.guardianName} ${r.row.guardianPhone}`,
      });
    }
  }

  void year;

  return {
    total: parsed.length,
    willCreate,
    problems,
    missingSections: [...missingSections],
    duplicateAdmissionNos: [...new Set(duplicates)],
    sample,
  };
}

// ---------------------------------------------------------------
// The real import
// ---------------------------------------------------------------

export async function runImport(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(CAN_EDIT_STUDENTS);
  const year = await currentAcademicYear();

  if (year.lockedAt) return fail("This academic year is locked.");

  const csvText = String(formData.get("csv") ?? "");
  if (!csvText.trim()) return fail("Paste the CSV first.");

  // DPDP: these are children. The person importing confirms the school
  // holds guardian consent for all of them. See CONTEXT.md §7.
  if (formData.get("consent") !== "on") {
    return fail(
      "Confirm that the school holds guardian consent for these children before importing."
    );
  }

  const parsed = parseCsv(csvText);
  const good = parsed.filter((r): r is Extract<RowResult, { ok: true }> => r.ok);

  if (good.length === 0) return fail("No usable rows in that file.");

  const sections = await db.section.findMany({
    where: { klass: { schoolId: session.schoolId, deletedAt: null } },
    include: { klass: true },
  });

  const key = (k: string, s: string) =>
    `${k.trim().toUpperCase()}|${s.trim().toUpperCase()}`;

  const sectionMap = new Map(
    sections.map((s) => [key(s.klass.name, s.name), s.id])
  );

  // Refuse the whole file if any row would fail. A partial import
  // leaves a school unable to tell what went in.
  const unresolved = good.filter(
    (r) => !sectionMap.has(key(r.row.klass, r.row.section))
  );

  if (unresolved.length > 0 || parsed.length !== good.length) {
    return fail(
      "Some rows have problems. Run the check first and fix the file — nothing is imported until every row is clean."
    );
  }

  const yearPrefix = year.name.slice(0, 4);

  let created = 0;

  await db.$transaction(
    async (tx) => {
      // Admission numbers: use the file's where given, generate the
      // rest. Generated inside the transaction so two imports cannot
      // collide.
      let seq = await tx.student.count({
        where: {
          schoolId: session.schoolId,
          admissionNo: { startsWith: `${yearPrefix}/` },
        },
      });

      for (const r of good) {
        const sectionId = sectionMap.get(key(r.row.klass, r.row.section))!;

        let admissionNo = r.row.admissionNo;

        if (!admissionNo) {
          seq++;
          admissionNo = `${yearPrefix}/${String(seq).padStart(4, "0")}`;
        }

        const student = await tx.student.create({
          data: {
            schoolId: session.schoolId,
            admissionNo,
            firstName: r.row.firstName,
            lastName: r.row.lastName,
            dob: r.row.dob,
            gender: r.row.gender,
            category: r.row.category,
            address: r.row.address,
            admittedOn: new Date(),
            guardians: {
              create: [
                {
                  relation: r.row.guardianRelation,
                  name: r.row.guardianName,
                  phone: r.row.guardianPhone,
                  isPrimary: true,
                  consentGivenAt: new Date(),
                  consentMethod: "bulk import — school confirmed",
                  messagingConsent: r.row.messagingConsent,
                },
              ],
            },
          },
        });

        await tx.enrollment.create({
          data: {
            studentId: student.id,
            academicYearId: year.id,
            sectionId,
            rollNo: r.row.rollNo,
          },
        });

        created++;
      }
    },
    // 400 students with a guardian and an enrollment each is a lot of
    // round trips. The default 5s timeout is not enough.
    { timeout: 120_000, maxWait: 10_000 }
  );

  await audit({
    action: "students.bulk_import",
    entityType: "School",
    entityId: session.schoolId,
    after: { created },
  });

  revalidatePath("/students");

  return done(`${created} students imported and enrolled in ${year.name}.`);
}
