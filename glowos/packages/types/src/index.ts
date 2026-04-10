// Re-export all schema tables so consumers can use them for type inference
export {
  merchants,
  merchantUsers,
  services,
  staff,
  staffServices,
  staffHours,
  clients,
  clientProfiles,
  bookings,
  slotLeases,
  payouts,
  campaigns,
  campaignMessages,
  reviews,
  notificationLog,
} from "@glowos/db";

import type {
  merchants,
  merchantUsers,
  services,
  staff,
  staffServices,
  staffHours,
  clients,
  clientProfiles,
  bookings,
  slotLeases,
  payouts,
  campaigns,
  campaignMessages,
  reviews,
  notificationLog,
} from "@glowos/db";

// ─── Select types (what you get back from the DB) ─────────────────────────────

export type Merchant = typeof merchants.$inferSelect;
export type MerchantUser = typeof merchantUsers.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Staff = typeof staff.$inferSelect;
export type StaffService = typeof staffServices.$inferSelect;
export type StaffHours = typeof staffHours.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type ClientProfile = typeof clientProfiles.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type SlotLease = typeof slotLeases.$inferSelect;
export type Payout = typeof payouts.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type CampaignMessage = typeof campaignMessages.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type NotificationLog = typeof notificationLog.$inferSelect;

// ─── Insert types (what you pass when inserting) ──────────────────────────────

export type NewMerchant = typeof merchants.$inferInsert;
export type NewMerchantUser = typeof merchantUsers.$inferInsert;
export type NewService = typeof services.$inferInsert;
export type NewStaff = typeof staff.$inferInsert;
export type NewStaffService = typeof staffServices.$inferInsert;
export type NewStaffHours = typeof staffHours.$inferInsert;
export type NewClient = typeof clients.$inferInsert;
export type NewClientProfile = typeof clientProfiles.$inferInsert;
export type NewBooking = typeof bookings.$inferInsert;
export type NewSlotLease = typeof slotLeases.$inferInsert;
export type NewPayout = typeof payouts.$inferInsert;
export type NewCampaign = typeof campaigns.$inferInsert;
export type NewCampaignMessage = typeof campaignMessages.$inferInsert;
export type NewReview = typeof reviews.$inferInsert;
export type NewNotificationLog = typeof notificationLog.$inferInsert;

// ─── Domain enums / literal types ────────────────────────────────────────────

export type MerchantCategory =
  | "hair_salon"
  | "nail_studio"
  | "spa"
  | "massage"
  | "beauty_centre";

export type MerchantUserRole = "owner" | "manager" | "staff";

export type BookingStatus =
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export type VipTier = "bronze" | "silver" | "gold" | "platinum";

export type ChurnRisk = "low" | "medium" | "high";

export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "failed";

export type PayoutStatus = "pending" | "processing" | "paid" | "failed";

export type PaymentStatus = "pending" | "paid" | "refunded" | "failed";

export type NotificationChannel = "sms" | "whatsapp" | "email";

export type BookingSource =
  | "web"
  | "dashboard"
  | "google"
  | "walk_in"
  | "phone";
