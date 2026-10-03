// app/export/route.ts
//
// Data export. "What happens to our records if we stop paying you?" is
// the question a careful school owner asks, and the honest answer has
// to be a working download, not a promise.
//
//   /export?type=students     CSV
//   /export?type=fees         CSV — demands with outstanding
//   /export?type=receipts     CSV
//   /export?type=attendance   CSV
//   /export?type=marks        CSV
//   /export?type=full         JSON — everything, for a real backup
//
// Admin and principal only. Every export is audited: a full dump of a
// school's student list is exactly the event you want a record of.

import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { audit } from "@/lib/audit";

function csv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";

  const headers = Object.keys(rows[0]);

  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";

    const s = v instanceof Date ? v.toISOString() : String(v);

    // Excel treats a leading =, +, - or @ as a formula. Prefix with a
    // quote so a name like "=cmd" cannot become spreadsheet injection
    // for whoever opens this.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;

    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };

  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");
}

function file(body: string, name: string, mime: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": `${mime}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${name}"`,
      // Never let a proxy or the browser cache children's data.
      "Cache-Control": "no-store, private",
    },
  });
}

export async function GET(req: Request) {
  const session = await requireSession();

  if (session.role !== "ADMIN" && session.role !== "PRINCIPAL") {
    return new Response("Only an admin or principal can export data.", {
      status: 403,
    });
  }

  const schoolId = session.schoolId;
  const type = new URL(req.url).searchParams.get("type") ?? "students";
  const stamp = new Date().toISOString().slice(0, 10);

  await audit({
    action: `export.${type}`,
    entityType: "School",
    entityId: schoolId,
  });

  if (type === "students") {
    const rows = await db.student.findMany({
      where: { schoolId, deletedAt: null },
      orderBy: { admissionNo: "asc" },
      include: {
        guardians: { where: { isPrimary: true }, take: 1 },
        enrollments: {
          where: { academicYear: { isCurrent: true } },
          include: { section: { include: { klass: true } } },
          take: 1,
        },
      },
    });

    return file(
      csv(
        rows.map((s) => {
          const e = s.enrollments[0];
          const g = s.guardians[0];

          return {
            admission_no: s.admissionNo,
            sr_no: s.srNo,
            first_name: s.firstName,
            last_name: s.lastName,
            class: e ? `${e.section.klass.name}-${e.section.name}` : "",
            roll_no: e?.rollNo,
            dob: s.dob,
            gender: s.gender,
            category: s.category,
            address: s.address,
            city: s.city,
            guardian: g?.name,
            guardian_relation: g?.relation,
            guardian_phone: g?.phone,
            messaging_consent: g?.messagingConsent,
            admitted_on: s.admittedOn,
            status: s.status,
          };
        })
      ),
      `students-${stamp}.csv`,
      "text/csv"
    );
  }

  if (type === "fees") {
    const rows = await db.feeDemand.findMany({
      where: { student: { schoolId } },
      orderBy: [{ dueOn: "asc" }],
      include: {
        student: { select: { admissionNo: true, firstName: true, lastName: true } },
        installment: { select: { name: true } },
        enrollment: { include: { section: { include: { klass: true } } } },
        lines: true,
      },
    });

    return file(
      csv(
        rows.map((d) => ({
          admission_no: d.student.admissionNo,
          name: `${d.student.firstName} ${d.student.lastName ?? ""}`.trim(),
          class: `${d.enrollment.section.klass.name}-${d.enrollment.section.name}`,
          installment: d.installment.name,
          due_on: d.dueOn,
          heads: d.lines.map((l) => `${l.description} ${Number(l.net)}`).join(" | "),
          gross: Number(d.gross),
          concession: Number(d.concession),
          late_fee: Number(d.lateFee),
          net: Number(d.net),
          paid: Number(d.paid),
          outstanding:
            Number(d.net) + Number(d.lateFee) - Number(d.paid),
          status: d.status,
        }))
      ),
      `fee-demands-${stamp}.csv`,
      "text/csv"
    );
  }

  if (type === "receipts") {
    const rows = await db.receipt.findMany({
      where: { student: { schoolId } },
      orderBy: { number: "asc" },
      include: {
        student: { select: { admissionNo: true, firstName: true, lastName: true } },
        collectedBy: { select: { name: true } },
        allocations: {
          include: { demand: { include: { installment: { select: { name: true } } } } },
        },
      },
    });

    return file(
      csv(
        rows.map((r) => ({
          number: r.number,
          date: r.receivedAt,
          admission_no: r.student.admissionNo,
          name: `${r.student.firstName} ${r.student.lastName ?? ""}`.trim(),
          amount: Number(r.amount),
          mode: r.mode,
          reference: r.reference,
          towards: r.allocations
            .map((a) => `${a.demand.installment.name} ${Number(a.amount)}`)
            .join(" | "),
          collected_by: r.collectedBy?.name,
          cancelled: r.cancelledAt,
          cancelled_reason: r.cancelledReason,
          bounced: r.bouncedAt,
        }))
      ),
      `receipts-${stamp}.csv`,
      "text/csv"
    );
  }

  if (type === "attendance") {
    const rows = await db.attendance.findMany({
      where: { enrollment: { student: { schoolId } } },
      orderBy: { onDate: "asc" },
      include: {
        enrollment: {
          include: {
            student: { select: { admissionNo: true, firstName: true, lastName: true } },
            section: { include: { klass: true } },
          },
        },
      },
    });

    return file(
      csv(
        rows.map((a) => ({
          date: a.onDate,
          admission_no: a.enrollment.student.admissionNo,
          name: `${a.enrollment.student.firstName} ${a.enrollment.student.lastName ?? ""}`.trim(),
          class: `${a.enrollment.section.klass.name}-${a.enrollment.section.name}`,
          status: a.status,
        }))
      ),
      `attendance-${stamp}.csv`,
      "text/csv"
    );
  }

  if (type === "marks") {
    const rows = await db.mark.findMany({
      where: { enrollment: { student: { schoolId } } },
      include: {
        enrollment: {
          include: {
            student: { select: { admissionNo: true, firstName: true, lastName: true } },
            section: { include: { klass: true } },
          },
        },
        paper: {
          include: {
            subject: { select: { name: true } },
            exam: { select: { name: true } },
          },
        },
      },
    });

    return file(
      csv(
        rows.map((m) => ({
          exam: m.paper.exam.name,
          subject: m.paper.subject.name,
          admission_no: m.enrollment.student.admissionNo,
          name: `${m.enrollment.student.firstName} ${m.enrollment.student.lastName ?? ""}`.trim(),
          class: `${m.enrollment.section.klass.name}-${m.enrollment.section.name}`,
          max_marks: Number(m.paper.maxMarks),
          // Absent is exported as the word, never as 0 — see
          // CONTEXT.md §5.
          obtained: m.absent ? "ABSENT" : Number(m.obtained ?? 0),
          grade: m.grade,
        }))
      ),
      `marks-${stamp}.csv`,
      "text/csv"
    );
  }

  if (type === "full") {
    const [school, years, staff, klasses, subjects, students, feeHeads, structures, installments, demands, receipts, attendance, exams, marks, auditLogs] =
      await Promise.all([
        db.school.findUnique({ where: { id: schoolId } }),
        db.academicYear.findMany({ where: { schoolId } }),
        db.staff.findMany({
          where: { schoolId },
          // Never export password hashes.
          select: {
            id: true, name: true, phone: true, role: true,
            qualification: true, registrationNo: true, active: true,
          },
        }),
        db.klass.findMany({ where: { schoolId }, include: { sections: true } }),
        db.subject.findMany({ where: { schoolId } }),
        db.student.findMany({
          where: { schoolId },
          include: { guardians: true, enrollments: true, concessions: true },
        }),
        db.feeHead.findMany({ where: { schoolId } }),
        db.feeStructure.findMany({
          where: { academicYear: { schoolId } },
          include: { items: true },
        }),
        db.feeInstallment.findMany({ where: { academicYear: { schoolId } } }),
        db.feeDemand.findMany({
          where: { student: { schoolId } },
          include: { lines: true },
        }),
        db.receipt.findMany({
          where: { student: { schoolId } },
          include: { allocations: true },
        }),
        db.attendance.findMany({
          where: { enrollment: { student: { schoolId } } },
        }),
        db.exam.findMany({
          where: { academicYear: { schoolId } },
          include: { papers: true },
        }),
        db.mark.findMany({ where: { enrollment: { student: { schoolId } } } }),
        db.auditLog.findMany({
          where: { schoolId },
          orderBy: { createdAt: "desc" },
          take: 20_000,
        }),
      ]);

    const dump = {
      exportedAt: new Date().toISOString(),
      exportedBy: session.name,
      schemaNote:
        "Full export from school-erp. Decimal fields are strings; dates are ISO 8601 UTC. Enrollment links a student to a class for one academic year.",
      school,
      academicYears: years,
      staff,
      classes: klasses,
      subjects,
      students,
      feeHeads,
      feeStructures: structures,
      feeInstallments: installments,
      feeDemands: demands,
      receipts,
      attendance,
      exams,
      marks,
      auditLogs,
    };

    return file(
      JSON.stringify(dump, null, 2),
      `school-backup-${stamp}.json`,
      "application/json"
    );
  }

  return new Response("Unknown export type.", { status: 400 });
}
