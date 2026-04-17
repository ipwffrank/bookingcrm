import {
  pgTable,
  uuid,
  varchar,
  date,
  time,
  boolean,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";

export const merchantClosures = pgTable(
  "merchant_closures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    isFullDay: boolean("is_full_day").notNull().default(true),
    startTime: time("start_time"),
    endTime: time("end_time"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    merchantDateIdx: index("closures_merchant_date_idx").on(
      table.merchantId,
      table.date
    ),
  })
);
