import { Hono } from "hono";
import { eq, and, desc, sql, or } from "drizzle-orm";
import {
  db,
  servicePackages,
  clientPackages,
  packageSessions,
  services,
  clients,
  clientProfiles,
  bookings,
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

  // Load sessions for each package, joining services for serviceName
  const result = [];
  for (const pkg of pkgs) {
    const sessions = await db
      .select({
        id: packageSessions.id,
        sessionNumber: packageSessions.sessionNumber,
        serviceId: packageSessions.serviceId,
        serviceName: services.name,
        status: packageSessions.status,
        bookingId: packageSessions.bookingId,
        staffId: packageSessions.staffId,
        staffName: packageSessions.staffName,
        completedAt: packageSessions.completedAt,
      })
      .from(packageSessions)
      .leftJoin(services, eq(packageSessions.serviceId, services.id))
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

// ─── Public: list packages for booking page ─────────────────────────────────

// GET /booking/:slug/packages — list package templates for the booking page
publicPackagesRouter.get("/:slug/packages", async (c) => {
  const slug = c.req.param("slug")!;

  const [merchant] = await db
    .select({ id: merchants.id })
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);

  if (!merchant) return c.json({ packages: [] });

  const pkgs = await db
    .select()
    .from(servicePackages)
    .where(
      and(
        eq(servicePackages.merchantId, merchant.id),
        eq(servicePackages.isActive, true)
      )
    )
    .orderBy(servicePackages.createdAt);

  return c.json({ packages: pkgs });
});

// POST /booking/:slug/use-package-session — book using a package session (no payment)
publicPackagesRouter.post("/:slug/use-package-session", async (c) => {
  const slug = c.req.param("slug")!;
  const body = await c.req.json<{
    sessionId: string;
    staffId: string;
    startTime: string;
    clientName: string;
    clientPhone: string;
    clientEmail?: string;
  }>();

  // Find merchant
  const [merchant] = await db
    .select({ id: merchants.id })
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);
  if (!merchant) return c.json({ error: "Not Found" }, 404);

  // Load the package session
  const [session] = await db
    .select()
    .from(packageSessions)
    .where(eq(packageSessions.id, body.sessionId))
    .limit(1);
  if (!session || session.status !== "pending") {
    return c.json(
      { error: "Bad Request", message: "Session not available" },
      400
    );
  }

  // Load the service for duration
  const [service] = await db
    .select({
      durationMinutes: services.durationMinutes,
      bufferMinutes: services.bufferMinutes,
      name: services.name,
      priceSgd: services.priceSgd,
    })
    .from(services)
    .where(eq(services.id, session.serviceId))
    .limit(1);
  if (!service)
    return c.json({ error: "Not Found", message: "Service not found" }, 404);

  // Find or create client
  const conditions = [];
  if (body.clientPhone)
    conditions.push(eq(clients.phone, body.clientPhone));
  if (body.clientEmail)
    conditions.push(eq(clients.email, body.clientEmail));

  let clientId: string;
  if (conditions.length > 0) {
    const [existing] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(or(...conditions))
      .limit(1);
    if (existing) {
      clientId = existing.id;
    } else {
      const [created] = await db
        .insert(clients)
        .values({
          phone: body.clientPhone,
          name: body.clientName,
          email: body.clientEmail || null,
        })
        .returning({ id: clients.id });
      clientId = created.id;
    }
  } else {
    const [created] = await db
      .insert(clients)
      .values({
        phone: body.clientPhone,
        name: body.clientName,
      })
      .returning({ id: clients.id });
    clientId = created.id;
  }

  // Ensure client profile exists
  const [existingProfile] = await db
    .select({ id: clientProfiles.id })
    .from(clientProfiles)
    .where(
      and(
        eq(clientProfiles.merchantId, merchant.id),
        eq(clientProfiles.clientId, clientId)
      )
    )
    .limit(1);
  if (!existingProfile) {
    await db
      .insert(clientProfiles)
      .values({ merchantId: merchant.id, clientId });
  }

  // Create booking
  const startTime = new Date(body.startTime);
  const endTime = new Date(
    startTime.getTime() +
      (service.durationMinutes + service.bufferMinutes) * 60 * 1000
  );

  const [booking] = await db
    .insert(bookings)
    .values({
      merchantId: merchant.id,
      serviceId: session.serviceId,
      staffId: body.staffId,
      clientId,
      startTime,
      endTime,
      durationMinutes: service.durationMinutes,
      status: "confirmed",
      priceSgd: "0", // paid via package
      paymentMethod: "package",
      paymentStatus: "completed",
      bookingSource: "direct_widget",
    })
    .returning();

  // Update package session — mark as booked, link booking
  await db
    .update(packageSessions)
    .set({
      status: "booked",
      bookingId: booking.id,
      staffId: body.staffId,
    })
    .where(eq(packageSessions.id, body.sessionId));

  // Queue notifications
  const { addJob } = await import("../lib/queue.js");
  await addJob("notifications", "booking_confirmation", {
    booking_id: booking.id,
  });
  const { scheduleReminder } = await import("../lib/scheduler.js");
  await scheduleReminder(booking.id, startTime);

  return c.json({ success: true, booking }, 201);
});

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
