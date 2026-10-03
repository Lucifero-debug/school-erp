// lib/numbering.ts
//
// Sequential, gapless document numbers: receipts, admission numbers,
// transfer certificates.
//
// Gapless matters. An auditor or a board inspector asking "where is
// receipt 00231?" is a bad conversation, and "the software skipped it"
// is not an answer anyone accepts. So:
//
//   - the count and the insert happen in ONE transaction
//   - a cancelled document KEEPS its number; the row stays, marked
//     cancelled, rather than leaving a hole
//
// Never generate a number outside a transaction, and never reuse one.

import { Prisma } from "@prisma/client";

// Indian academic and financial years both run April to March.
export function academicYearName(d = new Date()): string {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function pad(n: number, width = 5): string {
  return String(n).padStart(width, "0");
}

// Receipt: RCPT/2026-27/00042
export async function nextReceiptNumber(
  tx: Prisma.TransactionClient,
  academicYearId: string,
  yearName: string
): Promise<string> {
  const prefix = `RCPT/${yearName}/`;

  const used = await tx.receipt.count({
    where: { academicYearId, number: { startsWith: prefix } },
  });

  return `${prefix}${pad(used + 1)}`;
}

// Admission number: 2026/0231
//
// Permanent and never reused, even if the student leaves the next day.
// Some schools prefer a plain running number with no year — change the
// shape here and nowhere else.
export async function nextAdmissionNumber(
  tx: Prisma.TransactionClient,
  schoolId: string,
  yearName: string
): Promise<string> {
  const prefix = `${yearName.slice(0, 4)}/`;

  const used = await tx.student.count({
    where: { schoolId, admissionNo: { startsWith: prefix } },
  });

  return `${prefix}${pad(used + 1, 4)}`;
}

// Transfer certificate: TC/2026-27/0007
export async function nextTcNumber(
  tx: Prisma.TransactionClient,
  schoolId: string,
  yearName: string
): Promise<string> {
  const prefix = `TC/${yearName}/`;

  const used = await tx.transferCertificate.count({
    where: { student: { schoolId }, number: { startsWith: prefix } },
  });

  return `${prefix}${pad(used + 1, 4)}`;
}
