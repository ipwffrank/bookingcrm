import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// Polymorphic reset tokens — one row per request, hashed at rest.
// user_type = 'merchant_user' | 'group_user' (future: 'super_admin').
// No FK because the referenced row lives in different tables by type.
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userType: varchar("user_type", { length: 20 })
      .notNull()
      .$type<"merchant_user" | "group_user">(),
    userId: uuid("user_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    requestedIp: varchar("requested_ip", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("prt_user_idx").on(t.userType, t.userId),
  }),
);
