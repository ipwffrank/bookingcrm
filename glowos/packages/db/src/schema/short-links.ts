import { pgTable, uuid, varchar, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Internal URL shortener for outbound notifications. WhatsApp/SMS bodies that
 * embed long signed-token URLs (cancel/confirm/waitlist/quote) bloat the
 * message and look spammy. We mint a stable 8-char code per full URL and
 * resolve it via a tiny redirect endpoint.
 *
 * Idempotent on `full_url` over the row lifetime — re-sending a notification
 * for the same booking re-uses the same code rather than minting a new one.
 */
export const shortLinks = pgTable(
  "short_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 16 }).notNull().unique(),
    fullUrl: text("full_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => ({
    codeIdx: index("short_links_code_idx").on(t.code),
  }),
);
