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

  sendgridApiKey: process.env.SENDGRID_API_KEY ?? "",
  fromEmail: process.env.FROM_EMAIL ?? "noreply@glowos.sg",
  fromName: process.env.FROM_NAME ?? "GlowOS",

  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",

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
  queuePrefix: process.env.QUEUE_PREFIX ?? "glowos",

  nodeEnv: process.env.NODE_ENV ?? "development",
} as const;

export function isSuperAdminEmail(email: string): boolean {
  return config.superAdminEmails.includes(email.trim().toLowerCase());
}
