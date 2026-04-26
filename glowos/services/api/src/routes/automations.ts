// Owner/manager-gated CRUD on automation rules. One row per (merchant, kind);
// upsert semantics on PUT.
import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, automations, automationKind } from "@glowos/db";
import type { AutomationKind } from "@glowos/db";
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

  return c.json({ automation: row });
});

export { automationsRouter };
