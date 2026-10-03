// lib/fees.ts
//
// The fee engine. This is the part of a school ERP that has to be right,
// because every rupee a parent disputes comes back to these functions.
//
// The flow:
//
//   FeeStructure (class VIII owes tuition 2000/month, exam 500/quarter)
//        |
//        |  generateDemands(year, installment)
//        v
//   FeeDemand per student per installment, with concessions applied
//   and recorded on each line
//        |
//        |  allocate(receipt, demands)
//        v
//   ReceiptAllocation rows saying which rupee settled which demand
//
// Outstanding is ALWAYS computed: sum(net) - sum(allocated). There is
// deliberately no balance column anywhere.

import { Prisma } from "@prisma/client";
import { db } from "./db";

// Money is Decimal in the database. Compute in paise as integers so
// floating point never loses a rupee, then convert back at the edges.
export function toPaise(v: Prisma.Decimal | number | string): number {
  return Math.round(Number(v) * 100);
}

export function fromPaise(p: number): number {
  return p / 100;
}

// ---------------------------------------------------------------
// How many times a head is charged in one installment
//
// A monthly head appears in every monthly installment once. If the
// school bills quarterly, a monthly head appears three times in each
// quarterly installment. This mapping is the thing people get wrong.
// ---------------------------------------------------------------

export type Cadence = "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL";

const PER_YEAR: Record<string, number> = {
  MONTHLY: 12,
  QUARTERLY: 4,
  HALF_YEARLY: 2,
  ANNUAL: 1,
  ONE_TIME: 1,
};

export function occurrencesInInstallment(
  headFrequency: string,
  billingCadence: Cadence,
  installmentSeq: number
): number {
  // One-time heads are charged only in the first installment of the
  // year — admission fee, caution money.
  if (headFrequency === "ONE_TIME") {
    return installmentSeq === 1 ? 1 : 0;
  }

  const headPerYear = PER_YEAR[headFrequency] ?? 1;
  const billsPerYear = PER_YEAR[billingCadence] ?? 1;

  // An annual head billed quarterly: charged once, in the first bill,
  // rather than split — because that is what schools actually do with
  // annual charges.
  if (headPerYear < billsPerYear) {
    return installmentSeq === 1 ? 1 : 0;
  }

  return headPerYear / billsPerYear;
}

// ---------------------------------------------------------------
// Concessions
// ---------------------------------------------------------------

type ConcessionRow = {
  feeHeadId: string | null;
  type: "PERCENT" | "AMOUNT";
  value: Prisma.Decimal;
  reason: string;
  validFrom: Date | null;
  validTo: Date | null;
};

// Returns the discount in paise for one line, plus why it was given.
// A head-specific concession beats a blanket one; they never stack,
// because stacking surprises people and the biggest single discount is
// what a parent was promised.
export function concessionFor(
  grossPaise: number,
  feeHeadId: string,
  concessions: ConcessionRow[],
  onDate: Date
): { paise: number; reason: string | null } {
  const applicable = concessions.filter((c) => {
    if (c.feeHeadId !== null && c.feeHeadId !== feeHeadId) return false;
    if (c.validFrom && onDate < c.validFrom) return false;
    if (c.validTo && onDate > c.validTo) return false;
    return true;
  });

  if (applicable.length === 0) return { paise: 0, reason: null };

  // Head-specific first.
  const specific = applicable.filter((c) => c.feeHeadId === feeHeadId);
  const pool = specific.length > 0 ? specific : applicable;

  let best = { paise: 0, reason: null as string | null };

  for (const c of pool) {
    const amount =
      c.type === "PERCENT"
        ? Math.round((grossPaise * Number(c.value)) / 100)
        : toPaise(c.value);

    const capped = Math.min(amount, grossPaise); // never negative a bill

    if (capped > best.paise) best = { paise: capped, reason: c.reason };
  }

  return best;
}

// ---------------------------------------------------------------
// Late fee
// ---------------------------------------------------------------

export function lateFeeFor(
  dueOn: Date,
  asOf: Date,
  graceDays: number,
  perDayPaise: number,
  maxPaise: number
): number {
  if (perDayPaise <= 0) return 0;

  const days = Math.floor((asOf.getTime() - dueOn.getTime()) / 86_400_000);
  const chargeable = days - graceDays;

  if (chargeable <= 0) return 0;

  const amount = chargeable * perDayPaise;

  return maxPaise > 0 ? Math.min(amount, maxPaise) : amount;
}

// ---------------------------------------------------------------
// Generating demands
//
// Idempotent on purpose. Running it twice must not double-bill, which
// is why FeeDemand has @@unique([studentId, installmentId]) and this
// skips students who already have one.
// ---------------------------------------------------------------

export async function generateDemands(opts: {
  schoolId: string;
  academicYearId: string;
  installmentId: string;
  billingCadence: Cadence;
  // Limit to one class, or leave undefined for the whole school.
  klassId?: string;
}): Promise<{ created: number; skipped: number }> {
  const installment = await db.feeInstallment.findFirst({
    where: { id: opts.installmentId, academicYearId: opts.academicYearId },
  });

  if (!installment) throw new Error("Unknown installment");

  const enrollments = await db.enrollment.findMany({
    where: {
      academicYearId: opts.academicYearId,
      status: "ACTIVE",
      student: { schoolId: opts.schoolId, status: "ACTIVE", deletedAt: null },
      ...(opts.klassId ? { section: { klassId: opts.klassId } } : {}),
    },
    include: {
      student: {
        include: {
          concessions: { where: { deletedAt: null } },
          demands: { where: { installmentId: opts.installmentId } },
        },
      },
      section: { include: { klass: true } },
    },
  });

  // Fee structures, one query, keyed by class.
  const structures = await db.feeStructure.findMany({
    where: { academicYearId: opts.academicYearId },
    include: { items: { include: { feeHead: true } } },
  });

  const byKlass = new Map(structures.map((s) => [s.klassId, s]));

  let created = 0;
  let skipped = 0;

  for (const e of enrollments) {
    // Already billed for this installment — do not double-bill.
    if (e.student.demands.length > 0) {
      skipped++;
      continue;
    }

    const structure = byKlass.get(e.section.klassId);

    // No fee structure for this class yet. Skip quietly; the caller
    // reports the count so somebody notices.
    if (!structure) {
      skipped++;
      continue;
    }

    const lines: {
      feeHeadId: string;
      description: string;
      gross: number;
      concession: number;
      net: number;
      concessionReason: string | null;
    }[] = [];

    for (const item of structure.items) {
      if (!item.feeHead.active || item.feeHead.isLateFee) continue;

      const times = occurrencesInInstallment(
        item.frequency,
        opts.billingCadence,
        installment.seq
      );

      if (times === 0) continue;

      const gross = toPaise(item.amount) * times;

      const discount = concessionFor(
        gross,
        item.feeHeadId,
        e.student.concessions.map((c) => ({
          feeHeadId: c.feeHeadId,
          type: c.type,
          value: c.value,
          reason: c.reason,
          validFrom: c.validFrom,
          validTo: c.validTo,
        })),
        installment.dueOn
      );

      lines.push({
        feeHeadId: item.feeHeadId,
        // Snapshot the name — renaming a head later must not rewrite
        // receipts already issued.
        description: item.feeHead.name,
        gross,
        concession: discount.paise,
        net: gross - discount.paise,
        concessionReason: discount.reason,
      });
    }

    if (lines.length === 0) {
      skipped++;
      continue;
    }

    const gross = lines.reduce((s, l) => s + l.gross, 0);
    const concession = lines.reduce((s, l) => s + l.concession, 0);

    await db.feeDemand.create({
      data: {
        studentId: e.studentId,
        enrollmentId: e.id,
        installmentId: installment.id,
        dueOn: installment.dueOn,
        gross: fromPaise(gross),
        concession: fromPaise(concession),
        net: fromPaise(gross - concession),
        lines: {
          create: lines.map((l) => ({
            feeHeadId: l.feeHeadId,
            description: l.description,
            gross: fromPaise(l.gross),
            concession: fromPaise(l.concession),
            net: fromPaise(l.net),
            concessionReason: l.concessionReason,
          })),
        },
      },
    });

    created++;
  }

  return { created, skipped };
}

// ---------------------------------------------------------------
// Outstanding
// ---------------------------------------------------------------

export type Outstanding = {
  demandId: string;
  dueOn: Date;
  installment: string;
  net: number;
  paid: number;
  due: number;
  overdueDays: number;
};

export async function outstandingFor(
  studentId: string
): Promise<Outstanding[]> {
  const demands = await db.feeDemand.findMany({
    where: {
      studentId,
      cancelledAt: null,
      status: { in: ["OPEN", "PART_PAID"] },
    },
    orderBy: { dueOn: "asc" },
    include: { installment: { select: { name: true } } },
  });

  const now = Date.now();

  return demands.map((d) => {
    const net = Number(d.net) + Number(d.lateFee);
    const paid = Number(d.paid);

    return {
      demandId: d.id,
      dueOn: d.dueOn,
      installment: d.installment.name,
      net,
      paid,
      due: net - paid,
      overdueDays: Math.max(
        0,
        Math.floor((now - d.dueOn.getTime()) / 86_400_000)
      ),
    };
  });
}

// ---------------------------------------------------------------
// Allocating a payment
//
// Oldest demand first. A parent paying 5,000 against three overdue
// quarters expects the oldest to clear, and partial payment is normal.
// ---------------------------------------------------------------

export function allocateOldestFirst(
  amountPaise: number,
  demands: { demandId: string; duePaise: number }[]
): { demandId: string; amountPaise: number }[] {
  const out: { demandId: string; amountPaise: number }[] = [];

  let left = amountPaise;

  for (const d of demands) {
    if (left <= 0) break;
    if (d.duePaise <= 0) continue;

    const take = Math.min(left, d.duePaise);

    out.push({ demandId: d.demandId, amountPaise: take });
    left -= take;
  }

  // Anything left over is an advance. v1 refuses it rather than
  // silently holding money with nowhere to sit — see CONTEXT.md §5.
  if (left > 0) {
    throw new Error(
      `Payment is ${fromPaise(left)} more than the total outstanding.`
    );
  }

  return out;
}
