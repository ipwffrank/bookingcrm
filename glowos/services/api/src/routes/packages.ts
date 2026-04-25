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
  staff,
} from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import { findOrCreateClient } from "../lib/findOrCreateClient.js";
import { addJob } from "../lib/queue.js";
import { stripe } from "../lib/stripe.js";
import { generateConfirmationToken } from "../lib/confirmation-token.js";
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
    requiresConsultFirst?: boolean;
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
      requiresConsultFirst: body.requiresConsultFirst ?? false,
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
  if (body.requiresConsultFirst !== undefined)
    updateData.requiresConsultFirst = body.requiresConsultFirst;

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
    soldByStaffId?: string;
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

  if (body.soldByStaffId) {
    const [seller] = await db
      .select({ id: staff.id, isActive: staff.isActive })
      .from(staff)
      .where(and(eq(staff.id, body.soldByStaffId), eq(staff.merchantId, merchantId)))
      .limit(1);
    if (!seller || !seller.isActive) {
      return c.json({ error: "Not Found", message: "Seller staff not found or inactive" }, 404);
    }
  }

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
      soldByStaffId: body.soldByStaffId ?? null,
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

// POST /booking/:slug/packages/purchase — customer-initiated package purchase
//
// Creates a client_packages row + N package_sessions (pending). For now only
// cash-reserve mode is supported: the package is active immediately, and the
// customer pays at their first redemption visit. Online payment support can
// ride on top of the existing PaymentIntent pattern later.
publicPackagesRouter.post("/:slug/packages/purchase", async (c) => {
  const slug = c.req.param("slug")!;
  const body = await c.req.json<{
    package_id: string;
    client_name: string;
    client_phone: string;
    client_email?: string;
    // 'online' = pay now via Stripe (returns clientSecret to confirm).
    // 'counter' = customer pays at first visit (cash / card / PayNow at clinic).
    // Legacy 'cash'/'card' values are mapped to counter/online for backwards compat.
    payment_method?: "online" | "counter" | "cash" | "card";
    // Optional first session — when present we book the customer's first
    // visit at the same time we create the package, and link package_session
    // #1 to that booking.
    first_session?: {
      service_id: string;
      staff_id: string; // pass an actual staff UUID; "any" not supported here yet
      start_time: string; // ISO timestamp
    };
  }>();

  if (!body.package_id || !body.client_name?.trim() || !body.client_phone?.trim()) {
    return c.json(
      { error: "Bad Request", message: "package_id, client_name and client_phone are required" },
      400,
    );
  }

  const [merchant] = await db
    .select({ id: merchants.id, country: merchants.country, name: merchants.name })
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);
  if (!merchant) {
    return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
  }

  const [pkg] = await db
    .select()
    .from(servicePackages)
    .where(
      and(
        eq(servicePackages.id, body.package_id),
        eq(servicePackages.merchantId, merchant.id),
        eq(servicePackages.isActive, true),
      ),
    )
    .limit(1);
  if (!pkg) {
    return c.json({ error: "Not Found", message: "Package not available" }, 404);
  }

  // Consult-first gate: packages that require an in-person assessment cannot
  // be purchased directly online. The clinic issues a treatment quote after
  // the consult instead.
  if (pkg.requiresConsultFirst) {
    return c.json(
      {
        error: "Forbidden",
        message:
          "This package requires an in-person consultation before purchase. Please book a consultation with the clinic first.",
      },
      403,
    );
  }

  // Resolve / create the client — same semantics as booking creation, so a
  // returning customer's profile is reused and their stored name/email isn't
  // overwritten.
  let clientRow: { id: string };
  try {
    clientRow = await findOrCreateClient(
      body.client_phone.trim(),
      body.client_name.trim(),
      body.client_email?.trim() || undefined,
      merchant.country,
    );
  } catch (err) {
    return c.json(
      { error: "Bad Request", message: err instanceof Error ? err.message : "Invalid client info" },
      400,
    );
  }

  // Ensure a client_profile exists for this merchant (used downstream for
  // lookup-client + VIP tier calcs).
  const [existingProfile] = await db
    .select({ id: clientProfiles.id })
    .from(clientProfiles)
    .where(
      and(
        eq(clientProfiles.clientId, clientRow.id),
        eq(clientProfiles.merchantId, merchant.id),
      ),
    )
    .limit(1);
  if (!existingProfile) {
    await db
      .insert(clientProfiles)
      .values({ clientId: clientRow.id, merchantId: merchant.id });
  }

  // Normalise payment_method — old clients sent 'cash'/'card', new clients
  // send 'counter'/'online'.
  const rawMethod = body.payment_method ?? "counter";
  const paymentMethod: "online" | "counter" =
    rawMethod === "online" || rawMethod === "card" ? "online" : "counter";

  // Validate first_session if provided.
  type FirstSessionInput = NonNullable<typeof body.first_session>;
  let firstSession: FirstSessionInput | null = body.first_session ?? null;
  let firstSessionService: typeof services.$inferSelect | null = null;
  let firstSessionStaff: typeof staff.$inferSelect | null = null;
  let firstSessionStart: Date | null = null;
  let firstSessionEnd: Date | null = null;

  if (firstSession) {
    // Service must be one of the package's included services.
    const includedServiceIds = new Set(pkg.includedServices.map((s) => s.serviceId));
    if (!includedServiceIds.has(firstSession.service_id)) {
      return c.json(
        { error: "Bad Request", message: "first_session.service_id is not included in this package" },
        400,
      );
    }
    const [svc] = await db
      .select()
      .from(services)
      .where(and(eq(services.id, firstSession.service_id), eq(services.merchantId, merchant.id)))
      .limit(1);
    if (!svc) {
      return c.json({ error: "Bad Request", message: "Service no longer available" }, 400);
    }
    const [stf] = await db
      .select()
      .from(staff)
      .where(
        and(
          eq(staff.id, firstSession.staff_id),
          eq(staff.merchantId, merchant.id),
          eq(staff.isActive, true),
        ),
      )
      .limit(1);
    if (!stf) {
      return c.json({ error: "Bad Request", message: "Staff member not available" }, 400);
    }
    const start = new Date(firstSession.start_time);
    if (Number.isNaN(start.getTime()) || start.getTime() < Date.now() - 60_000) {
      return c.json({ error: "Bad Request", message: "first_session.start_time must be a future ISO timestamp" }, 400);
    }
    firstSessionService = svc;
    firstSessionStaff = stf;
    firstSessionStart = start;
    firstSessionEnd = new Date(start.getTime() + (svc.durationMinutes + svc.bufferMinutes) * 60_000);
  }

  // Online payment requires the merchant to have completed Stripe Connect.
  if (paymentMethod === "online") {
    const [m] = await db
      .select({ stripeAccountId: merchants.stripeAccountId })
      .from(merchants)
      .where(eq(merchants.id, merchant.id))
      .limit(1);
    if (!m?.stripeAccountId) {
      return c.json(
        {
          error: "Bad Request",
          message: "This clinic has not completed online-payment setup. Please choose 'Pay at counter'.",
        },
        400,
      );
    }
  }

  // Create the client_packages row + sessions + (optional) first booking in
  // a single transaction so partial state never leaks.
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + pkg.validityDays);

  // For online payment we hold pricePaidSgd at 0 until Stripe confirms via
  // mark-paid (idempotent flip). Counter payments leave it at 0 until
  // collected at the clinic — same dashboard view either way.
  const pricePaidSgd = "0";

  const result = await db.transaction(async (tx) => {
    const [clientPkg] = await tx
      .insert(clientPackages)
      .values({
        merchantId: merchant.id,
        clientId: clientRow.id,
        packageId: pkg.id,
        packageName: pkg.name,
        sessionsTotal: pkg.totalSessions,
        pricePaidSgd,
        expiresAt,
        notes:
          paymentMethod === "online"
            ? "Self-purchased via widget — payment pending Stripe confirmation"
            : "Self-purchased via widget — pending payment at first visit",
      })
      .returning();
    if (!clientPkg) throw new Error("Failed to create package");

    // Pre-generate N pending sessions, one per included service × quantity.
    // The first session gets bound to the booking below if first_session was
    // provided.
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
    let createdSessions: Array<{ id: string; sessionNumber: number; serviceId: string }> = [];
    if (sessionValues.length > 0) {
      createdSessions = await tx
        .insert(packageSessions)
        .values(sessionValues)
        .returning({ id: packageSessions.id, sessionNumber: packageSessions.sessionNumber, serviceId: packageSessions.serviceId });
    }

    // If a first session was specified, create the booking and bind to the
    // first matching package_session for that service.
    let firstBooking: typeof bookings.$inferSelect | null = null;
    if (firstSessionService && firstSessionStaff && firstSessionStart && firstSessionEnd) {
      const [created] = await tx
        .insert(bookings)
        .values({
          merchantId: merchant.id,
          clientId: clientRow.id,
          serviceId: firstSessionService.id,
          staffId: firstSessionStaff.id,
          startTime: firstSessionStart,
          endTime: firstSessionEnd,
          durationMinutes: firstSessionService.durationMinutes,
          status: "pending",
          confirmationToken: generateConfirmationToken(),
          priceSgd: "0", // package session — no separate booking price
          paymentStatus: paymentMethod === "online" ? "pending" : "waived",
          paymentMethod: "package",
          bookingSource: "direct_widget",
        } as never)
        .returning();
      firstBooking = created ?? null;

      if (firstBooking) {
        // Bind the lowest-numbered pending session that matches the service.
        const targetSession = createdSessions.find(
          (s) => s.serviceId === firstSessionService!.id,
        );
        if (targetSession) {
          await tx
            .update(packageSessions)
            .set({
              bookingId: firstBooking.id,
              status: "booked",
              staffId: firstSessionStaff.id,
              staffName: firstSessionStaff.name,
            })
            .where(eq(packageSessions.id, targetSession.id));
        }
      }
    }

    return { clientPkg, firstBooking };
  });

  // Mint Stripe PaymentIntent if paying online. Failure here doesn't roll back
  // the package — the customer can retry payment via mark-paid using a fresh
  // intent, or fall back to paying at counter on first visit.
  let payment: { clientSecret: string; stripeAccountId: string } | null = null;
  if (paymentMethod === "online") {
    const [m] = await db
      .select({ stripeAccountId: merchants.stripeAccountId })
      .from(merchants)
      .where(eq(merchants.id, merchant.id))
      .limit(1);
    if (m?.stripeAccountId) {
      try {
        const intent = await stripe.paymentIntents.create(
          {
            amount: Math.round(parseFloat(String(pkg.priceSgd)) * 100),
            currency: "sgd",
            automatic_payment_methods: { enabled: true },
            metadata: {
              client_package_id: result.clientPkg.id,
              merchant_id: merchant.id,
              kind: "package_purchase",
            },
          },
          { stripeAccount: m.stripeAccountId },
        );
        if (intent.client_secret) {
          payment = { clientSecret: intent.client_secret, stripeAccountId: m.stripeAccountId };
        }
      } catch (err) {
        console.error("[packages] PaymentIntent create failed", err);
      }
    }
  }

  // Notification timing:
  //   counter → fire now (package is "active, pay later")
  //   online  → fire AFTER mark-paid succeeds (so the message can confirm
  //             payment received instead of saying "pay later" wrongly)
  if (paymentMethod === "counter") {
    await addJob("notifications", "package_purchased", {
      client_package_id: result.clientPkg.id,
      payment_status: "reserved",
    }).catch((err: unknown) => {
      console.error("[packages] failed to enqueue package_purchased", err);
    });
  }

  return c.json(
    {
      clientPackage: {
        id: result.clientPkg.id,
        packageName: result.clientPkg.packageName,
        sessionsTotal: result.clientPkg.sessionsTotal,
        expiresAt: result.clientPkg.expiresAt,
        paymentMethod,
        pricePaidSgd,
        priceDueSgd: paymentMethod === "online" ? "0" : String(pkg.priceSgd),
      },
      firstBooking: result.firstBooking
        ? {
            id: result.firstBooking.id,
            startTime: result.firstBooking.startTime,
            serviceId: result.firstBooking.serviceId,
            staffId: result.firstBooking.staffId,
          }
        : null,
      payment,
    },
    201,
  );
});

// POST /booking/:slug/packages/mark-paid — confirm Stripe payment for a
// self-purchased package. Frontend calls this after stripe.confirmPayment
// succeeds. Verifies the PaymentIntent against Stripe (so we can't be
// spoofed by a forged client call), then flips pricePaidSgd → full price
// and the first booking's payment_status → paid. Idempotent.
publicPackagesRouter.post("/:slug/packages/mark-paid", async (c) => {
  const body = await c.req.json<{
    client_package_id: string;
    payment_intent_id: string;
  }>();
  if (!body.client_package_id || !body.payment_intent_id) {
    return c.json(
      { error: "Bad Request", message: "client_package_id and payment_intent_id are required" },
      400,
    );
  }

  const [row] = await db
    .select({
      cp: clientPackages,
      pkg: servicePackages,
      stripeAccountId: merchants.stripeAccountId,
    })
    .from(clientPackages)
    .innerJoin(servicePackages, eq(clientPackages.packageId, servicePackages.id))
    .innerJoin(merchants, eq(clientPackages.merchantId, merchants.id))
    .where(eq(clientPackages.id, body.client_package_id))
    .limit(1);

  if (!row) return c.json({ error: "Not Found" }, 404);
  if (parseFloat(String(row.cp.pricePaidSgd)) >= parseFloat(String(row.pkg.priceSgd))) {
    return c.json({ clientPackage: { id: row.cp.id, status: "paid" } });
  }
  if (!row.stripeAccountId) {
    return c.json({ error: "Bad Request", message: "Stripe not configured" }, 400);
  }

  try {
    const intent = await stripe.paymentIntents.retrieve(body.payment_intent_id, {
      stripeAccount: row.stripeAccountId,
    });
    if (intent.status !== "succeeded") {
      return c.json(
        { error: "Payment Required", message: `PaymentIntent status: ${intent.status}` },
        402,
      );
    }
    if (intent.metadata?.client_package_id !== row.cp.id) {
      return c.json({ error: "Forbidden", message: "PaymentIntent mismatch" }, 403);
    }
  } catch (err) {
    console.error("[packages] mark-paid: Stripe retrieve failed", err);
    return c.json({ error: "Internal Server Error" }, 500);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(clientPackages)
      .set({ pricePaidSgd: row.pkg.priceSgd })
      .where(eq(clientPackages.id, row.cp.id));

    // If the customer also booked their first session at purchase time, flip
    // that booking's payment status too so the dashboard reflects "paid".
    const sessions = await tx
      .select({ bookingId: packageSessions.bookingId })
      .from(packageSessions)
      .where(
        and(
          eq(packageSessions.clientPackageId, row.cp.id),
          eq(packageSessions.sessionNumber, 1),
        ),
      )
      .limit(1);
    const firstBookingId = sessions[0]?.bookingId;
    if (firstBookingId) {
      await tx
        .update(bookings)
        .set({ paymentStatus: "paid", updatedAt: new Date() })
        .where(eq(bookings.id, firstBookingId));
    }
  });

  // Now that money's confirmed, fire the WhatsApp + email confirmation. We
  // intentionally enqueue here (not on the initial purchase) for online
  // payments so the message can say "Payment received" honestly.
  await addJob("notifications", "package_purchased", {
    client_package_id: row.cp.id,
    payment_status: "paid",
  }).catch((err: unknown) => {
    console.error("[packages] failed to enqueue package_purchased on mark-paid", err);
  });

  return c.json({ clientPackage: { id: row.cp.id, status: "paid" } });
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
      status: "pending",
      confirmationToken: generateConfirmationToken(),
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
