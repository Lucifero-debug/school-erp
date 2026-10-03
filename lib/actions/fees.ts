// lib/actions/fees.ts
//
// Everything that touches money. Read CONTEXT.md §4.2 and §4.3 before
// changing anything here.
//
// Two invariants this file exists to protect:
//   1. Outstanding is computed from demands and allocations. There is
//      no balance column and you must not add one.
//   2. Receipt numbers are sequential and gapless, generated inside a
//      transaction. A cancelled receipt keeps its number.

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../db";
import { requireRole, currentAcademicYear, CAN_HANDLE_MONEY } from "../session";
import { audit } from "../audit";
import { nextReceiptNumber } from "../numbering";
import {
  generateDemands,
  allocateOldestFirst,
  toPaise,
  fromPaise,
  lateFeeFor,
  type Cadence,
} from "../fees";
import { fail, done, requireMoney, isError, type ActionState } from "../result";

// ---------------------------------------------------------------
// Raising demands
// ---------------------------------------------------------------

export async function raiseDemands(
  installmentId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN", "PRINCIPAL", "ACCOUNTANT"]);
  const year = await currentAcademicYear();

  if (year.lockedAt) return fail("This academic year is locked.");

  const cadence = String(formData.get("cadence") ?? "QUARTERLY") as Cadence;
  const klassId = String(formData.get("klassId") ?? "") || undefined;

  const result = await generateDemands({
    schoolId: session.schoolId,
    academicYearId: year.id,
    installmentId,
    billingCadence: cadence,
    klassId,
  });

  await audit({
    action: "fees.demands.generate",
    entityType: "FeeInstallment",
    entityId: installmentId,
    after: result,
  });

  revalidatePath("/fees");

  if (result.created === 0) {
    return fail(
      `Nothing raised. ${result.skipped} student${
        result.skipped === 1 ? " was" : "s were"
      } skipped — already billed for this installment, or their class has no fee structure.`
    );
  }

  return done(
    `Raised ${result.created} demand${result.created === 1 ? "" : "s"}.${
      result.skipped > 0 ? ` ${result.skipped} skipped (already billed).` : ""
    }`
  );
}

// ---------------------------------------------------------------
// Late fees
//
// Applied on demand rather than by a nightly job, so the number a
// parent is told at the counter is the number that gets charged.
// ---------------------------------------------------------------

export async function applyLateFees(
  _prev: ActionState,
  _formData: FormData
): Promise<ActionState> {
  await requireRole(["ADMIN", "PRINCIPAL", "ACCOUNTANT"]);
  const year = await currentAcademicYear();

  if (year.lockedAt) return fail("This academic year is locked.");

  const overdue = await db.feeDemand.findMany({
    where: {
      cancelledAt: null,
      status: { in: ["OPEN", "PART_PAID"] },
      dueOn: { lt: new Date() },
      installment: { academicYearId: year.id },
    },
    include: { installment: true },
  });

  const now = new Date();
  let updated = 0;

  for (const d of overdue) {
    const fee = lateFeeFor(
      d.dueOn,
      now,
      d.installment.lateFeeAfterDays,
      toPaise(d.installment.lateFeePerDay),
      toPaise(d.installment.lateFeeMax)
    );

    if (fee === 0 || fromPaise(fee) === Number(d.lateFee)) continue;

    await db.feeDemand.update({
      where: { id: d.id },
      data: { lateFee: fromPaise(fee) },
    });

    updated++;
  }

  revalidatePath("/fees");
  revalidatePath("/fees/defaulters");

  return done(`Late fee updated on ${updated} demand${updated === 1 ? "" : "s"}.`);
}

// ---------------------------------------------------------------
// Collecting money
//
// The hot path. One person, a queue of parents, a printer. It has to
// be fast and it has to be right.
// ---------------------------------------------------------------

export async function collectFee(
  studentId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(CAN_HANDLE_MONEY);
  const year = await currentAcademicYear();

  if (year.lockedAt) return fail("This academic year is locked.");

  const student = await db.student.findFirst({
    where: { id: studentId, schoolId: session.schoolId, deletedAt: null },
  });

  if (!student) return fail("That student was not found.");

  const amount = requireMoney(formData.get("amount"), "Amount");
  if (isError(amount)) return fail(amount.error);
  if (amount.value <= 0) return fail("Enter an amount greater than zero.");

  const mode = String(formData.get("mode") ?? "CASH");
  const reference = String(formData.get("reference") ?? "").trim() || null;

  if ((mode === "CHEQUE" || mode === "DD") && !reference) {
    return fail("Enter the cheque or DD number.");
  }

  // Outstanding demands, oldest first. Late fee counts toward the due.
  const demands = await db.feeDemand.findMany({
    where: {
      studentId,
      cancelledAt: null,
      status: { in: ["OPEN", "PART_PAID"] },
    },
    orderBy: { dueOn: "asc" },
  });

  const due = demands.map((d) => ({
    demandId: d.id,
    duePaise: toPaise(d.net) + toPaise(d.lateFee) - toPaise(d.paid),
  }));

  const totalDue = due.reduce((s, d) => s + Math.max(0, d.duePaise), 0);

  if (totalDue <= 0) return fail("This student has nothing outstanding.");

  const amountPaise = toPaise(amount.value);

  // v1 has no advance balance. Refusing is better than silently
  // holding money with nowhere to sit — see CONTEXT.md §5.
  if (amountPaise > totalDue) {
    return fail(
      `That is more than the ₹${fromPaise(totalDue).toLocaleString(
        "en-IN"
      )} outstanding. Collect the exact amount or less.`
    );
  }

  let allocations: { demandId: string; amountPaise: number }[];

  try {
    allocations = allocateOldestFirst(amountPaise, due);
  } catch (err) {
    return fail((err as Error).message);
  }

  // Number generation and insert in one transaction, so two clerks
  // taking money at the same moment cannot produce the same receipt
  // number.
  const receipt = await db.$transaction(async (tx) => {
    const number = await nextReceiptNumber(tx, year.id, year.name);

    const created = await tx.receipt.create({
      data: {
        academicYearId: year.id,
        studentId,
        number,
        amount: amount.value,
        mode: mode as "CASH" | "UPI" | "CARD" | "CHEQUE" | "BANK_TRANSFER" | "ONLINE" | "DD",
        reference,
        collectedById: session.staffId,
        allocations: {
          create: allocations.map((a) => ({
            demandId: a.demandId,
            amount: fromPaise(a.amountPaise),
          })),
        },
      },
    });

    // Update each demand's paid total and status.
    for (const a of allocations) {
      const d = demands.find((x) => x.id === a.demandId)!;

      const paid = toPaise(d.paid) + a.amountPaise;
      const owed = toPaise(d.net) + toPaise(d.lateFee);

      await tx.feeDemand.update({
        where: { id: d.id },
        data: {
          paid: fromPaise(paid),
          status: paid >= owed ? "PAID" : "PART_PAID",
        },
      });
    }

    return created;
  });

  await audit({
    action: "fees.collect",
    entityType: "Receipt",
    entityId: receipt.id,
    after: { number: receipt.number, amount: amount.value, mode },
  });

  revalidatePath("/fees");
  revalidatePath(`/students/${studentId}`);

  // Straight to the printable receipt — the parent is waiting for it.
  redirect(`/fees/receipt/${receipt.id}`);
}

// ---------------------------------------------------------------
// Corrections
//
// Receipts are cancelled, never deleted, and the number is not reused.
// Cancelling rolls back the allocations so the demands reopen.
// ---------------------------------------------------------------

export async function cancelReceipt(
  receiptId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN", "PRINCIPAL"]);

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return fail("Give a reason — this stays on the record.");

  const receipt = await db.receipt.findFirst({
    where: {
      id: receiptId,
      cancelledAt: null,
      student: { schoolId: session.schoolId },
    },
    include: { allocations: true },
  });

  if (!receipt) return fail("That receipt was not found, or is already cancelled.");

  await db.$transaction(async (tx) => {
    for (const a of receipt.allocations) {
      const d = await tx.feeDemand.findUnique({ where: { id: a.demandId } });
      if (!d) continue;

      const paid = toPaise(d.paid) - toPaise(a.amount);
      const owed = toPaise(d.net) + toPaise(d.lateFee);

      await tx.feeDemand.update({
        where: { id: d.id },
        data: {
          paid: fromPaise(Math.max(0, paid)),
          status: paid <= 0 ? "OPEN" : paid >= owed ? "PAID" : "PART_PAID",
        },
      });
    }

    await tx.receiptAllocation.deleteMany({ where: { receiptId: receipt.id } });

    await tx.receipt.update({
      where: { id: receipt.id },
      data: { cancelledAt: new Date(), cancelledReason: reason },
    });
  });

  await audit({
    action: "fees.receipt.cancel",
    entityType: "Receipt",
    entityId: receipt.id,
    before: { amount: Number(receipt.amount), number: receipt.number },
    after: { reason },
  });

  revalidatePath("/fees");
  return done("Receipt cancelled. The fees are outstanding again.");
}

// A bounced cheque is not a cancelled receipt — the money was taken in
// good faith and the school usually charges for the bounce. Recorded
// separately so the distinction survives.
export async function markChequeBounced(
  receiptId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN", "PRINCIPAL", "ACCOUNTANT"]);

  const reason = String(formData.get("reason") ?? "").trim() || "Cheque returned";

  const receipt = await db.receipt.findFirst({
    where: {
      id: receiptId,
      cancelledAt: null,
      bouncedAt: null,
      student: { schoolId: session.schoolId },
    },
    include: { allocations: true },
  });

  if (!receipt) return fail("That receipt was not found.");

  if (receipt.mode !== "CHEQUE" && receipt.mode !== "DD") {
    return fail("Only a cheque or DD can bounce.");
  }

  await db.$transaction(async (tx) => {
    for (const a of receipt.allocations) {
      const d = await tx.feeDemand.findUnique({ where: { id: a.demandId } });
      if (!d) continue;

      const paid = toPaise(d.paid) - toPaise(a.amount);

      await tx.feeDemand.update({
        where: { id: d.id },
        data: {
          paid: fromPaise(Math.max(0, paid)),
          status: paid <= 0 ? "OPEN" : "PART_PAID",
        },
      });
    }

    await tx.receiptAllocation.deleteMany({ where: { receiptId: receipt.id } });

    await tx.receipt.update({
      where: { id: receipt.id },
      data: { bouncedAt: new Date(), bouncedReason: reason },
    });
  });

  await audit({
    action: "fees.receipt.bounced",
    entityType: "Receipt",
    entityId: receipt.id,
    after: { reason },
  });

  revalidatePath("/fees");
  return done("Marked as bounced. The fees are outstanding again.");
}

// ---------------------------------------------------------------
// Concessions
// ---------------------------------------------------------------

export async function addConcession(
  studentId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  // Concessions are where school money quietly leaks, so only the
  // people accountable for the budget can grant one.
  const session = await requireRole(["ADMIN", "PRINCIPAL"]);

  const student = await db.student.findFirst({
    where: { id: studentId, schoolId: session.schoolId, deletedAt: null },
  });

  if (!student) return fail("That student was not found.");

  const value = requireMoney(formData.get("value"), "Value");
  if (isError(value)) return fail(value.error);

  const type = String(formData.get("type") ?? "PERCENT");

  if (type === "PERCENT" && value.value > 100) {
    return fail("A percentage concession cannot be more than 100.");
  }

  const feeHeadId = String(formData.get("feeHeadId") ?? "") || null;

  await db.concession.create({
    data: {
      studentId,
      feeHeadId,
      type: type as "PERCENT" | "AMOUNT",
      value: value.value,
      reason: String(formData.get("reason") ?? "OTHER") as never,
      note: String(formData.get("note") ?? "").trim() || null,
      approvedById: session.staffId,
      approvedAt: new Date(),
    },
  });

  await audit({
    action: "fees.concession.add",
    entityType: "Student",
    entityId: studentId,
    after: { type, value: value.value, feeHeadId },
  });

  revalidatePath(`/students/${studentId}`);

  return done(
    "Concession added. It applies to demands raised from now on — bills already raised are unchanged."
  );
}
