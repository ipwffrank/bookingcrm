import dotenv from "dotenv";
import path from "path";
import type { Config } from "drizzle-kit";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export default {
  schema: [
    "./src/schema/merchants.ts",
    "./src/schema/merchant-users.ts",
    "./src/schema/services.ts",
    "./src/schema/staff.ts",
    "./src/schema/clients.ts",
    "./src/schema/bookings.ts",
    "./src/schema/payouts.ts",
    "./src/schema/campaigns.ts",
    "./src/schema/reviews.ts",
    "./src/schema/notifications.ts",
    "./src/schema/groups.ts",
    "./src/schema/consult.ts",
    "./src/schema/post-service.ts",
    "./src/schema/staff-duties.ts",
    "./src/schema/closures.ts",
  ],
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://glowos:glowos_dev@localhost:5432/glowos_dev",
  },
  verbose: true,
  strict: true,
} satisfies Config;
