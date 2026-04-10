import { Hono } from "hono";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  campaigns,
  campaignMessages,
  clientProfiles,
  clients,
} from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import type { AppVariables } from "../lib/types.js";

const campaignsRouter = new Hono<{ Variables: AppVariables }>();

// ─── Schemas ───────────────────────────────────────────────────────────────────

const audienceFilterSchema = z
  .object({
    vip_tiers: z
      .array(z.enum(["bronze", "silver", "gold", "platinum"]))
      .optional(),
    overdue_days: z.number().int().positive().optional(),
  })
  .optional();

const createCampaignSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["winback", "birthday", "seasonal", "vip", "new_service", "custom"]),
  audience_filter: audienceFilterSchema,
  message_template: z.string().optional(),
  promo_code: z.string().optional(),
  scheduled_at: z.string().datetime().optional(),
});

// ─── GET /merchant/campaigns ───────────────────────────────────────────────────

campaignsRouter.get("/", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId");

  const rows = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.merchantId, merchantId))
    .orderBy(desc(campaigns.createdAt));

  return c.json({ campaigns: rows });
});

// ─── POST /merchant/campaigns ──────────────────────────────────────────────────

campaignsRouter.post(
  "/",
  requireMerchant,
  zValidator(createCampaignSchema),
  async (c) => {
    const merchantId = c.get("merchantId");
    const body = c.get("body") as z.infer<typeof createCampaignSchema>;

    const [campaign] = await db
      .insert(campaigns)
      .values({
        merchantId,
        name: body.name,
        type: body.type,
        status: "draft",
        audienceFilter: body.audience_filter ?? null,
        messageTemplate: body.message_template ?? null,
        promoCode: body.promo_code ?? null,
        scheduledAt: body.scheduled_at ? new Date(body.scheduled_at) : null,
      })
      .returning();

    if (!campaign) {
      return c.json(
        { error: "Internal Server Error", message: "Failed to create campaign" },
        500
      );
    }

    return c.json({ campaign }, 201);
  }
);

// ─── GET /merchant/campaigns/:id ──────────────────────────────────────────────

campaignsRouter.get("/:id", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId");
  const campaignId = c.req.param("id")!;

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(
      and(eq(campaigns.id, campaignId), eq(campaigns.merchantId, merchantId))
    )
    .limit(1);

  if (!campaign) {
    return c.json({ error: "Not Found", message: "Campaign not found" }, 404);
  }

  const messages = await db
    .select({
      message: campaignMessages,
      client: {
        id: clients.id,
        name: clients.name,
        phone: clients.phone,
      },
    })
    .from(campaignMessages)
    .innerJoin(clients, eq(campaignMessages.clientId, clients.id))
    .where(eq(campaignMessages.campaignId, campaignId));

  return c.json({ campaign, messages });
});

// ─── POST /merchant/campaigns/:id/send ────────────────────────────────────────

campaignsRouter.post("/:id/send", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId");
  const campaignId = c.req.param("id")!;

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(
      and(eq(campaigns.id, campaignId), eq(campaigns.merchantId, merchantId))
    )
    .limit(1);

  if (!campaign) {
    return c.json({ error: "Not Found", message: "Campaign not found" }, 404);
  }

  if (campaign.status !== "draft" && campaign.status !== "scheduled") {
    return c.json(
      {
        error: "Conflict",
        message: `Cannot send a campaign with status: ${campaign.status}`,
      },
      409
    );
  }

  // ── Build audience filter conditions ──────────────────────────────────────
  const filter = campaign.audienceFilter as {
    vip_tiers?: string[];
    overdue_days?: number;
  } | null;

  const profileConditions = [
    eq(clientProfiles.merchantId, merchantId),
    eq(clientProfiles.marketingOptIn, true),
  ];

  if (filter?.vip_tiers && filter.vip_tiers.length > 0) {
    profileConditions.push(
      inArray(
        clientProfiles.vipTier,
        filter.vip_tiers as [string, ...string[]]
      )
    );
  }

  if (filter?.overdue_days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - filter.overdue_days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    profileConditions.push(lte(clientProfiles.lastVisitDate, cutoffStr));
  }

  const profileRows = await db
    .select({
      clientId: clientProfiles.clientId,
    })
    .from(clientProfiles)
    .where(and(...profileConditions));

  const now = new Date();
  const template = campaign.messageTemplate ?? "Hi {first_name}, we miss you!";

  if (profileRows.length > 0) {
    // Load client names for personalisation
    const clientIds = profileRows.map((r) => r.clientId);
    const clientRows = await db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(inArray(clients.id, clientIds));

    const clientMap = new Map(clientRows.map((r) => [r.id, r.name]));

    const messageValues = profileRows.map((r) => {
      const firstName = (clientMap.get(r.clientId) ?? "").split(" ")[0] ?? "there";
      const body = template.replace("{first_name}", firstName);
      return {
        campaignId,
        clientId: r.clientId,
        messageBody: body,
        status: "sent" as const,
        sentAt: now,
      };
    });

    // Insert in batches of 500 to avoid huge single inserts
    const batchSize = 500;
    for (let i = 0; i < messageValues.length; i += batchSize) {
      await db.insert(campaignMessages).values(messageValues.slice(i, i + batchSize));
    }
  }

  const [updated] = await db
    .update(campaigns)
    .set({
      status: "sent",
      sentAt: now,
      recipientsCount: profileRows.length,
    })
    .where(eq(campaigns.id, campaignId))
    .returning();

  return c.json({
    campaign: updated,
    recipients_count: profileRows.length,
    message: "Campaign sent successfully",
  });
});

// ─── GET /merchant/campaigns/:id/results ──────────────────────────────────────

campaignsRouter.get("/:id/results", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId");
  const campaignId = c.req.param("id")!;

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(
      and(eq(campaigns.id, campaignId), eq(campaigns.merchantId, merchantId))
    )
    .limit(1);

  if (!campaign) {
    return c.json({ error: "Not Found", message: "Campaign not found" }, 404);
  }

  const messages = await db
    .select({
      message: campaignMessages,
      client: {
        id: clients.id,
        name: clients.name,
        phone: clients.phone,
      },
    })
    .from(campaignMessages)
    .innerJoin(clients, eq(campaignMessages.clientId, clients.id))
    .where(eq(campaignMessages.campaignId, campaignId));

  // Compute live stats from messages table
  const sent = messages.length;
  const delivered = messages.filter(
    (m) => m.message.deliveredAt !== null
  ).length;
  const clicked = messages.filter((m) => m.message.clickedAt !== null).length;
  const converted = messages.filter(
    (m) => m.message.convertedAt !== null
  ).length;
  const revenueAttributed = campaign.revenueAttributedSgd
    ? parseFloat(String(campaign.revenueAttributedSgd))
    : 0;

  const stats = { sent, delivered, clicked, converted, revenueAttributed };

  return c.json({ campaign, messages, stats });
});

export { campaignsRouter };
