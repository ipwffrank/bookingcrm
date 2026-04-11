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
import { paymentsRouter } from "./routes/payments.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { analyticsRouter } from "./routes/analytics.js";
import { campaignsRouter } from "./routes/campaigns.js";
import type { AppVariables } from "./lib/types.js";
import { config } from "./lib/config.js";
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

// ─── Routes ────────────────────────────────────────────────────────────────────

// IMPORTANT: Stripe webhook route must be mounted BEFORE global JSON middleware
// (if any is added later) because Stripe requires the raw, un-parsed body for
// signature verification. Hono reads the body lazily so this ordering ensures
// webhooksRouter.post("/stripe") always receives the raw body via c.req.text().
app.route("/webhooks", webhooksRouter);

app.route("/auth", auth);
app.route("/merchant", merchantRouter);
app.route("/merchant/services", servicesRouter);
app.route("/merchant/staff", staffRouter);
app.route("/merchant/clients", clientsRouter);
app.route("/merchant/analytics", analyticsRouter);
app.route("/merchant/campaigns", campaignsRouter);
app.route("/merchant/bookings", merchantBookingsRouter);
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
app.route("/booking", paymentsRouter);

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

console.log(`GlowOS API running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});

// ─── Workers ───────────────────────────────────────────────────────────────────
// In development, run workers in the same process for convenience.
// In production, workers are started as a separate process (e.g. src/workers/index.ts).

if (config.nodeEnv === "development") {
  startWorkers();
}

export default app;
