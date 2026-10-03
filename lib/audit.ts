// lib/audit.ts
//
// Who looked at or changed which student record.
//
// This is children's data and school money. Reads matter as much as
// writes: "who pulled up this child's address" is a question a school
// may one day have to answer.
//
// Writes are fire-and-forget — an audit failure must never break the
// fee counter — but they are logged loudly.

import { db } from "./db";
import { readSession } from "./auth";

type AuditInput = {
  action: string; // "student.view", "receipt.cancel", "marks.update"
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
};

export async function audit(input: AuditInput): Promise<void> {
  try {
    const session = await readSession();
    if (!session) return;

    await db.auditLog.create({
      data: {
        schoolId: session.schoolId,
        staffId: session.staffId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: (input.before ?? undefined) as never,
        after: (input.after ?? undefined) as never,
      },
    });
  } catch (err) {
    console.error("audit write failed:", err);
  }
}
