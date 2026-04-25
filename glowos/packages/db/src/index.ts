import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const connectionString =
      process.env.DATABASE_URL ??
      "postgresql://glowos:glowos_dev@localhost:5432/glowos_dev";
    // Neon closes idle Postgres connections after ~5 minutes. With a vanilla
    // `pg` Pool that doesn't recycle, the next query picks up a dead socket
    // and stalls ~15s on TCP timeout before reconnecting — that's the
    // intermittent slowness symptom. Tuning below avoids it.
    const pool = new Pool({
      connectionString,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
      max: 10,
    });
    pool.on("error", (err) => {
      console.error("[db] idle client error", err.message);
    });
    _db = drizzle(pool, { schema });
  }
  return _db;
}

// Convenience export — lazy proxy so `db` works as a direct import
// but only connects when first accessed
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return (getDb() as any)[prop];
  },
});

export type Database = ReturnType<typeof getDb>;

export * from "./schema/index.js";
