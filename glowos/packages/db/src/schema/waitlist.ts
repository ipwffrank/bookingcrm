import {
  pgTable,
  uuid,
  varchar,
  date,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { clients } from "./clients";
import { services } from "./services";
import { staff } from "./staff";

export const waitlist = pgTable(
  "waitlist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "restrict" }),
    targetDate: date("target_date").notNull(),
    windowStart: varchar("window_start", { length: 5 }).notNull(),
    windowEnd: varchar("window_end", { length: 5 }).notNull(),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("pending")
      .$type<"pending" | "notified" | "booked" | "expired" | "cancelled">(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    notifiedBookingSlotId: uuid("notified_booking_slot_id"),
    cancelToken: varchar("cancel_token", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    merchantIdx: index("waitlist_merchant_idx").on(table.merchantId),
    matchIdx: index("waitlist_match_idx").on(
      table.merchantId,
      table.staffId,
      table.targetDate,
      table.status
    ),
  })
);
