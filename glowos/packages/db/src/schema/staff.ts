import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  time,
  timestamp,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { merchants } from "./merchants";
import { services } from "./services";

export const staff = pgTable("staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  title: varchar("title", { length: 100 }),
  photoUrl: text("photo_url"),
  isActive: boolean("is_active").notNull().default(true),
  isAnyAvailable: boolean("is_any_available").notNull().default(false),
  displayOrder: integer("display_order").notNull().default(0),
  bio: text("bio"),
  specialtyTags: text("specialty_tags").array(),
  credentials: text("credentials"),
  isPubliclyVisible: boolean("is_publicly_visible").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const staffServices = pgTable(
  "staff_services",
  {
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.staffId, table.serviceId] }),
  })
);

export const staffHours = pgTable(
  "staff_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    isWorking: boolean("is_working").notNull().default(true),
  },
  (table) => ({
    dayOfWeekValid: check(
      "day_of_week_valid",
      sql`${table.dayOfWeek} >= 0 AND ${table.dayOfWeek} <= 6`
    ),
  })
);
