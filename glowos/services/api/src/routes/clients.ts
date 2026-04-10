import { Hono } from "hono";
import { and, eq, ilike, or, desc } from "drizzle-orm";
import { z } from "zod";
import { db, clients, clientProfiles, bookings, services, staff } from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import type { AppVariables } from "../lib/types.js";

const clientsRouter = new Hono<{ Variables: AppVariables }>();

// ─── Schemas ───────────────────────────────────────────────────────────────────

const updateClientNotesSchema = z.object({
  notes: z.string().optional(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "birthday must be YYYY-MM-DD").optional(),
});

// ─── GET /merchant/clients ─────────────────────────────────────────────────────

clientsRouter.get("/", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId");
  const tierParam = c.req.query("tier");
  const searchParam = c.req.query("search");
  const churnRiskParam = c.req.query("churn_risk");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  // Build conditions for client_profiles (merchant-scoped)
  const profileConditions = [eq(clientProfiles.merchantId, merchantId)];

  if (tierParam) {
    profileConditions.push(
      eq(clientProfiles.vipTier, tierParam as "bronze" | "silver" | "gold" | "platinum")
    );
  }

  if (churnRiskParam) {
    profileConditions.push(
      eq(clientProfiles.churnRisk, churnRiskParam as "low" | "medium" | "high")
    );
  }

  // Base query joining profiles with clients
  let rows = await db
    .select({
      profile: clientProfiles,
      client: clients,
    })
    .from(clientProfiles)
    .innerJoin(clients, eq(clientProfiles.clientId, clients.id))
    .where(and(...profileConditions))
    .limit(limit)
    .offset(offset);

  // Apply search filter in-memory (or via ilike for phone/name/email)
  if (searchParam) {
    const term = searchParam.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.client.name?.toLowerCase().includes(term) ||
        r.client.phone.includes(term) ||
        r.client.email?.toLowerCase().includes(term)
    );
  }

  return c.json({
    clients: rows,
    pagination: { limit, offset, count: rows.length },
  });
});

// ─── GET /merchant/clients/:id ────────────────────────────────────────────────

clientsRouter.get("/:id", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId");
  const profileId = c.req.param("id")!;

  const [row] = await db
    .select({
      profile: clientProfiles,
      client: clients,
    })
    .from(clientProfiles)
    .innerJoin(clients, eq(clientProfiles.clientId, clients.id))
    .where(
      and(eq(clientProfiles.id, profileId), eq(clientProfiles.merchantId, merchantId))
    )
    .limit(1);

  if (!row) {
    return c.json({ error: "Not Found", message: "Client not found" }, 404);
  }

  // Last 10 bookings for this client+merchant
  const recentBookings = await db
    .select({
      booking: bookings,
      service: services,
      staffMember: staff,
    })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .innerJoin(staff, eq(bookings.staffId, staff.id))
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        eq(bookings.clientId, row.profile.clientId)
      )
    )
    .orderBy(desc(bookings.startTime))
    .limit(10);

  return c.json({
    profile: row.profile,
    client: row.client,
    recent_bookings: recentBookings,
  });
});

// ─── PUT /merchant/clients/:id/notes ──────────────────────────────────────────

clientsRouter.put(
  "/:id/notes",
  requireMerchant,
  zValidator(updateClientNotesSchema),
  async (c) => {
    const merchantId = c.get("merchantId");
    const profileId = c.req.param("id")!;
    const body = c.get("body") as z.infer<typeof updateClientNotesSchema>;

    const [existing] = await db
      .select({ id: clientProfiles.id })
      .from(clientProfiles)
      .where(
        and(eq(clientProfiles.id, profileId), eq(clientProfiles.merchantId, merchantId))
      )
      .limit(1);

    if (!existing) {
      return c.json({ error: "Not Found", message: "Client not found" }, 404);
    }

    const updateData: Partial<typeof clientProfiles.$inferInsert> = {};
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (body.birthday !== undefined) updateData.birthday = body.birthday;
    updateData.updatedAt = new Date();

    const [updated] = await db
      .update(clientProfiles)
      .set(updateData)
      .where(
        and(eq(clientProfiles.id, profileId), eq(clientProfiles.merchantId, merchantId))
      )
      .returning();

    return c.json({ profile: updated });
  }
);

export { clientsRouter };
