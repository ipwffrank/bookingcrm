import { eq, sql } from "drizzle-orm";
import { db, clientPackages } from "@glowos/db";
import type { PgTransaction } from "drizzle-orm/pg-core";

type DbOrTx = typeof db | PgTransaction<any, any, any>;

/**
 * Increments sessions_used by 1 and flips status to 'completed' if all sessions
 * are now used. Caller has already updated the package_sessions row.
 */
export async function incrementPackageSessionsUsed(
  tx: DbOrTx,
  clientPackageId: string
) {
  await tx
    .update(clientPackages)
    .set({ sessionsUsed: sql`${clientPackages.sessionsUsed} + 1` })
    .where(eq(clientPackages.id, clientPackageId));
  const [pkg] = await tx
    .select({
      sessionsUsed: clientPackages.sessionsUsed,
      sessionsTotal: clientPackages.sessionsTotal,
    })
    .from(clientPackages)
    .where(eq(clientPackages.id, clientPackageId))
    .limit(1);
  if (pkg && pkg.sessionsUsed >= pkg.sessionsTotal) {
    await tx
      .update(clientPackages)
      .set({ status: "completed" })
      .where(eq(clientPackages.id, clientPackageId));
  }
}

/**
 * Decrements sessions_used by 1 and flips status back to 'active' if the
 * package had been marked completed. Caller has already reset the
 * package_sessions row.
 */
export async function decrementPackageSessionsUsed(
  tx: DbOrTx,
  clientPackageId: string
) {
  await tx
    .update(clientPackages)
    .set({
      sessionsUsed: sql`${clientPackages.sessionsUsed} - 1`,
      status: "active",
    })
    .where(eq(clientPackages.id, clientPackageId));
}
