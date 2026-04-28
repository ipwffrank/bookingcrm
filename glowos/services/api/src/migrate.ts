/**
 * Standalone migration runner. Invoked by the Docker entrypoint BEFORE
 * the API process starts so any pending schema changes are applied to
 * the database first. Drizzle uses an internal `__drizzle_migrations`
 * table to track which migrations have run, so re-invocation is safe
 * (already-applied migrations are skipped).
 *
 * Exits with code 0 on success, non-zero on failure — Docker treats a
 * non-zero exit as a deploy failure, so a broken migration prevents
 * the API from booting against a partially-migrated database.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Walk up from `start` looking for the first ancestor that contains
 * `packages/db/src/migrations`. Avoids the off-by-one trap of counting
 * `..` segments — works whether the script lives under
 * `/app/glowos/services/api/src` (Docker) or
 * `<repo>/glowos/services/api/src` (local dev).
 */
function findMigrationsFolder(start: string): string {
  let cur = start;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(cur, "packages", "db", "src", "migrations");
    if (fs.existsSync(path.join(candidate, "meta", "_journal.json"))) {
      return candidate;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break; // hit the filesystem root
    cur = parent;
  }
  throw new Error(
    `Could not locate packages/db/src/migrations starting from ${start}`,
  );
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[migrate] DATABASE_URL is not set; refusing to run migrations");
    process.exit(1);
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = findMigrationsFolder(here);
  console.log(`[migrate] applying migrations from: ${migrationsFolder}`);

  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 30_000,
  });

  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
    console.log("[migrate] all migrations applied (or already up to date)");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] FAILED", err);
  process.exit(1);
});
