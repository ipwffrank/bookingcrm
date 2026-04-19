// glowos/services/api/src/lib/firstTimerCheck.ts
import { and, eq, or, inArray } from "drizzle-orm";
import { db, clients, bookings } from "@glowos/db";

export interface FirstTimerCheckArgs {
  merchantId: string;
  normalizedPhone: string | null;
  normalizedEmail: string | null;
  googleId: string | null;
}

/**
 * Authoritative first-timer decision. Returns true if the identifiers provided
 * do NOT resolve to any client with a completed booking at this merchant.
 * Returns true (conservative) if no identifiers are provided, since the caller
 * cannot prove who the customer is — but callers should never reach this path
 * with empty identifiers.
 */
export async function isFirstTimerAtMerchant(
  args: FirstTimerCheckArgs
): Promise<boolean> {
  const conditions = [];
  if (args.normalizedPhone) conditions.push(eq(clients.phone, args.normalizedPhone));
  if (args.normalizedEmail) conditions.push(eq(clients.email, args.normalizedEmail));
  if (args.googleId) conditions.push(eq(clients.googleId, args.googleId));

  if (conditions.length === 0) return true;

  const matching = await db
    .select({ id: clients.id })
    .from(clients)
    .where(or(...conditions));

  if (matching.length === 0) return true;

  const clientIds = matching.map((c: { id: string }) => c.id);

  const [existing] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        inArray(bookings.clientId, clientIds),
        eq(bookings.merchantId, args.merchantId),
        eq(bookings.status, "completed")
      )
    )
    .limit(1);

  return !existing;
}
