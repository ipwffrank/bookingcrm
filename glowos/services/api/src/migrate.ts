/**
 * Hardened standalone migration runner. Run manually with:
 *
 *   DATABASE_URL=... pnpm --filter @glowos/api migrate
 *
 * NOT wired into the Dockerfile yet — the previous auto-migrate attempt
 * (PR #57–#59) hung on prod because `pool.end()` blocked indefinitely
 * after a successful migration, preventing the API from starting.
 *
 * Hardening vs the original:
 *   1. Explicit `process.exit(0)` on success — never relies on the
 *      event loop draining naturally. If pg's pool keeps a connection
 *      lingering for any reason, we still exit.
 *   2. Hard 60-second wall-clock timeout. If migrate() or pool ops hang,
 *      the script aborts with exit code 2 instead of holding the
 *      container forever.
 *   3. No bootstrap logic — the manual SQL block applied to prod has
 *      already populated drizzle.__drizzle_migrations with all 20
 *      hashes, so the normal incremental flow is enough from now on.
 *      Future migrations land via this script (manual `pnpm migrate`)
 *      until we re-introduce the Dockerfile auto-call after burning in
 *      this script for a few cycles.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const HARD_TIMEOUT_MS = 60_000;

/**
 * Walk up from `start` looking for the first ancestor that contains
 * `packages/db/src/migrations`. Avoids hard-coded `..` counts that
 * silently break when paths shift between dev and Docker layouts.
 */
function findMigrationsFolder(start: string): string {
  let cur = start;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(cur, "packages", "db", "src", "migrations");
    if (fs.existsSync(path.join(candidate, "meta", "_journal.json"))) {
      return candidate;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error(
    `Could not locate packages/db/src/migrations starting from ${start}`,
  );
}

async function runMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[migrate] DATABASE_URL is not set; refusing to run");
    process.exit(1);
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = findMigrationsFolder(here);
  console.log(`[migrate] applying migrations from: ${migrationsFolder}`);

  // Single-connection pool — the migrator opens one transaction at a time
  // and we don't need anything else to share this pool.
  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 30_000,
  });

  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
    console.log("[migrate] all migrations applied (or already up to date)");
  } finally {
    // Best-effort drain; do NOT await indefinitely. If pool.end() hangs
    // (a known edge case with serverless Postgres) the process.exit
    // below will force termination.
    pool.end().catch((err) => {
      console.warn("[migrate] pool.end() error (ignored):", err.message);
    });
  }
}

// Hard timeout — wraps the whole script in a wall-clock deadline so a
// hung migration or stuck pool can never block a container indefinitely.
const timeoutHandle = setTimeout(() => {
  console.error(
    `[migrate] HARD TIMEOUT after ${HARD_TIMEOUT_MS}ms — exiting with code 2`,
  );
  process.exit(2);
}, HARD_TIMEOUT_MS);
// Don't keep the event loop alive just for this timer.
timeoutHandle.unref();

runMigrations()
  .then(() => {
    // Explicit exit — never rely on the event loop draining naturally.
    // pg's pool can keep a connection in a half-closed state (especially
    // against Neon serverless) which would otherwise hang the script.
    clearTimeout(timeoutHandle);
    console.log("[migrate] done");
    process.exit(0);
  })
  .catch((err) => {
    clearTimeout(timeoutHandle);
    console.error("[migrate] FAILED", err);
    process.exit(1);
  });
