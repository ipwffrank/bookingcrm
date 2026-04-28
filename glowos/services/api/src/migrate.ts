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
import { fileURLToPath } from "node:url";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[migrate] DATABASE_URL is not set; refusing to run migrations");
    process.exit(1);
  }

  // Resolve the migrations folder relative to THIS file so the script
  // works whether it's run from /app, /app/glowos, or anywhere else.
  // In Docker the layout is:
  //   /app/glowos/services/api/src/migrate.ts        (this file)
  //   /app/glowos/packages/db/src/migrations/        (target)
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.resolve(
    here,
    "..",
    "..",
    "..",
    "..",
    "packages",
    "db",
    "src",
    "migrations",
  );
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
