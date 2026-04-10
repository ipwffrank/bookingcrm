import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const connectionString =
      process.env.DATABASE_URL ??
      "postgresql://glowos:glowos_dev@localhost:5432/glowos_dev";
    const pool = new Pool({ connectionString });
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
