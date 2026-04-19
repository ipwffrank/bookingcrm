import { db, bookingEdits } from "@glowos/db";
import type { PgTransaction } from "drizzle-orm/pg-core";

export type AuditContext = {
  userId: string;
  userRole: "owner" | "manager" | "staff";
  bookingId?: string;
  bookingGroupId?: string;
};

type DbOrTx = typeof db | PgTransaction<any, any, any>;

/**
 * Compares `before` and `after` objects and writes one booking_edits row per
 * changed field. Values are compared by JSON equality. Dates are serialized
 * to ISO strings before comparison.
 *
 * Pass `tx` when inside a `db.transaction(...)` callback so the audit writes
 * are rolled back together with the rest of the edit if the transaction fails.
 */
export async function writeAuditDiff(
  ctx: AuditContext,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  tx?: DbOrTx
) {
  const client = tx ?? db;
  const rows: Array<{
    bookingId: string | null;
    bookingGroupId: string | null;
    editedByUserId: string;
    editedByRole: "owner" | "manager" | "staff";
    fieldName: string;
    oldValue: unknown;
    newValue: unknown;
  }> = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const a = normalize(before[k]);
    const b = normalize(after[k]);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    rows.push({
      bookingId: ctx.bookingId ?? null,
      bookingGroupId: ctx.bookingGroupId ?? null,
      editedByUserId: ctx.userId,
      editedByRole: ctx.userRole,
      fieldName: k,
      oldValue: a ?? null,
      newValue: b ?? null,
    });
  }
  if (rows.length > 0) {
    await client.insert(bookingEdits).values(rows);
  }
  return rows.length;
}

function normalize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  return v;
}
