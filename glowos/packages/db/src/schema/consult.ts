// glowos/packages/db/src/schema/consult.ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { bookings } from "./bookings";
import { services } from "./services";
import { staff } from "./staff";

export const consultOutcomes = pgTable("consult_outcomes", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookings.id, { onDelete: "cascade" }),
  recommendedServiceId: uuid("recommended_service_id").references(() => services.id, {
    onDelete: "set null",
  }),
  notes: text("notes"),
  followUpBookingId: uuid("follow_up_booking_id"),
  createdByStaffId: uuid("created_by_staff_id").references(() => staff.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
