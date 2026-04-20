import { Hono } from "hono";
import { and, eq, ilike, or, desc, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, clients, clientProfiles, bookings, services, staff, clientPackages, packageSessions } from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import type { AppVariables } from "../lib/types.js";
import { normalizePhone } from "../lib/normalize.js";

const clientsRouter = new Hono<{ Variables: AppVariables }>();

// ─── Schemas ───────────────────────────────────────────────────────────────────

const updateClientNotesSchema = z.object({
  notes: z.string().optional(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "birthday must be YYYY-MM-DD").optional(),
});

// ─── GET /merchant/clients ─────────────────────────────────────────────────────

clientsRouter.get("/", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
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
      noShowCount: sql<number>`cast((
        SELECT COUNT(*) FROM ${bookings}
        WHERE ${bookings.clientId} = ${clients.id}
          AND ${bookings.merchantId} = ${merchantId}
          AND ${bookings.status} = 'no_show'
      ) as int)`,
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

  // Compute spending stats from bookings for each client
  const clientIds = rows.map((r) => r.profile.clientId);
  let spendingMap = new Map<
    string,
    { totalSpendSgd: string; totalVisits: number; lastVisitAt: string | null }
  >();

  if (clientIds.length > 0) {
    const spendingRows = await db
      .select({
        clientId: bookings.clientId,
        totalSpendSgd: sql<string>`coalesce(sum(cast(${bookings.priceSgd} as numeric)), 0)`,
        totalVisits: sql<number>`cast(count(*) as int)`,
        lastVisitAt: sql<string>`max(${bookings.startTime})`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.merchantId, merchantId),
          sql`${bookings.clientId} IN (${sql.join(
            clientIds.map((id) => sql`${id}::uuid`),
            sql`, `
          )})`,
          sql`${bookings.status} NOT IN ('cancelled', 'no_show')`
        )
      )
      .groupBy(bookings.clientId);

    for (const row of spendingRows) {
      spendingMap.set(row.clientId, {
        totalSpendSgd: String(row.totalSpendSgd),
        totalVisits: Number(row.totalVisits),
        lastVisitAt: row.lastVisitAt ? String(row.lastVisitAt) : null,
      });
    }
  }

  // Enrich profiles with computed spending data
  const enrichedRows = rows.map((r) => {
    const spending = spendingMap.get(r.profile.clientId);
    return {
      profile: {
        ...r.profile,
        totalSpendSgd: spending?.totalSpendSgd ?? "0",
        totalVisits: spending?.totalVisits ?? 0,
        lastVisitAt: spending?.lastVisitAt ?? null,
      },
      client: r.client,
      noShowCount: Number(r.noShowCount ?? 0),
    };
  });

  // Total count (before pagination) for accurate tier counts
  const [totalRow] = await db
    .select({ total: sql<number>`cast(count(*) as int)` })
    .from(clientProfiles)
    .where(and(...profileConditions));
  const total = Number(totalRow?.total ?? 0);

  return c.json({
    clients: enrichedRows,
    pagination: { limit, offset, count: enrichedRows.length, total },
  });
});

// ─── GET /merchant/clients/lookup ────────────────────────────────────────────
// Look up a client by phone number and return active packages

clientsRouter.get("/lookup", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const rawPhone = c.req.query("phone") ?? "";
  const phone = normalizePhone(rawPhone, "SG");
  if (!phone) return c.json({ client: null, activePackages: [] });

  const [client] = await db
    .select({ id: clients.id, name: clients.name, phone: clients.phone })
    .from(clients)
    .where(eq(clients.phone, phone))
    .limit(1);
  if (!client) return c.json({ client: null, activePackages: [] });

  const active = await db
    .select()
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.clientId, client.id),
        eq(clientPackages.merchantId, merchantId),
        eq(clientPackages.status, "active")
      )
    );
  const pkgIds = active.map((p) => p.id);
  const sessions = pkgIds.length
    ? await db
        .select({
          id: packageSessions.id,
          clientPackageId: packageSessions.clientPackageId,
          serviceId: packageSessions.serviceId,
          sessionNumber: packageSessions.sessionNumber,
        })
        .from(packageSessions)
        .where(
          and(
            inArray(packageSessions.clientPackageId, pkgIds),
            eq(packageSessions.status, "pending")
          )
        )
    : [];

  const [nsRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(bookings)
    .where(
      and(
        eq(bookings.clientId, client.id),
        eq(bookings.merchantId, merchantId),
        eq(bookings.status, "no_show")
      )
    );
  const noShowCount = Number(nsRow?.count ?? 0);

  return c.json({
    client: { ...client, noShowCount },
    activePackages: active.map((p) => ({
      id: p.id,
      packageName: p.packageName,
      sessionsTotal: p.sessionsTotal,
      sessionsUsed: p.sessionsUsed,
      expiresAt: p.expiresAt,
      pendingSessions: sessions.filter((s) => s.clientPackageId === p.id),
    })),
  });
});

// ─── GET /merchant/clients/for-client/:clientId ──────────────────────────────
// Look up a client profile by the global clientId (used by calendar/booking drawer).
// Must be defined before /:id to avoid Hono treating "for-client" as an id param.

clientsRouter.get("/for-client/:clientId", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const clientId   = c.req.param("clientId")!;

  const [row] = await db
    .select({ profile: clientProfiles, client: clients })
    .from(clientProfiles)
    .innerJoin(clients, eq(clientProfiles.clientId, clients.id))
    .where(and(eq(clientProfiles.clientId, clientId), eq(clientProfiles.merchantId, merchantId)))
    .limit(1);

  if (!row) {
    return c.json({ error: "Not Found", message: "Client profile not found" }, 404);
  }

  // Run spending stats + service history in parallel
  const [spendingStatsResult, serviceHistoryResult] = await Promise.all([
    db
      .select({
        totalSpendSgd: sql<string>`coalesce(sum(cast(${bookings.priceSgd} as numeric)), 0)`,
        totalVisits:   sql<number>`cast(count(*) as int)`,
        lastVisitAt:   sql<string>`max(${bookings.startTime})`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.merchantId, merchantId),
          eq(bookings.clientId, clientId),
          sql`${bookings.status} NOT IN ('cancelled', 'no_show')`
        )
      ),

    // Last 10 completed bookings with service name, staff name, date, price
    db
      .select({
        serviceName: services.name,
        staffName:   staff.name,
        date:        bookings.startTime,
        price:       bookings.priceSgd,
        status:      bookings.status,
      })
      .from(bookings)
      .leftJoin(services, eq(bookings.serviceId, services.id))
      .leftJoin(staff, eq(bookings.staffId, staff.id))
      .where(
        and(
          eq(bookings.merchantId, merchantId),
          eq(bookings.clientId, clientId),
          sql`${bookings.status} NOT IN ('cancelled', 'no_show')`
        )
      )
      .orderBy(desc(bookings.startTime))
      .limit(10),
  ]);

  const spendingStats = spendingStatsResult[0];

  return c.json({
    profile: {
      ...row.profile,
      totalSpendSgd: String(spendingStats?.totalSpendSgd ?? "0"),
      totalVisits:   Number(spendingStats?.totalVisits ?? 0),
      lastVisitAt:   spendingStats?.lastVisitAt ? String(spendingStats.lastVisitAt) : null,
    },
    client: row.client,
    serviceHistory: serviceHistoryResult,
  });
});

// ─── GET /merchant/clients/:id ────────────────────────────────────────────────

clientsRouter.get("/:id", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
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

  // Compute spending stats from bookings for this client
  const [spendingStats] = await db
    .select({
      totalSpendSgd: sql<string>`coalesce(sum(cast(${bookings.priceSgd} as numeric)), 0)`,
      totalVisits: sql<number>`cast(count(*) as int)`,
      lastVisitAt: sql<string>`max(${bookings.startTime})`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        eq(bookings.clientId, row.profile.clientId),
        sql`${bookings.status} NOT IN ('cancelled', 'no_show')`
      )
    );

  const [nsRow] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(bookings)
    .where(
      and(
        eq(bookings.clientId, row.profile.clientId),
        eq(bookings.merchantId, merchantId),
        eq(bookings.status, "no_show")
      )
    );
  const noShowCount = Number(nsRow?.count ?? 0);

  return c.json({
    profile: {
      ...row.profile,
      totalSpendSgd: String(spendingStats?.totalSpendSgd ?? "0"),
      totalVisits: Number(spendingStats?.totalVisits ?? 0),
      lastVisitAt: spendingStats?.lastVisitAt ? String(spendingStats.lastVisitAt) : null,
    },
    client: row.client,
    recent_bookings: recentBookings,
    noShowCount,
  });
});

// ─── PUT /merchant/clients/:id/notes ──────────────────────────────────────────

clientsRouter.put(
  "/:id/notes",
  requireMerchant,
  zValidator(updateClientNotesSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
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

// ─── POST /merchant/clients/import ────────────────────────────────────────────
// Accepts a JSON array of client records (parsed from CSV by the frontend)

const importClientSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  notes: z.string().optional(),
  birthday: z.string().optional(),
});

const importBatchSchema = z.object({
  clients: z.array(importClientSchema).min(1).max(500),
});

clientsRouter.post("/import", requireMerchant, zValidator(importBatchSchema), async (c) => {
  const merchantId = c.get("merchantId")!;
  const body = c.get("body") as z.infer<typeof importBatchSchema>;

  const results = {
    created: 0,
    skipped: 0,
    errors: [] as { phone: string; reason: string }[],
  };

  for (const record of body.clients) {
    try {
      // Check if client already exists by phone
      const [existing] = await db
        .select()
        .from(clients)
        .where(eq(clients.phone, record.phone))
        .limit(1);

      let clientId: string;

      if (existing) {
        clientId = existing.id;
        // Update name/email if currently null
        if (!existing.name && record.name) {
          await db.update(clients).set({ name: record.name }).where(eq(clients.id, existing.id));
        }
      } else {
        const [created] = await db
          .insert(clients)
          .values({
            phone: record.phone,
            email: record.email || null,
            name: record.name,
            acquisitionSource: "import",
          })
          .returning();
        clientId = created.id;
      }

      // Ensure client profile exists for this merchant
      const [existingProfile] = await db
        .select()
        .from(clientProfiles)
        .where(and(eq(clientProfiles.merchantId, merchantId), eq(clientProfiles.clientId, clientId)))
        .limit(1);

      if (!existingProfile) {
        await db.insert(clientProfiles).values({
          merchantId,
          clientId,
          notes: record.notes ?? null,
          birthday: record.birthday ?? null,
        });
        results.created++; // Always: a new profile (and possibly client) was created
      } else {
        results.skipped++;
      }
    } catch (err) {
      results.errors.push({ phone: record.phone, reason: String(err) });
    }
  }

  return c.json({ results });
});

export { clientsRouter };
