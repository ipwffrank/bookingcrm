import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://glowos:glowos_dev@localhost:5432/glowos_dev",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",

  jwtSecret: process.env.JWT_SECRET ?? "glowos-dev-jwt-secret",
  jwtExpiry: process.env.JWT_EXPIRY ?? "15m",
  refreshTokenExpiry: process.env.REFRESH_TOKEN_EXPIRY ?? "30d",

  bookingTokenSecret: process.env.BOOKING_TOKEN_SECRET ?? "glowos-dev-booking-secret",

  appUrl: process.env.APP_URL ?? "http://localhost:3001",
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  dashboardUrl: process.env.DASHBOARD_URL ?? "http://localhost:3002",

  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",

  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  twilioWhatsappFrom: process.env.TWILIO_WHATSAPP_FROM ?? "+6531591234",
  // Pre-approved WhatsApp Content Template SIDs. Required for business-
  // initiated sends outside the 24h session window (OTP, reminders, etc.).
  // Create in Twilio Console → Content Template Builder, submit for
  // WhatsApp approval, copy the ContentSid (starts with "HX").
  twilioOtpContentSid: process.env.TWILIO_OTP_CONTENT_SID ?? "",
  // Comma-separated allowlist of E.164 phones that have joined the Twilio
  // WhatsApp Sandbox (texted "join <keyword>" to +14155238886). When the
  // configured `twilioWhatsappFrom` is the well-known sandbox number,
  // outbound WhatsApp sends to phones NOT in this list are skipped before
  // the Twilio API call — they would fail with error 63015 anyway and
  // burn the sandbox's 50/day quota. Skipped sends are logged with
  // status='failed' and a clear `error_message` explaining why.
  // In production (non-sandbox `twilioWhatsappFrom`), this list is ignored.
  sandboxJoinedPhones: (process.env.SANDBOX_JOINED_PHONES ?? "")
    .split(",")
    .map((s) => s.trim().replace(/[\s\-()]/g, ""))
    .filter(Boolean),

  sendgridApiKey: process.env.SENDGRID_API_KEY ?? "",
  fromEmail: process.env.FROM_EMAIL ?? "noreply@glowos.sg",
  fromName: process.env.FROM_NAME ?? "GlowOS",

  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",

  // Gemini API key for Analytics Digest AI prose suggestions. Optional —
  // when unset the digest gracefully degrades to numeric-only emails.
  // Free tier (Gemini 1.5 Flash): 1500 RPD, 15 RPM, 1M-token context. At
  // pilot scale (~50 merchants × weekly = ~50 calls/week) we sit far
  // under any limit.
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",

  // Comma-separated allowlist of emails granted superadmin at login.
  // See docs/superpowers/specs/2026-04-22-superadmin-design.md.
  superAdminEmails: (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // BullMQ queue prefix — isolates dev and prod workers even when they share
  // the same Redis instance. Without a distinct prefix, a local `pnpm dev`
  // worker can steal prod jobs (and vice versa), causing e.g. WhatsApp
  // notifications to render with localhost URLs.
  //
  // Default is NODE_ENV-aware so nobody has to remember to set a local
  // override: production processes use "glowos", everything else uses
  // "dev-glowos". Explicit QUEUE_PREFIX still wins.
  queuePrefix:
    process.env.QUEUE_PREFIX ??
    (process.env.NODE_ENV === "production" ? "glowos" : "dev-glowos"),

  nodeEnv: process.env.NODE_ENV ?? "development",
} as const;

export function isSuperAdminEmail(email: string): boolean {
  return config.superAdminEmails.includes(email.trim().toLowerCase());
}
