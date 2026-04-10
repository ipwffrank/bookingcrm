import dotenv from "dotenv";
import path from "path";
import type { Config } from "drizzle-kit";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export default {
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://glowos:glowos_dev@localhost:5432/glowos_dev",
  },
  verbose: true,
  strict: true,
} satisfies Config;
