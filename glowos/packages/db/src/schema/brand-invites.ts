import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// Single-use, email-bound invitations sent by a brand admin to add an
// existing merchant owner to their brand. Acceptance moves the recipient's
// merchant into the group AND promotes them to co-brand-admin in one tx.
//
// No FK constraints on group_id / *_user_id — same circular-import pattern
// as merchants.groupId. Application layer enforces referential integrity.
export const brandInvites = pgTable(
  "brand_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id").notNull(),
    createdByUserId: uuid("created_by_user_id").notNull(),
    inviteeEmail: varchar("invitee_email", { length: 255 }).notNull(),
    token: varchar("token", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: uuid("accepted_by_user_id"),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    groupIdx: index("brand_invites_group_id_idx").on(t.groupId),
    tokenIdx: index("brand_invites_token_idx").on(t.token),
  }),
);
