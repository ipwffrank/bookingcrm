import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { clients } from "./clients";
import { staff } from "./staff";

export const clientNotes = pgTable("client_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id").notNull().references(() => merchants.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  staffId: uuid("staff_id").references(() => staff.id, { onDelete: "set null" }),
  staffName: text("staff_name"), // denormalized for display even if staff deleted
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
