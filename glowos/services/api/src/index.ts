// dotenv is loaded in lib/config.ts (must run before any other imports read env)
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { auth } from "./routes/auth.js";
import { merchantRouter } from "./routes/merchant.js";
import { servicesRouter } from "./routes/services.js";
import { staffRouter } from "./routes/staff.js";
import { bookingsRouter, merchantBookingsRouter } from "./routes/bookings.js";
import { clientsRouter } from "./routes/clients.js";
import { clientNotesRouter } from "./routes/client-notes.js";
import { clinicalRecordsRouter } from "./routes/clinical-records.js";
import { paymentsRouter } from "./routes/payments.js";
import { otpRouter } from "./routes/otp.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { analyticsRouter } from "./routes/analytics.js";
import { analyticsDigestRouter } from "./routes/analytics-digest.js";
import { campaignsRouter } from "./routes/campaigns.js";
import { automationsRouter } from "./routes/automations.js";
import { loyaltyProgramRouter, loyaltyClientRouter } from "./routes/loyalty.js";
import { walkinsRouter } from "./routes/walkins.js";
import { groupRouter } from "./routes/group.js";
import { brandInvitesRouter } from "./routes/brand-invites.js";
import { dutiesRouter } from "./routes/duties.js";
import { staffAuthRouter } from "./routes/staff-auth.js";
import { staffPortalRouter } from "./routes/staff-portal.js";
import { customerAuthRouter } from "./routes/customer-auth.js";
import { closuresRouter, publicClosuresRouter } from "./routes/closures.js";
import { publicReviewRouter, merchantReviewRouter } from "./routes/reviews.js";
import { packagesRouter, publicPackagesRouter } from "./routes/packages.js";
import { bookingGroupsRouter } from "./routes/booking-groups.js";
import { waitlistRouter, merchantWaitlistRouter } from "./routes/waitlist.js";
import { superRouter } from "./routes/super.js";
import { merchantIpay88Router, publicIpay88Router } from "./routes/ipay88.js";
import { myinvoisRouter } from "./routes/myinvois.js";
import { invoicesRouter } from "./routes/invoices.js";
import { merchantQuotesRouter, publicQuotesRouter } from "./routes/quotes.js";
import { shortLinksRouter } from "./routes/short-links.js";
import { auditImpersonatedWrites } from "./middleware/impersonation-audit.js";
import type { AppVariables } from "./lib/types.js";
import { startWorkers } from "./workers/index.js";

const app = new Hono<{ Variables: AppVariables }>();

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    credentials: true,
  })
);

// Auto-log every write performed by an impersonating superadmin. Mounted on
// `*` (path filtering happens inside the middleware) so we don't depend on
// Hono's prefix matcher composing correctly with the many `/merchant/*`
// sub-routers below — those mount via app.route which has subtly different
// matching semantics from app.use prefix patterns.
app.use("*", auditImpersonatedWrites);

// ─── Routes ────────────────────────────────────────────────────────────────────

// IMPORTANT: Stripe webhook route must be mounted BEFORE global JSON middleware
// (if any is added later) because Stripe requires the raw, un-parsed body for
// signature verification. Hono reads the body lazily so this ordering ensures
// webhooksRouter.post("/stripe") always receives the raw body via c.req.text().
app.route("/webhooks", webhooksRouter);

app.route("/auth", auth);
app.route("/super", superRouter);
app.route("/merchant", merchantRouter);
app.route("/merchant/services", servicesRouter);
app.route("/merchant/staff", staffRouter);
app.route("/merchant/clients", clientsRouter);
app.route("/merchant/clients", clientNotesRouter);
app.route("/merchant/clients", clinicalRecordsRouter);
app.route("/merchant/analytics", analyticsRouter);
app.route("/merchant/analytics-digest", analyticsDigestRouter);
app.route("/merchant/campaigns", campaignsRouter);
app.route("/merchant/automations", automationsRouter);
app.route("/merchant/loyalty", loyaltyProgramRouter);
app.route("/merchant/clients", loyaltyClientRouter);
app.route("/merchant/bookings/group", bookingGroupsRouter);
app.route("/merchant/bookings", merchantBookingsRouter);
app.route("/merchant/walkins", walkinsRouter);
app.route("/booking", bookingsRouter);

// Payment routes:
//   /merchant/payments/connect-account    → POST  (owner only)
//   /merchant/payments/connect-status     → GET   (owner only)
//   /merchant/payments/connect-dashboard-link → POST (owner only)
//   /merchant/payments/payouts            → GET   (owner only)
//   /merchant/payments/payouts/:id        → GET   (owner only)
//   /merchant/payments/bookings/:id/refund→ POST  (owner, manager)
//   /booking/:slug/create-payment-intent  → POST  (public)
app.route("/merchant/payments", paymentsRouter);
app.route("/merchant/payments/ipay88", merchantIpay88Router);
app.route("/merchant/myinvois", myinvoisRouter);
app.route("/merchant/invoices", invoicesRouter);
app.route("/merchant/quotes", merchantQuotesRouter);
app.route("/quote", publicQuotesRouter);
app.route("/booking", paymentsRouter);
app.route("/booking", publicIpay88Router);
app.route("/booking", otpRouter);
app.route("/group", groupRouter);
app.route("/brand-invite", brandInvitesRouter);
app.route("/merchant/duties", dutiesRouter);
app.route("/merchant/staff", staffAuthRouter);
app.route("/staff", staffPortalRouter);
app.route("/customer-auth", customerAuthRouter);
app.route("/merchant/closures", closuresRouter);
app.route("/booking", publicClosuresRouter);
app.route("/review", publicReviewRouter);
app.route("/merchant/reviews", merchantReviewRouter);
app.route("/merchant/packages", packagesRouter);
app.route("/booking", publicPackagesRouter);
app.route("/waitlist", waitlistRouter);
app.route("/merchant/waitlist", merchantWaitlistRouter);

// Internal URL shortener — public, no auth. Resolves codes minted by
// services/api/src/lib/short-links.ts; called by the Next.js /s/[code] proxy.
app.route("/s", shortLinksRouter);

// Health check
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "glowos-api",
    timestamp: new Date().toISOString(),
    version: "0.1.0",
  });
});

// Root
app.get("/", (c) => {
  return c.json({ message: "GlowOS API", docs: "/health" });
});

// ─── Global error handler ──────────────────────────────────────────────────────

app.onError((err, c) => {
  console.error("[GlowOS API Error]", err);
  return c.json(
    {
      error: "Internal Server Error",
      message:
        process.env.NODE_ENV === "development"
          ? err.message
          : "An unexpected error occurred",
    },
    500
  );
});

app.notFound((c) => {
  return c.json(
    { error: "Not Found", message: `Route ${c.req.method} ${c.req.path} not found` },
    404
  );
});

// ─── Start server ──────────────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 3001);

// ─── Boot-time env presence check ────────────────────────────────────────
// Logs which expected env vars are present inside this container's
// process.env. Names only — never values, so it's safe to keep in prod.
// Useful when an integration silently degrades because a var didn't make
// it into the runtime (e.g. Railway scoping, hidden Unicode in name,
// reference-variable interpolation failing). Compare with the values
// shown in Railway's Variables tab.
const envCheck = {
  DATABASE_URL: !!process.env.DATABASE_URL,
  REDIS_URL: !!process.env.REDIS_URL,
  JWT_SECRET: !!process.env.JWT_SECRET,
  SENDGRID_API_KEY: !!process.env.SENDGRID_API_KEY,
  TWILIO_ACCOUNT_SID: !!process.env.TWILIO_ACCOUNT_SID,
  STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
  GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
  GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
  BLOB_READ_WRITE_TOKEN: !!process.env.BLOB_READ_WRITE_TOKEN,
  FRONTEND_URL: !!process.env.FRONTEND_URL,
  APP_URL: !!process.env.APP_URL,
  FROM_EMAIL: !!process.env.FROM_EMAIL,
  NODE_ENV: process.env.NODE_ENV ?? "(unset)",
  // Total var count gives one more sanity check — if it's < 5, something
  // is clearly wrong with how vars are reaching the container.
  total_env_keys: Object.keys(process.env).length,
};
console.log("[Boot] env presence check:", JSON.stringify(envCheck));

console.log(`GlowOS API running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});

// ─── Workers ───────────────────────────────────────────────────────────────────
// In development, run workers in the same process for convenience.
// In production, workers are started as a separate process (e.g. src/workers/index.ts).

// Start workers when Redis is available.
// In production, REDIS_URL must be explicitly set (e.g. Upstash) for workers to run.
// Without REDIS_URL the process won't crash — workers are simply skipped.
if (process.env.REDIS_URL) {
  startWorkers();
} else {
  console.warn("[Workers] REDIS_URL not set — background workers disabled");
}

export default app;
