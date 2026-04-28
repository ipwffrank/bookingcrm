/**
 * Standalone migration runner. Invoked by the Docker entrypoint BEFORE
 * the API process starts so any pending schema changes are applied to
 * the database first. Drizzle uses an internal table
 * `drizzle.__drizzle_migrations` to track which migrations have run, so
 * re-invocation is safe (already-applied migrations are skipped).
 *
 * Exits with code 0 on success, non-zero on failure — Docker treats a
 * non-zero exit as a deploy failure, so a broken migration prevents
 * the API from booting against a partially-migrated database.
 *
 * BOOTSTRAP MODE: prod ran on this codebase for months before automated
 * migrations were wired up. Past migrations were applied manually and
 * Drizzle's tracking table was never populated. When this script first
 * runs against such a database it would otherwise re-apply every
 * migration from 0000, crashing on the first one that isn't idempotent
 * (the early ones use IF NOT EXISTS so they pass silently, but
 * 0015_add_merchants_is_pilot is a plain ALTER TABLE that fails).
 *
 * To handle this gracefully: if the `merchants` table is clearly
 * established (mature column count) AND the Drizzle tracking table is
 * empty, we mark every journal entry EXCEPT the most recent as already
 * applied. The most recent then runs normally — it's the only one we
 * actually expect to be new on a freshly-deploying prod that's been
 * up-to-date until now. From the second deploy onward the bootstrap is
 * a no-op (the table is no longer empty) and every subsequent migration
 * runs through Drizzle's normal flow.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

/**
 * Walk up from `start` looking for the first ancestor that contains
 * `packages/db/src/migrations`. Avoids the off-by-one trap of counting
 * `..` segments.
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

/**
 * Re-implements Drizzle's hash format for migration files: sha256 hex of
 * the raw .sql contents (statement-breakpoint markers included).
 */
function hashMigration(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf8");
  return crypto.createHash("sha256").update(content).digest("hex");
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

  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const journal: Journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));

  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 30_000,
  });

  try {
    const db = drizzle(pool);

    // ─── Bootstrap check ─────────────────────────────────────────────────
    // Ensure Drizzle's tracking table exists (so we can SELECT from it
    // safely below). Drizzle's migrate() also does this — running it
    // here ahead of time is harmless and keeps the bootstrap path clean.
    await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);

    const trackedRes = await db.execute<{ hash: string }>(sql`
      SELECT hash FROM "drizzle"."__drizzle_migrations"
    `);
    const trackedHashes = new Set(trackedRes.rows.map((r) => r.hash));

    // Count merchants columns as a "schema established" probe. A fresh DB
    // returns 0; an established prod has 30+. We use ≥ 20 as a generous
    // threshold so partially-migrated mid-development databases don't
    // accidentally trip the bootstrap.
    const merchantColRes = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'merchants'
    `);
    const merchantsColumnCount = Number(merchantColRes.rows[0]?.n ?? 0);

    if (trackedHashes.size === 0 && merchantsColumnCount >= 20) {
      console.log(
        `[migrate] BOOTSTRAP: tracking table empty but merchants table has ${merchantsColumnCount} columns — assuming schema is up to date through journal entry ${journal.entries[journal.entries.length - 2]?.tag}`,
      );

      // Insert hashes for every journal entry EXCEPT the most recent one.
      // The most recent will run via drizzle's migrate() below and create
      // its own tracking row.
      const toMarkApplied = journal.entries.slice(0, -1);
      const newest = journal.entries[journal.entries.length - 1];
      console.log(
        `[migrate] BOOTSTRAP: marking ${toMarkApplied.length} prior migrations as applied; will run only ${newest?.tag}`,
      );

      for (const entry of toMarkApplied) {
        const filePath = path.join(migrationsFolder, `${entry.tag}.sql`);
        if (!fs.existsSync(filePath)) {
          throw new Error(
            `[migrate] BOOTSTRAP: missing migration file ${filePath}`,
          );
        }
        const hash = hashMigration(filePath);
        await db.execute(sql`
          INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
          VALUES (${hash}, ${entry.when})
        `);
      }
      console.log("[migrate] BOOTSTRAP: complete");
    } else if (trackedHashes.size === 0) {
      console.log(
        "[migrate] tracking table empty AND merchants table missing — treating as fresh database, all migrations will run",
      );
    } else {
      console.log(
        `[migrate] tracking table has ${trackedHashes.size} entries — normal incremental migration`,
      );
    }

    // ─── Normal migrate flow ─────────────────────────────────────────────
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
