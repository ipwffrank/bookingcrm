import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { merchantUsers } from "./merchant-users";
import { clients } from "./clients";

// Append-only log of superadmin actions. Anyone with `superAdmin: true` on
// their JWT generates entries here — both when impersonating and when calling
// the /super/* cross-tenant endpoints.
export const superAdminAuditLog = pgTable(
  "super_admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => merchantUsers.id, {
      onDelete: "set null",
    }),
    actorEmail: varchar("actor_email", { length: 255 }).notNull(),
    action: varchar("action", { length: 40 })
      .notNull()
      .$type<"impersonate_start" | "impersonate_end" | "write" | "read">(),
    targetMerchantId: uuid("target_merchant_id").references(() => merchants.id, {
      onDelete: "set null",
    }),
    method: varchar("method", { length: 10 }),
    path: text("path"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    actorIdx: index("saal_actor_idx").on(t.actorUserId, t.createdAt),
    targetIdx: index("saal_target_idx").on(t.targetMerchantId, t.createdAt),
  }),
);

// Inbound WhatsApp messages — posted by Twilio when a client replies to an
// outbound notification. Kept separate from `notification_log` (which is
// outbound) because the two have different lifecycles and authors.
export const whatsappInboundLog = pgTable(
  "whatsapp_inbound_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id").references(() => merchants.id, {
      onDelete: "cascade",
    }),
    fromPhone: varchar("from_phone", { length: 20 }).notNull(),
    body: text("body").notNull(),
    matchedClientId: uuid("matched_client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    twilioMessageSid: varchar("twilio_message_sid", { length: 255 }).unique(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    merchantReceivedIdx: index("wil_merchant_received_idx").on(
      t.merchantId,
      t.receivedAt,
    ),
    fromPhoneIdx: index("wil_from_phone_idx").on(t.fromPhone),
  }),
);
