// glowos/packages/db/src/schema/groups.ts
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  text,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { staff } from "./staff";

// ─── groups ────────────────────────────────────────────────────────────────────
// A company that owns one or more branch merchants.

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── group_settings ────────────────────────────────────────────────────────────
// One settings row per group. All flags default to the most restrictive option.
//
// profileSharingLevel values:
//   'none'         — branches fully isolated
//   'identity_only'— name/phone/email visible cross-branch only
//   'selective'    — identity + visit dates + spend; clientProfiles.notes stay private
//   'full_history' — everything visible across all branches in group

export const groupSettings = pgTable("group_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id")
    .notNull()
    .unique()
    .references(() => groups.id, { onDelete: "cascade" }),
  profileSharingLevel: varchar("profile_sharing_level", { length: 20 })
    .notNull()
    .default("none")
    .$type<"none" | "identity_only" | "selective" | "full_history">(),
  sharedMarketing: boolean("shared_marketing").notNull().default(false),
  sharedHr: boolean("shared_hr").notNull().default(false),
  crossBranchStaff: boolean("cross_branch_staff").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── group_users ───────────────────────────────────────────────────────────────
// Separate auth table for group-level admins. NOT linked to merchant_users.
// JWT shape: { groupId, role: 'group_owner' }

export const groupUsers = pgTable("group_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 20 })
    .notNull()
    .default("group_owner")
    .$type<"group_owner">(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── staff_merchants ───────────────────────────────────────────────────────────
// Cross-branch staff assignments. Only used when group_settings.cross_branch_staff = true.
// staff.merchantId remains the home branch. This table lists ADDITIONAL branches.
// Availability queries must check this table when cross_branch_staff is ON.

export const staffMerchants = pgTable(
  "staff_merchants",
  {
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.staffId, table.merchantId] }),
  })
);
