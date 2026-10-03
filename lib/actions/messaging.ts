// lib/actions/messaging.ts
//
// Fee reminders and absence alerts to guardians.
//
// Three rules, all of them about not becoming a nuisance:
//   1. Only guardians with messagingConsent. No exceptions.
//   2. Never the same message twice in a day — MessageLog is checked
//      before sending, not after.
//   3. Everything sent is logged, so "you never told us" is answerable.

"use server";

import { revalidatePath } from "next/cache";
import { db } from "../db";
import { requireRole, currentAcademicYear, CAN_HANDLE_MONEY } from "../session";
import { audit } from "../audit";
import { isConfigured, sendTemplate, feeTemplate, absenceTemplate } from "../whatsapp";
import { startOfDay, endOfDay, rupees, date, studentName } from "../format";
import { fail, done, type ActionState } from "../result";

export async function sendFeeReminders(
  _prev: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const session = await requireRole(CAN_HANDLE_MONEY);
  const year = await currentAcademicYear();

  const template = feeTemplate();

  if (!isConfigured() || !template) {
    return fail(
      "WhatsApp is not set up. Add WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_FEE_TEMPLATE, and get the template approved by Meta."
    );
  }

  const overdue = await db.feeDemand.findMany({
    where: {
      cancelledAt: null,
      status: { in: ["OPEN", "PART_PAID"] },
      dueOn: { lt: new Date() },
      installment: { academicYearId: year.id },
      student: {
        status: "ACTIVE",
        deletedAt: null,
        guardians: { some: { isPrimary: true, messagingConsent: true } },
      },
    },
    include: {
      student: {
        include: { guardians: { where: { isPrimary: true }, take: 1 } },
      },
    },
  });

  // One message per student, not one per demand.
  const perStudent = new Map<
    string,
    { name: string; phone: string; guardianId: string; due: number }
  >();

  for (const d of overdue) {
    const owed = Number(d.net) + Number(d.lateFee) - Number(d.paid);
    if (owed <= 0) continue;

    const g = d.student.guardians[0];
    if (!g) continue;

    const existing = perStudent.get(d.studentId);

    if (existing) existing.due += owed;
    else
      perStudent.set(d.studentId, {
        name: studentName(d.student),
        phone: g.phone,
        guardianId: g.id,
        due: owed,
      });
  }

  const since = startOfDay(new Date());
  let sent = 0;
  let skipped = 0;

  for (const [studentId, info] of perStudent) {
    // Already reminded today? Leave them alone.
    const alreadyToday = await db.messageLog.findFirst({
      where: {
        studentId,
        kind: "FEE_REMINDER",
        sentAt: { gte: since },
      },
    });

    if (alreadyToday) {
      skipped++;
      continue;
    }

    const body = `${info.name}, ${rupees(info.due)}`;

    const result = await sendTemplate(info.phone, template, [
      info.name,
      rupees(info.due),
    ]);

    await db.messageLog.create({
      data: {
        schoolId: session.schoolId,
        studentId,
        guardianId: info.guardianId,
        toPhone: info.phone,
        channel: "WHATSAPP",
        kind: "FEE_REMINDER",
        body,
        sentAt: result.ok ? new Date() : null,
        failedAt: result.ok ? null : new Date(),
        failReason: result.ok ? null : result.reason,
      },
    });

    if (result.ok) sent++;
  }

  await audit({
    action: "message.fee_reminders",
    entityType: "School",
    entityId: session.schoolId,
    after: { sent, skipped },
  });

  revalidatePath("/messages");

  return done(
    `${sent} reminder${sent === 1 ? "" : "s"} sent.${
      skipped > 0 ? ` ${skipped} already reminded today.` : ""
    }`
  );
}

export async function sendAbsenceAlerts(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireRole(["ADMIN", "PRINCIPAL", "ACCOUNTANT"]);
  const year = await currentAcademicYear();

  const template = absenceTemplate();

  if (!isConfigured() || !template) {
    return fail(
      "WhatsApp is not set up. Add WHATSAPP_ABSENCE_TEMPLATE and get the template approved by Meta."
    );
  }

  const dayRaw = String(formData.get("day") ?? "");
  const day = dayRaw ? startOfDay(new Date(dayRaw)) : startOfDay(new Date());

  if (Number.isNaN(day.getTime())) return fail("Pick a valid date.");

  const absent = await db.attendance.findMany({
    where: {
      onDate: { gte: day, lte: endOfDay(day) },
      status: "ABSENT",
      enrollment: {
        academicYearId: year.id,
        student: {
          status: "ACTIVE",
          deletedAt: null,
          guardians: { some: { isPrimary: true, messagingConsent: true } },
        },
      },
    },
    include: {
      enrollment: {
        include: {
          student: {
            include: { guardians: { where: { isPrimary: true }, take: 1 } },
          },
        },
      },
    },
  });

  let sent = 0;
  let skipped = 0;

  for (const a of absent) {
    const student = a.enrollment.student;
    const g = student.guardians[0];
    if (!g) continue;

    const already = await db.messageLog.findFirst({
      where: {
        studentId: student.id,
        kind: "ABSENCE_ALERT",
        sentAt: { gte: day, lte: endOfDay(day) },
      },
    });

    if (already) {
      skipped++;
      continue;
    }

    const result = await sendTemplate(g.phone, template, [
      studentName(student),
      date(day),
    ]);

    await db.messageLog.create({
      data: {
        schoolId: session.schoolId,
        studentId: student.id,
        guardianId: g.id,
        toPhone: g.phone,
        channel: "WHATSAPP",
        kind: "ABSENCE_ALERT",
        body: `${studentName(student)} absent ${date(day)}`,
        sentAt: result.ok ? new Date() : null,
        failedAt: result.ok ? null : new Date(),
        failReason: result.ok ? null : result.reason,
      },
    });

    if (result.ok) sent++;
  }

  await audit({
    action: "message.absence_alerts",
    entityType: "School",
    entityId: session.schoolId,
    after: { day: day.toISOString(), sent, skipped },
  });

  revalidatePath("/messages");

  return done(
    `${sent} alert${sent === 1 ? "" : "s"} sent.${
      skipped > 0 ? ` ${skipped} already alerted.` : ""
    }`
  );
}
