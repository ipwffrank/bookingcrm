import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { clients } from "./clients";
import { services } from "./services";
import { merchantUsers } from "./merchant-users";
import { bookings } from "./bookings";

// A clinician-issued quote for a treatment that requires consultation first.
// Lifecycle:
//   pending   → issued, awaiting client acceptance
//   accepted  → client clicked accept + picked a slot; payment pending
//   paid      → online payment succeeded → converted to a booking
//   expired   → valid_until passed without acceptance
//   cancelled → staff voided it (e.g. client declined, clinical reason)
export const treatmentQuotes = pgTable(
  "treatment_quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    // The consultation booking that led to this quote (for audit / context).
    // Nullable because merchants might issue a quote outside a formal consult
    // (e.g. follow-up visit, phone consultation).
    consultBookingId: uuid("consult_booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    // Denormalized for audit — service name can change later.
    serviceName: varchar("service_name", { length: 255 }).notNull(),
    priceSgd: numeric("price_sgd", { precision: 10, scale: 2 }).notNull(),
    notes: text("notes"),
    issuedByStaffId: uuid("issued_by_staff_id").references(() => merchantUsers.id, {
      onDelete: "set null",
    }),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    // Base64url token for the public acceptance URL. Indexed for fast lookup.
    acceptToken: varchar("accept_token", { length: 64 }).notNull().unique(),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("pending")
      .$type<"pending" | "accepted" | "paid" | "expired" | "cancelled">(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    // The booking generated when the client accepts + pays.
    convertedBookingId: uuid("converted_booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledReason: text("cancelled_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    merchantIdx: index("tq_merchant_idx").on(t.merchantId, t.issuedAt),
    clientIdx: index("tq_client_idx").on(t.clientId, t.issuedAt),
    statusIdx: index("tq_status_idx").on(t.status, t.validUntil),
  }),
);
