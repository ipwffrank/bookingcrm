import { Hono } from "hono";
import { eq, and, desc, sql, or } from "drizzle-orm";
import {
  db,
  servicePackages,
  clientPackages,
  packageSessions,
  services,
  clients,
  merchants,
} from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import type { AppVariables } from "../lib/types.js";

export const packagesRouter = new Hono<{ Variables: AppVariables }>();
export const publicPackagesRouter = new Hono<{ Variables: AppVariables }>();

// ─── Package Templates ───────────────────────────────────────────────────────

// GET /merchant/packages — list templates
packagesRouter.get("/", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const rows = await db
    .select()
    .from(servicePackages)
    .where(
      and(
        eq(servicePackages.merchantId, merchantId),
        eq(servicePackages.isActive, true)
      )
    )
    .orderBy(desc(servicePackages.createdAt));
  return c.json({ packages: rows });
});

// POST /merchant/packages — create template
packagesRouter.post("/", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const body = await c.req.json<{
    name: string;
    description?: string;
    totalSessions: number;
    priceSgd: number;
    includedServices: Array<{
      serviceId: string;
      serviceName: string;
      quantity: number;
    }>;
    validityDays?: number;
  }>();

  if (
    !body.name ||
    !body.totalSessions ||
    !body.priceSgd ||
    !body.includedServices?.length
  ) {
    return c.json(
      {
        error: "Bad Request",
        message:
          "name, totalSessions, priceSgd, and includedServices are required",
      },
      400
    );
  }

  const [pkg] = await db
    .insert(servicePackages)
    .values({
      merchantId,
      name: body.name,
      description: body.description || null,
      totalSessions: body.totalSessions,
      priceSgd: String(body.priceSgd),
      includedServices: body.includedServices,
      validityDays: body.validityDays ?? 180,
    })
    .returning();

  return c.json({ package: pkg }, 201);
});

// PUT /merchant/packages/:id — update template
packagesRouter.put("/:id", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const id = c.req.param("id")!;
  const body = await c.req.json();

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.totalSessions !== undefined)
    updateData.totalSessions = body.totalSessions;
  if (body.priceSgd !== undefined)
    updateData.priceSgd = String(body.priceSgd);
  if (body.includedServices !== undefined)
    updateData.includedServices = body.includedServices;
  if (body.validityDays !== undefined)
    updateData.validityDays = body.validityDays;

  const [updated] = await db
    .update(servicePackages)
    .set(updateData)
    .where(
      and(
        eq(servicePackages.id, id),
        eq(servicePackages.merchantId, merchantId)
      )
    )
    .returning();

  if (!updated) return c.json({ error: "Not Found" }, 404);
  return c.json({ package: updated });
});

// DELETE /merchant/packages/:id — soft delete
packagesRouter.delete("/:id", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const id = c.req.param("id")!;
  await db
    .update(servicePackages)
    .set({ isActive: false })
    .where(
      and(
        eq(servicePackages.id, id),
        eq(servicePackages.merchantId, merchantId)
      )
    );
  return c.json({ success: true });
});

// ─── Client Packages ─────────────────────────────────────────────────────────

// GET /merchant/packages/client/:clientId — list packages for a client
packagesRouter.get("/client/:clientId", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const clientId = c.req.param("clientId")!;

  const pkgs = await db
    .select()
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.merchantId, merchantId),
        eq(clientPackages.clientId, clientId)
      )
    )
    .orderBy(desc(clientPackages.purchasedAt));

  // Load sessions for each package
  const result = [];
  for (const pkg of pkgs) {
    const sessions = await db
      .select()
      .from(packageSessions)
      .where(eq(packageSessions.clientPackageId, pkg.id))
      .orderBy(packageSessions.sessionNumber);
    result.push({ ...pkg, sessions });
  }

  return c.json({ packages: result });
});

// POST /merchant/packages/assign — assign package to client
packagesRouter.post("/assign", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const body = await c.req.json<{
    clientId: string;
    packageId: string;
    pricePaidSgd: number;
    notes?: string;
  }>();

  // Load package template
  const [pkg] = await db
    .select()
    .from(servicePackages)
    .where(
      and(
        eq(servicePackages.id, body.packageId),
        eq(servicePackages.merchantId, merchantId)
      )
    )
    .limit(1);

  if (!pkg)
    return c.json(
      { error: "Not Found", message: "Package template not found" },
      404
    );

  // Calculate expiry
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + pkg.validityDays);

  // Create client package
  const [clientPkg] = await db
    .insert(clientPackages)
    .values({
      merchantId,
      clientId: body.clientId,
      packageId: pkg.id,
      packageName: pkg.name,
      sessionsTotal: pkg.totalSessions,
      pricePaidSgd: String(body.pricePaidSgd),
      expiresAt,
      notes: body.notes || null,
    })
    .returning();

  // Pre-generate session rows
  const sessionValues: Array<{
    clientPackageId: string;
    sessionNumber: number;
    serviceId: string;
  }> = [];
  for (const svc of pkg.includedServices) {
    for (let i = 0; i < svc.quantity; i++) {
      sessionValues.push({
        clientPackageId: clientPkg.id,
        sessionNumber: sessionValues.length + 1,
        serviceId: svc.serviceId,
      });
    }
  }

  if (sessionValues.length > 0) {
    await db.insert(packageSessions).values(sessionValues);
  }

  // Load sessions to return
  const sessions = await db
    .select()
    .from(packageSessions)
    .where(eq(packageSessions.clientPackageId, clientPkg.id))
    .orderBy(packageSessions.sessionNumber);

  return c.json({ clientPackage: { ...clientPkg, sessions } }, 201);
});

// PUT /merchant/packages/sessions/:sessionId/complete — mark session completed
packagesRouter.put(
  "/sessions/:sessionId/complete",
  requireMerchant,
  async (c) => {
    const sessionId = c.req.param("sessionId")!;
    const body = await c.req.json<{
      bookingId?: string;
      staffId?: string;
      staffName?: string;
      notes?: string;
    }>();

    const [session] = await db
      .select()
      .from(packageSessions)
      .where(eq(packageSessions.id, sessionId))
      .limit(1);

    if (!session) return c.json({ error: "Not Found" }, 404);

    // Update session
    await db
      .update(packageSessions)
      .set({
        status: "completed",
        completedAt: new Date(),
        bookingId: body.bookingId || null,
        staffId: body.staffId || null,
        staffName: body.staffName || null,
        notes: body.notes || null,
      })
      .where(eq(packageSessions.id, sessionId));

    // Increment sessionsUsed on the client package
    await db
      .update(clientPackages)
      .set({
        sessionsUsed: sql`${clientPackages.sessionsUsed} + 1`,
      })
      .where(eq(clientPackages.id, session.clientPackageId));

    // Check if all sessions complete
    const [pkg] = await db
      .select()
      .from(clientPackages)
      .where(eq(clientPackages.id, session.clientPackageId))
      .limit(1);

    if (pkg && pkg.sessionsUsed >= pkg.sessionsTotal) {
      await db
        .update(clientPackages)
        .set({ status: "completed" })
        .where(eq(clientPackages.id, session.clientPackageId));
    }

    return c.json({ success: true });
  }
);

// PUT /merchant/packages/sessions/:sessionId/notes — update session notes
packagesRouter.put(
  "/sessions/:sessionId/notes",
  requireMerchant,
  async (c) => {
    const sessionId = c.req.param("sessionId")!;
    const body = await c.req.json<{ notes: string }>();

    await db
      .update(packageSessions)
      .set({ notes: body.notes })
      .where(eq(packageSessions.id, sessionId));

    return c.json({ success: true });
  }
);

// ─── Public: check client packages for booking widget ────────────────────────

// GET /booking/:slug/client-packages?phone=X&email=Y — check active packages
publicPackagesRouter.get("/:slug/client-packages", async (c) => {
  const slug = c.req.param("slug")!;
  const phone = c.req.query("phone");
  const email = c.req.query("email");

  if (!phone && !email) return c.json({ packages: [] });

  // Find merchant
  const [merchant] = await db
    .select({ id: merchants.id })
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);
  if (!merchant) return c.json({ packages: [] });

  // Find client
  const conditions = [];
  if (phone) conditions.push(eq(clients.phone, phone));
  if (email) conditions.push(eq(clients.email, email));

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(or(...conditions))
    .limit(1);

  if (!client) return c.json({ packages: [] });

  // Find active packages with remaining sessions
  const pkgs = await db
    .select()
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.clientId, client.id),
        eq(clientPackages.merchantId, merchant.id),
        eq(clientPackages.status, "active")
      )
    );

  const result = [];
  for (const pkg of pkgs) {
    const sessions = await db
      .select({
        id: packageSessions.id,
        sessionNumber: packageSessions.sessionNumber,
        serviceId: packageSessions.serviceId,
        status: packageSessions.status,
      })
      .from(packageSessions)
      .where(eq(packageSessions.clientPackageId, pkg.id))
      .orderBy(packageSessions.sessionNumber);

    const remaining = sessions.filter((s) => s.status === "pending").length;
    if (remaining > 0) {
      result.push({
        id: pkg.id,
        packageName: pkg.packageName,
        sessionsTotal: pkg.sessionsTotal,
        sessionsUsed: pkg.sessionsUsed,
        remaining,
        expiresAt: pkg.expiresAt,
        pendingSessions: sessions.filter((s) => s.status === "pending"),
      });
    }
  }

  return c.json({ packages: result });
});
