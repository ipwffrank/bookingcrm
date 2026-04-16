import { pgTable, uuid, text, date, time, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { staff } from "./staff";

export const dutyTypeEnum = pgEnum("duty_type", ["floor", "treatment", "break", "other"]);

export const staffDuties = pgTable(
  "staff_duties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    dutyType: dutyTypeEnum("duty_type").notNull().default("floor"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    staffDateIdx: index("staff_duties_staff_date_idx").on(table.staffId, table.date),
    merchantDateIdx: index("staff_duties_merchant_date_idx").on(table.merchantId, table.date),
  })
);
