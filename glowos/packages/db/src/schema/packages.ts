import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { clients } from "./clients";
import { bookings } from "./bookings";
import { services } from "./services";
import { staff } from "./staff";

// Package templates — what the admin creates as offerings
export const servicePackages = pgTable("service_packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  totalSessions: integer("total_sessions").notNull(),
  priceSgd: numeric("price_sgd", { precision: 10, scale: 2 }).notNull(),
  includedServices: jsonb("included_services")
    .$type<
      Array<{ serviceId: string; serviceName: string; quantity: number }>
    >()
    .notNull(),
  validityDays: integer("validity_days").notNull().default(180),
  isActive: boolean("is_active").notNull().default(true),
  // When true the customer can only purchase this package after an in-person
  // consultation — parallel to services.requires_consult_first. The widget
  // blocks direct purchase and the clinic issues a treatment quote instead.
  requiresConsultFirst: boolean("requires_consult_first").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Client packages — a purchased package assigned to a client
export const clientPackages = pgTable(
  "client_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    packageId: uuid("package_id")
      .notNull()
      .references(() => servicePackages.id, { onDelete: "restrict" }),
    packageName: varchar("package_name", { length: 255 }).notNull(), // denormalized
    sessionsTotal: integer("sessions_total").notNull(),
    sessionsUsed: integer("sessions_used").notNull().default(0),
    purchasedAt: timestamp("purchased_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("active")
      .$type<"active" | "completed" | "expired" | "cancelled">(),
    pricePaidSgd: numeric("price_paid_sgd", { precision: 10, scale: 2 }).notNull(),
    soldByStaffId: uuid("sold_by_staff_id").references(() => staff.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clientMerchantIdx: index("idx_client_packages_client").on(
      table.clientId,
      table.merchantId
    ),
  })
);

// Individual sessions within a client package
export const packageSessions = pgTable(
  "package_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientPackageId: uuid("client_package_id")
      .notNull()
      .references(() => clientPackages.id, { onDelete: "cascade" }),
    sessionNumber: integer("session_number").notNull(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("pending")
      .$type<"pending" | "booked" | "completed" | "missed">(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    staffId: uuid("staff_id").references(() => staff.id, {
      onDelete: "set null",
    }),
    staffName: text("staff_name"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    clientPkgIdx: index("idx_package_sessions_client_pkg").on(
      table.clientPackageId
    ),
  })
);
