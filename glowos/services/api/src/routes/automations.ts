// Owner/manager-gated CRUD on automation rules. One row per (merchant, kind);
// upsert semantics on PUT.
import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { db, automations, automationKind, automationSends, clients } from "@glowos/db";
import type { AutomationKind } from "@glowos/db";
import { handleBirthday, handleWinback, handleRebook } from "../workers/automation.worker.js";
import { requireMerchant } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import type { AppVariables } from "../lib/types.js";

const automationsRouter = new Hono<{ Variables: AppVariables }>();

// ─── Auth guard ────────────────────────────────────────────────────────────────

automationsRouter.use("*", requireMerchant);
automationsRouter.use("*", async (c, next) => {
  const role = c.get("userRole");
  if (role !== "owner" && role !== "manager") {
    return c.json({ error: "Forbidden", message: "Owner or manager only" }, 403);
  }
  await next();
});

// ─── Default shapes for each kind (returned when no DB row exists yet) ─────────

const KIND_DEFAULTS: Record<AutomationKind, { config: Record<string, unknown>; messageTemplate: string }> = {
  birthday: {
    config: { sendDaysBefore: 0 },
    messageTemplate:
      "Happy Birthday {{name}}! 🎂 As a special gift from {{merchantName}}, enjoy a treat on your next visit. Use code {{promoCode}} to redeem.",
  },
  winback: {
    config: { afterDays: 90 },
    messageTemplate:
      "Hi {{name}}, we miss you at {{merchantName}}! It's been a while — come back and use {{promoCode}} for a special welcome-back offer.",
  },
  rebook: {
    config: { defaultAfterDays: 30 },
    messageTemplate:
      "Hi {{name}}, it's time to book your next appointment at {{merchantName}}! Use {{promoCode}} to save on your next visit.",
  },
};

// ─── GET /merchant/automations ─────────────────────────────────────────────────
// List all 3 automation rules; surface defaults for kinds not yet saved to DB.

automationsRouter.get("/", async (c) => {
  const merchantId = c.get("merchantId")!;

  const rows = await db
    .select()
    .from(automations)
    .where(eq(automations.merchantId, merchantId));

  const byKind = new Map(rows.map((r) => [r.kind as AutomationKind, r]));

  const result = automationKind.map((kind) => {
    const row = byKind.get(kind);
    if (row) return row;
    // Return a not-yet-persisted default shape
    return {
      id: null,
      merchantId,
      kind,
      enabled: false,
      messageTemplate: KIND_DEFAULTS[kind].messageTemplate,
      promoCode: null,
      config: KIND_DEFAULTS[kind].config,
      lastRunAt: null,
      createdAt: null,
      updatedAt: null,
    };
  });

  return c.json({ automations: result });
});

// ─── PUT /merchant/automations/:kind ──────────────────────────────────────────
// Upsert. Body: { enabled, messageTemplate, promoCode?, config }

const updateSchema = z
  .object({
    enabled: z.boolean(),
    messageTemplate: z.string().max(2000),
    promoCode: z.string().trim().max(50).nullable().optional(),
    config: z.record(z.unknown()),
  })
  .strict();

automationsRouter.put("/:kind", zValidator(updateSchema), async (c) => {
  const kind = c.req.param("kind");
  if (!automationKind.includes(kind as AutomationKind)) {
    return c.json({ error: "Bad Request", message: "Unknown kind" }, 400);
  }

  const merchantId = c.get("merchantId")!;
  const body = c.get("body") as z.infer<typeof updateSchema>;

  const now = new Date();

  const [row] = await db
    .insert(automations)
    .values({
      merchantId,
      kind: kind as AutomationKind,
      enabled: body.enabled,
      messageTemplate: body.messageTemplate,
      promoCode: body.promoCode ?? null,
      config: body.config,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [automations.merchantId, automations.kind],
      set: {
        enabled: body.enabled,
        messageTemplate: body.messageTemplate,
        promoCode: body.promoCode ?? null,
        config: body.config,
        updatedAt: now,
      },
    })
    .returning();

  // Fire the matching handler immediately when the rule is saved as enabled,
  // so a merchant who flips the toggle on at 14:00 doesn't have to wait until
  // tomorrow's cron to catch today's matches. Dedupe makes this idempotent.
  let firedSent: number | undefined = undefined;
  if (row.enabled) {
    try {
      switch (kind as AutomationKind) {
        case "birthday":
          firedSent = await handleBirthday(row);
          break;
        case "winback":
          firedSent = await handleWinback(row);
          break;
        case "rebook":
          firedSent = await handleRebook(row);
          break;
      }
      if (firedSent !== undefined) {
        await db
          .update(automations)
          .set({ lastRunAt: new Date() })
          .where(eq(automations.id, row.id));
      }
    } catch (err) {
      // Don't fail the save if the immediate fire blows up — the hourly cron
      // will retry. Just log so we know.
      console.error("[automations] save-time fire failed", { kind, err });
    }
  }

  return c.json({ automation: row, sentOnSave: firedSent });
});

// ─── GET /merchant/automations/:kind/sends ─────────────────────────────────────
// Recent sends for one automation, joined with the client name. Default limit
// 50, max 200. Use this to show "who got what" history per automation card.

automationsRouter.get("/:kind/sends", async (c) => {
  const merchantId = c.get("merchantId")!;
  const kind = c.req.param("kind");
  if (!automationKind.includes(kind as AutomationKind)) {
    return c.json({ error: "Bad Request", message: "Unknown kind" }, 400);
  }
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50));

  const [rule] = await db
    .select({ id: automations.id })
    .from(automations)
    .where(and(eq(automations.merchantId, merchantId), eq(automations.kind, kind as AutomationKind)))
    .limit(1);
  if (!rule) {
    return c.json({ sends: [] });
  }

  const rows = await db
    .select({
      id: automationSends.id,
      sentAt: automationSends.sentAt,
      channel: automationSends.channel,
      clientId: automationSends.clientId,
      clientName: clients.name,
      clientPhone: clients.phone,
      bookingId: automationSends.bookingId,
    })
    .from(automationSends)
    .leftJoin(clients, eq(automationSends.clientId, clients.id))
    .where(eq(automationSends.automationId, rule.id))
    .orderBy(desc(automationSends.sentAt))
    .limit(limit);

  return c.json({ sends: rows });
});

// ─── POST /merchant/automations/:kind/run-now ──────────────────────────────────
// Synchronously fires the automation's handler against this merchant's
// matching clients RIGHT NOW (vs waiting for the daily 01:05 UTC cron).
// Useful for testing + on-demand catch-up. Owner/manager only (the router
// guard above already enforces).

automationsRouter.post("/:kind/run-now", async (c) => {
  const merchantId = c.get("merchantId")!;
  const kind = c.req.param("kind") as AutomationKind;
  if (!automationKind.includes(kind)) {
    return c.json({ error: "Bad Request", message: "Unknown automation kind" }, 400);
  }

  const [row] = await db
    .select()
    .from(automations)
    .where(and(eq(automations.merchantId, merchantId), eq(automations.kind, kind)))
    .limit(1);

  if (!row) {
    return c.json(
      { error: "Conflict", message: "Automation not configured yet — save settings first." },
      409,
    );
  }
  if (!row.enabled) {
    return c.json(
      { error: "Conflict", message: "Automation is disabled. Enable it before running." },
      409,
    );
  }

  let sent = 0;
  switch (kind) {
    case "birthday":
      sent = await handleBirthday(row);
      break;
    case "winback":
      sent = await handleWinback(row);
      break;
    case "rebook":
      sent = await handleRebook(row);
      break;
  }

  await db
    .update(automations)
    .set({ lastRunAt: new Date() })
    .where(eq(automations.id, row.id));

  return c.json({ sent });
});

export { automationsRouter };
