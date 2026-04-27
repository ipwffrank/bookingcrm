import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { staff } from "./staff";

export const merchantUsers = pgTable("merchant_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  staffId: uuid("staff_id").references(() => staff.id, { onDelete: "set null" }),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  phone: varchar("phone", { length: 20 }),
  passwordHash: text("password_hash").notNull(),
  role: varchar("role", { length: 20 })
    .notNull()
    .$type<"owner" | "manager" | "clinician" | "staff">(),
  photoUrl: text("photo_url"),
  isActive: boolean("is_active").notNull().default(true),
  // When non-null, this merchant_user also has brand-admin authority over
  // every merchant in the named group. Lets a branch owner hold both roles
  // with a single login. Bare UUID (no FK) to avoid the merchants ↔ groups
  // circular import — application layer enforces validity.
  brandAdminGroupId: uuid("brand_admin_group_id"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
