import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { auth } from "./routes/auth.js";
import { merchantRouter } from "./routes/merchant.js";
import { servicesRouter } from "./routes/services.js";
import { staffRouter } from "./routes/staff.js";
import { bookingsRouter } from "./routes/bookings.js";
import { clientsRouter } from "./routes/clients.js";
import type { AppVariables } from "./lib/types.js";

const app = new Hono<{ Variables: AppVariables }>();

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: [
      process.env.FRONTEND_URL ?? "http://localhost:3000",
      process.env.DASHBOARD_URL ?? "http://localhost:3002",
    ],
    credentials: true,
  })
);

// ─── Routes ────────────────────────────────────────────────────────────────────

app.route("/auth", auth);
app.route("/merchant", merchantRouter);
app.route("/merchant/services", servicesRouter);
app.route("/merchant/staff", staffRouter);
app.route("/merchant/clients", clientsRouter);
app.route("/booking", bookingsRouter);

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

export default app;
