import {
  pgTable,
  uuid,
  varchar,
  numeric,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { clients } from "./clients";
import { bookings } from "./bookings";
import { merchantUsers } from "./merchant-users";

export const bookingGroups = pgTable(
  "booking_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    totalPriceSgd: numeric("total_price_sgd", { precision: 10, scale: 2 }).notNull(),
    packagePriceSgd: numeric("package_price_sgd", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    paymentMethod: varchar("payment_method", { length: 20 })
      .notNull()
      .$type<"cash" | "card" | "paynow" | "other">(),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(
      () => merchantUsers.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    merchantIdx: index("booking_groups_merchant_idx").on(table.merchantId),
    clientIdx: index("booking_groups_client_idx").on(table.clientId),
  })
);

export const bookingEdits = pgTable(
  "booking_edits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "cascade",
    }),
    bookingGroupId: uuid("booking_group_id").references(() => bookingGroups.id, {
      onDelete: "cascade",
    }),
    editedByUserId: uuid("edited_by_user_id")
      .notNull()
      .references(() => merchantUsers.id, { onDelete: "restrict" }),
    editedByRole: varchar("edited_by_role", { length: 20 })
      .notNull()
      .$type<"owner" | "manager" | "staff">(),
    fieldName: text("field_name").notNull(),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bookingIdx: index("booking_edits_booking_idx").on(table.bookingId),
    groupIdx: index("booking_edits_group_idx").on(table.bookingGroupId),
  })
);
