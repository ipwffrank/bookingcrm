import { Hono } from "hono";
import { and, eq, inArray, sql, ne } from "drizzle-orm";
import { z } from "zod";
import { addMinutes, parseISO } from "date-fns";
import {
  db,
  bookings,
  bookingGroups,
  bookingEdits,
  services,
  staff,
  clients,
  clientProfiles,
  clientPackages,
  packageSessions,
  servicePackages,
} from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import { invalidateAvailabilityCacheByMerchantId } from "../lib/availability.js";
import { findBookingConflict } from "../lib/booking-conflicts.js";
import { writeAuditDiff } from "../lib/booking-edits.js";
import { incrementPackageSessionsUsed, decrementPackageSessionsUsed } from "../lib/package-helpers.js";
import { normalizePhone } from "../lib/normalize.js";
import { findOrCreateClient } from "../lib/findOrCreateClient.js";
import { scheduleWaitlistMatchJob } from "../lib/waitlist-scheduler.js";
import { generateConfirmationToken } from "../lib/confirmation-token.js";
import { addJob } from "../lib/queue.js";
import type { AppVariables } from "../lib/types.js";

export const bookingGroupsRouter = new Hono<{ Variables: AppVariables }>();

const serviceItemSchema = z
  .object({
    booking_id: z.string().uuid().optional(),
    service_id: z.string().uuid(),
    staff_id: z.string().uuid(),
    secondary_staff_id: z.string().uuid().nullable().optional(),
    start_time: z.string().datetime().optional(),
    price_sgd: z.number().nonnegative().optional(),
    use_package: z
      .object({
        client_package_id: z.string().uuid(),
        session_id: z.string().uuid(),
      })
      .optional(),
    use_new_package: z.boolean().optional(),
  })
  .refine((v) => !(v.use_package && v.use_new_package), {
    message: "cannot combine use_package and use_new_package on one row",
  });

const patchGroupSchema = z.object({
  payment_method: z.enum(["cash", "card", "paynow", "other"]).optional(),
  notes: z.string().nullable().optional(),
  services: z.array(serviceItemSchema).min(1),
});

const createGroupSchema = z.object({
  client_name: z.string().min(1),
  client_phone: z.string().min(1),
  payment_method: z.enum(["cash", "card", "paynow", "other"]),
  notes: z.string().optional(),
  // 'walkin'  → customer is at the counter right now → status='confirmed'.
  // 'prebook' → staff scheduling on customer's behalf → status='pending'
  //             so the cascade reminders nudge them to confirm.
  // Defaults to 'walkin' for backwards compat with older clients.
  intent: z.enum(["walkin", "prebook"]).optional(),
  services: z.array(serviceItemSchema).min(1),
  sell_package: z
    .object({
      package_id: z.string().uuid(),
      price_sgd: z.number().nonnegative().optional(),
      sold_by_staff_id: z.string().uuid().optional(),
    })
    .optional(),
});

bookingGroupsRouter.post(
  "/",
  requireMerchant,
  zValidator(createGroupSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const userId = c.get("userId")!;
    const body = c.get("body") as z.infer<typeof createGroupSchema>;

    // Find/create client
    let client: { id: string };
    try {
      client = await findOrCreateClient(body.client_phone, body.client_name);
    } catch {
      return c.json({ error: "Bad Request", message: "Invalid phone number" }, 400);
    }

    // Load all service rows referenced
    const serviceIds = Array.from(new Set(body.services.map((s) => s.service_id)));
    const serviceRows = await db
      .select({
        id: services.id,
        priceSgd: services.priceSgd,
        durationMinutes: services.durationMinutes,
        bufferMinutes: services.bufferMinutes,
        preBufferMinutes: services.preBufferMinutes,
        postBufferMinutes: services.postBufferMinutes,
      })
      .from(services)
      .where(and(inArray(services.id, serviceIds), eq(services.merchantId, merchantId)));
    if (serviceRows.length !== serviceIds.length) {
      return c.json({ error: "Not Found", message: "One or more services not found" }, 404);
    }
    const svcMap = new Map(serviceRows.map((s) => [s.id, s]));

    // Verify staff ownership — primary staff plus any secondary staff supplied.
    const staffIds = Array.from(
      new Set([
        ...body.services.map((s) => s.staff_id),
        ...body.services
          .map((s) => s.secondary_staff_id)
          .filter((v): v is string => Boolean(v)),
      ]),
    );
    const staffRows = await db
      .select({ id: staff.id })
      .from(staff)
      .where(and(inArray(staff.id, staffIds), eq(staff.merchantId, merchantId)));
    if (staffRows.length !== staffIds.length) {
      return c.json({ error: "Not Found", message: "One or more staff not found" }, 404);
    }

    // Reject secondary on services without pre/post buffers — there's no
    // window for the secondary to own.
    for (const s of body.services) {
      if (!s.secondary_staff_id) continue;
      const svc = svcMap.get(s.service_id)!;
      if (svc.preBufferMinutes === 0 && svc.postBufferMinutes === 0) {
        return c.json(
          {
            error: "Bad Request",
            message:
              "Secondary staff requires the service to have pre or post buffer minutes",
          },
          400,
        );
      }
    }

    // Compute back-to-back start times when not supplied
    const now = new Date();
    let cursor = body.services[0].start_time ? parseISO(body.services[0].start_time) : now;
    type Plan = {
      startTime: Date;
      endTime: Date;
      durationMinutes: number;
      priceSgd: string;
      usePackage?: { clientPackageId: string; sessionId: string };
      serviceId: string;
      staffId: string;
      secondaryStaffId: string | null;
    };
    const plan: Plan[] = [];
    for (let i = 0; i < body.services.length; i++) {
      const row = body.services[i];
      const svc = svcMap.get(row.service_id)!;
      const start = row.start_time ? parseISO(row.start_time) : cursor;
      // Total slot length includes pre + service + legacy + post buffers.
      const totalDuration =
        svc.preBufferMinutes +
        svc.durationMinutes +
        svc.bufferMinutes +
        svc.postBufferMinutes;
      const end = addMinutes(start, totalDuration);
      cursor = end;
      const listPrice = row.price_sgd !== undefined ? row.price_sgd.toFixed(2) : svc.priceSgd;
      const effectivePrice = row.use_package ? "0.00" : listPrice;
      plan.push({
        startTime: start,
        endTime: end,
        durationMinutes: svc.durationMinutes,
        priceSgd: effectivePrice,
        usePackage: row.use_package
          ? { clientPackageId: row.use_package.client_package_id, sessionId: row.use_package.session_id }
          : undefined,
        serviceId: row.service_id,
        staffId: row.staff_id,
        secondaryStaffId: row.secondary_staff_id ?? null,
      });
    }

    // Validate use_new_package rows: require sell_package in same request,
    // and require the row's service to be included in the sold package.
    if (body.services.some((s) => s.use_new_package)) {
      if (!body.sell_package) {
        return c.json(
          { error: "Bad Request", message: "use_new_package requires sell_package in same request" },
          400
        );
      }
      // Load the package template once to validate includedServices
      const [soldTemplate] = await db
        .select({ includedServices: servicePackages.includedServices })
        .from(servicePackages)
        .where(
          and(
            eq(servicePackages.id, body.sell_package.package_id),
            eq(servicePackages.merchantId, merchantId)
          )
        )
        .limit(1);
      if (!soldTemplate) {
        return c.json({ error: "Not Found", message: "Package template not found" }, 404);
      }
      const includedServiceIds = new Set(
        soldTemplate.includedServices.map((s) => s.serviceId)
      );
      for (const s of body.services) {
        if (s.use_new_package && !includedServiceIds.has(s.service_id)) {
          return c.json(
            {
              error: "Bad Request",
              message: `Service ${s.service_id} is not included in the sold package`,
            },
            400
          );
        }
      }
    }

    // Validate package sessions (must be pending, belong to this client)
    for (const p of plan) {
      if (!p.usePackage) continue;
      const [sess] = await db
        .select({
          id: packageSessions.id,
          status: packageSessions.status,
          clientPackageId: packageSessions.clientPackageId,
        })
        .from(packageSessions)
        .where(eq(packageSessions.id, p.usePackage.sessionId))
        .limit(1);
      if (!sess || sess.clientPackageId !== p.usePackage.clientPackageId) {
        return c.json({ error: "Not Found", message: "Package session not found" }, 404);
      }
      if (sess.status !== "pending") {
        return c.json(
          { error: "Conflict", message: "Package session is no longer available" },
          409
        );
      }
    }

    // Require sold_by_staff_id when selling a package; validate it belongs to this merchant and is active.
    if (body.sell_package) {
      if (!body.sell_package.sold_by_staff_id) {
        return c.json(
          { error: "Bad Request", message: "sold_by_staff_id is required when sell_package is provided" },
          400
        );
      }
      const [seller] = await db
        .select({ id: staff.id, isActive: staff.isActive })
        .from(staff)
        .where(
          and(
            eq(staff.id, body.sell_package.sold_by_staff_id),
            eq(staff.merchantId, merchantId)
          )
        )
        .limit(1);
      if (!seller || !seller.isActive) {
        return c.json(
          { error: "Not Found", message: "Seller staff not found or inactive" },
          404
        );
      }
    }

    // Transactional write
    let result;
    try {
      result = await db.transaction(async (tx) => {
        const [group] = await tx
          .insert(bookingGroups)
          .values({
            merchantId,
            clientId: client.id,
            // Preliminary — we'll UPDATE this at the end of the tx.
            totalPriceSgd: "0",
            packagePriceSgd: "0",
            paymentMethod: body.payment_method,
            notes: body.notes ?? null,
            createdByUserId: userId,
          })
          .returning();

        // Ensure client_profile exists for this merchant
        const [profileExisting] = await tx
          .select({ id: clientProfiles.id })
          .from(clientProfiles)
          .where(and(eq(clientProfiles.merchantId, merchantId), eq(clientProfiles.clientId, client.id)))
          .limit(1);
        if (!profileExisting) {
          await tx.insert(clientProfiles).values({ merchantId, clientId: client.id });
        }

        // Sell package FIRST (before bookings) so new-package redemptions can
        // reference the sessions. Empty pool if no package is being sold.
        let soldPackage: typeof clientPackages.$inferSelect | null = null;
        let soldPackagePrice = 0;
        const soldPool = new Map<string, string[]>(); // serviceId -> [sessionId, ...]
        if (body.sell_package) {
          const [pkg] = await tx
            .select()
            .from(servicePackages)
            .where(
              and(
                eq(servicePackages.id, body.sell_package.package_id),
                eq(servicePackages.merchantId, merchantId)
              )
            )
            .limit(1);
          if (!pkg) {
            throw new Error("sell_package_not_found");
          }
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + pkg.validityDays);
          const pricePaid =
            body.sell_package.price_sgd !== undefined
              ? body.sell_package.price_sgd.toFixed(2)
              : pkg.priceSgd;
          soldPackagePrice = Number(pricePaid);
          const [clientPkg] = await tx
            .insert(clientPackages)
            .values({
              merchantId,
              clientId: client.id,
              packageId: pkg.id,
              packageName: pkg.name,
              sessionsTotal: pkg.totalSessions,
              pricePaidSgd: pricePaid,
              expiresAt,
              soldByStaffId: body.sell_package.sold_by_staff_id,
            })
            .returning();
          const sessionValues: Array<{
            clientPackageId: string;
            sessionNumber: number;
            serviceId: string;
          }> = [];
          for (const s of pkg.includedServices) {
            for (let i = 0; i < s.quantity; i++) {
              sessionValues.push({
                clientPackageId: clientPkg.id,
                sessionNumber: sessionValues.length + 1,
                serviceId: s.serviceId,
              });
            }
          }
          let insertedSessions: Array<{ id: string; serviceId: string }> = [];
          if (sessionValues.length > 0) {
            insertedSessions = await tx
              .insert(packageSessions)
              .values(sessionValues)
              .returning({ id: packageSessions.id, serviceId: packageSessions.serviceId });
          }
          for (const s of insertedSessions) {
            if (!soldPool.has(s.serviceId)) soldPool.set(s.serviceId, []);
            soldPool.get(s.serviceId)!.push(s.id);
          }
          soldPackage = clientPkg;
        }

        const inserted = [];
        for (let i = 0; i < plan.length; i++) {
          const p = plan[i];
          const row = body.services[i]; // same length, same order as `plan`
          let redeemSessionId: string | undefined;
          let redeemClientPackageId: string | undefined;
          if (row.use_new_package) {
            const pool = soldPool.get(row.service_id);
            if (!pool || pool.length === 0) {
              throw new Error("new_package_capacity_exceeded");
            }
            redeemSessionId = pool.shift()!;
            redeemClientPackageId = soldPackage!.id;
          } else if (row.use_package) {
            redeemSessionId = row.use_package.session_id;
            redeemClientPackageId = row.use_package.client_package_id;
          }

          const effectivePrice = redeemSessionId ? "0.00" : p.priceSgd;
          const intent = body.intent ?? "walkin";
          const isPrebook = intent === "prebook";

          const [b] = await tx
            .insert(bookings)
            .values({
              merchantId,
              clientId: client.id,
              serviceId: p.serviceId,
              staffId: p.staffId,
              secondaryStaffId: p.secondaryStaffId,
              startTime: p.startTime,
              endTime: p.endTime,
              durationMinutes: p.durationMinutes,
              // Walk-ins are implicitly confirmed (customer is at the
              // counter). Pre-books need the customer to confirm via the
              // T-24h reminder cascade.
              status: isPrebook ? "pending" : "confirmed",
              confirmationToken: isPrebook ? generateConfirmationToken() : null,
              priceSgd: effectivePrice,
              paymentMethod: body.payment_method,
              bookingSource: isPrebook ? "manual_prebook" : "walkin_manual",
              commissionRate: "0",
              commissionSgd: "0",
              groupId: group.id,
            })
            .returning();
          inserted.push(b);

          if (redeemSessionId && redeemClientPackageId) {
            await tx
              .update(packageSessions)
              .set({
                status: "completed",
                completedAt: new Date(),
                bookingId: b.id,
                staffId: p.staffId,
              })
              .where(eq(packageSessions.id, redeemSessionId));
            await incrementPackageSessionsUsed(tx, redeemClientPackageId);
          }
        }

        // Compute and persist correct totals
        const bookingsTotal = inserted.reduce((s, b) => s + Number(b.priceSgd), 0);
        const grandTotal = (bookingsTotal + soldPackagePrice).toFixed(2);
        const packageTotal = soldPackagePrice.toFixed(2);
        await tx
          .update(bookingGroups)
          .set({ totalPriceSgd: grandTotal, packagePriceSgd: packageTotal })
          .where(eq(bookingGroups.id, group.id));

        // Re-fetch sold-package sessions so the response reflects final statuses
        let soldPackageResp: unknown = null;
        if (soldPackage) {
          const sessions = await tx
            .select({
              id: packageSessions.id,
              serviceId: packageSessions.serviceId,
              sessionNumber: packageSessions.sessionNumber,
              status: packageSessions.status,
              bookingId: packageSessions.bookingId,
            })
            .from(packageSessions)
            .where(eq(packageSessions.clientPackageId, soldPackage.id))
            .orderBy(packageSessions.sessionNumber);
          soldPackageResp = { ...soldPackage, sessions };
        }

        return {
          group: { ...group, totalPriceSgd: grandTotal, packagePriceSgd: packageTotal },
          bookings: inserted,
          soldPackage: soldPackageResp,
        };
      });
    } catch (err) {
      if (err instanceof Error && err.message === "sell_package_not_found") {
        return c.json({ error: "Not Found", message: "Package template not found" }, 404);
      }
      if (err instanceof Error && err.message === "new_package_capacity_exceeded") {
        return c.json(
          { error: "Bad Request", message: "More rows flagged use_new_package than the package allows for that service" },
          400
        );
      }
      throw err;
    }

    await invalidateAvailabilityCacheByMerchantId(merchantId);

    // Fire WhatsApp/email confirmation per child booking. Done out-of-band via
    // the notification queue so booking creation never blocks on Twilio. The
    // worker handles status-aware copy (confirmed vs pending) and includes
    // payment method + remaining loyalty balance.
    for (const b of result.bookings) {
      void addJob("notifications", "booking_confirmation", { booking_id: b.id });
    }

    return c.json(result, 201);
  }
);

bookingGroupsRouter.patch(
  "/:groupId",
  requireMerchant,
  zValidator(patchGroupSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const userId = c.get("userId")!;
    const userRole = c.get("userRole") as "owner" | "manager" | "staff";
    const groupId = c.req.param("groupId")!;
    const body = c.get("body") as z.infer<typeof patchGroupSchema>;

    // Load group
    const [group] = await db
      .select()
      .from(bookingGroups)
      .where(and(eq(bookingGroups.id, groupId), eq(bookingGroups.merchantId, merchantId)))
      .limit(1);
    if (!group) {
      return c.json({ error: "Not Found", message: "Booking group not found" }, 404);
    }

    // Load current child bookings
    const currentBookings = await db
      .select()
      .from(bookings)
      .where(eq(bookings.groupId, groupId));

    // Disallow if ANY child is cancelled
    if (currentBookings.some((b) => b.status === "cancelled")) {
      return c.json(
        { error: "Conflict", message: "Cannot edit a cancelled booking" },
        409
      );
    }

    // Load service rows
    const serviceIds = Array.from(new Set(body.services.map((s) => s.service_id)));
    const serviceRows = await db
      .select({
        id: services.id,
        priceSgd: services.priceSgd,
        durationMinutes: services.durationMinutes,
        bufferMinutes: services.bufferMinutes,
        preBufferMinutes: services.preBufferMinutes,
        postBufferMinutes: services.postBufferMinutes,
      })
      .from(services)
      .where(and(inArray(services.id, serviceIds), eq(services.merchantId, merchantId)));
    const svcMap = new Map(serviceRows.map((s) => [s.id, s]));
    if (svcMap.size !== serviceIds.length) {
      return c.json({ error: "Not Found", message: "One or more services not found" }, 404);
    }

    // Verify every staff in the submitted services belongs to this merchant
    // (primary + secondary).
    const staffIds = Array.from(
      new Set([
        ...body.services.map((s) => s.staff_id),
        ...body.services
          .map((s) => s.secondary_staff_id)
          .filter((v): v is string => Boolean(v)),
      ]),
    );
    const staffRows = await db
      .select({ id: staff.id })
      .from(staff)
      .where(and(inArray(staff.id, staffIds), eq(staff.merchantId, merchantId)));
    if (staffRows.length !== staffIds.length) {
      return c.json({ error: "Not Found", message: "One or more staff not found" }, 404);
    }

    // Reject secondary on services without buffers
    for (const s of body.services) {
      if (!s.secondary_staff_id) continue;
      const svc = svcMap.get(s.service_id)!;
      if (svc.preBufferMinutes === 0 && svc.postBufferMinutes === 0) {
        return c.json(
          {
            error: "Bad Request",
            message:
              "Secondary staff requires the service to have pre or post buffer minutes",
          },
          400,
        );
      }
    }

    // Classify submitted rows
    const currentMap = new Map(currentBookings.map((b) => [b.id, b]));
    const submittedIds = new Set(
      body.services.map((s) => s.booking_id).filter(Boolean) as string[]
    );
    const toDelete = currentBookings.filter((b) => !submittedIds.has(b.id));
    const toKeep = body.services.filter((s) => s.booking_id && currentMap.has(s.booking_id));
    const toInsert = body.services.filter((s) => !s.booking_id);

    // Conflict checks for kept + new — buffer-aware: when the service has
    // pre/post buffers and a secondary is set, only the primary's window
    // blocks the primary; the secondary owns the buffer windows.
    const excludeIds = currentBookings.map((b) => b.id);
    for (const s of [...toKeep, ...toInsert]) {
      const svc = svcMap.get(s.service_id)!;
      const start = s.start_time ? parseISO(s.start_time) : new Date();
      const conflict = await findBookingConflict({
        merchantId,
        candidate: {
          staffId: s.staff_id,
          secondaryStaffId: s.secondary_staff_id ?? null,
          startTime: start,
          // Legacy bufferMinutes is shared/extra time that always blocks
          // the primary; lump it into the primary window.
          serviceDurationMinutes: svc.durationMinutes + svc.bufferMinutes,
          preBufferMinutes: svc.preBufferMinutes,
          postBufferMinutes: svc.postBufferMinutes,
        },
        excludeBookingIds: excludeIds,
      });
      if (conflict) {
        return c.json(
          { error: "Conflict", message: "Staff double-booked", ...conflict },
          409
        );
      }
    }

    // Validate newly-redeemed package sessions (for toKeep rows where use_package is
    // newly set, and for all toInsert rows with use_package). Must be pending and
    // belong to the right client_package.
    const newRedemptions: Array<{ bookingId?: string; sessionId: string; clientPackageId: string }> = [];
    for (const s of toKeep) {
      if (!s.use_package) continue;
      // Only validate if this redemption is NEW (existing didn't already have a session)
      const existing = currentMap.get(s.booking_id!)!;
      const [sessCurrent] = await db
        .select({ id: packageSessions.id })
        .from(packageSessions)
        .where(eq(packageSessions.bookingId, existing.id))
        .limit(1);
      if (sessCurrent) continue; // not a new redemption
      newRedemptions.push({
        bookingId: existing.id,
        sessionId: s.use_package.session_id,
        clientPackageId: s.use_package.client_package_id,
      });
    }
    for (const s of toInsert) {
      if (!s.use_package) continue;
      newRedemptions.push({
        sessionId: s.use_package.session_id,
        clientPackageId: s.use_package.client_package_id,
      });
    }
    for (const r of newRedemptions) {
      const [sess] = await db
        .select({
          id: packageSessions.id,
          status: packageSessions.status,
          clientPackageId: packageSessions.clientPackageId,
        })
        .from(packageSessions)
        .where(eq(packageSessions.id, r.sessionId))
        .limit(1);
      if (!sess || sess.clientPackageId !== r.clientPackageId) {
        return c.json({ error: "Not Found", message: "Package session not found" }, 404);
      }
      if (sess.status !== "pending") {
        return c.json({ error: "Conflict", message: "Package session is no longer available" }, 409);
      }
    }

    // Commission fields (`commissionRate`, `commissionSgd`) are intentionally
    // never touched in this handler — per spec, commission is locked at the
    // time the booking was originally completed.

    await db.transaction(async (tx) => {
      // DELETE removed rows + re-credit any consumed package sessions
      for (const b of toDelete) {
        const [sess] = await tx
          .select()
          .from(packageSessions)
          .where(eq(packageSessions.bookingId, b.id))
          .limit(1);
        if (sess) {
          await tx
            .update(packageSessions)
            .set({
              status: "pending",
              completedAt: null,
              bookingId: null,
              staffId: null,
              staffName: null,
            })
            .where(eq(packageSessions.id, sess.id));
          await decrementPackageSessionsUsed(tx, sess.clientPackageId);
        }
        await writeAuditDiff(
          { userId, userRole, bookingId: b.id, bookingGroupId: groupId },
          { deleted: false },
          { deleted: true },
          tx
        );
        await tx.delete(bookings).where(eq(bookings.id, b.id));

        // Fire waitlist matcher for the freed slot (deleted child booking)
        await scheduleWaitlistMatchJob({
          merchant_id: merchantId,
          staff_id: b.staffId,
          service_id: b.serviceId,
          freed_start: b.startTime.toISOString(),
          freed_end: b.endTime.toISOString(),
          notified_booking_slot_id: b.id,
        });
      }

      // UPDATE kept rows
      for (const s of toKeep) {
        const existing = currentMap.get(s.booking_id!)!;
        const svc = svcMap.get(s.service_id)!;
        const start = s.start_time ? parseISO(s.start_time) : existing.startTime;
        const end = addMinutes(
          start,
          svc.preBufferMinutes +
            svc.durationMinutes +
            svc.bufferMinutes +
            svc.postBufferMinutes,
        );
        const listPrice = s.price_sgd !== undefined ? s.price_sgd.toFixed(2) : svc.priceSgd;
        const effectivePrice = s.use_package ? "0.00" : listPrice;

        const newValues = {
          serviceId: s.service_id,
          staffId: s.staff_id,
          secondaryStaffId: s.secondary_staff_id ?? null,
          startTime: start,
          endTime: end,
          durationMinutes: svc.durationMinutes,
          priceSgd: effectivePrice,
        };

        await writeAuditDiff(
          { userId, userRole, bookingId: existing.id, bookingGroupId: groupId },
          {
            serviceId: existing.serviceId,
            staffId: existing.staffId,
            secondaryStaffId: existing.secondaryStaffId,
            startTime: existing.startTime,
            endTime: existing.endTime,
            priceSgd: existing.priceSgd,
          },
          newValues,
          tx
        );

        await tx
          .update(bookings)
          .set({ ...newValues, updatedAt: new Date() })
          .where(eq(bookings.id, existing.id));

        // If startTime moved, fire waitlist matcher with the OLD slot times
        if (start.getTime() !== existing.startTime.getTime()) {
          await scheduleWaitlistMatchJob({
            merchant_id: merchantId,
            staff_id: existing.staffId,
            service_id: existing.serviceId,
            freed_start: existing.startTime.toISOString(),
            freed_end: existing.endTime.toISOString(),
            notified_booking_slot_id: existing.id,
          });
        }

        // Package redemption change: credit/debit based on usePackage toggle
        const [sessCurrent] = await tx
          .select()
          .from(packageSessions)
          .where(eq(packageSessions.bookingId, existing.id))
          .limit(1);
        const wantsPkg = Boolean(s.use_package);
        if (sessCurrent && !wantsPkg) {
          await tx
            .update(packageSessions)
            .set({
              status: "pending",
              completedAt: null,
              bookingId: null,
              staffId: null,
              staffName: null,
            })
            .where(eq(packageSessions.id, sessCurrent.id));
          await decrementPackageSessionsUsed(tx, sessCurrent.clientPackageId);
        } else if (!sessCurrent && wantsPkg && s.use_package) {
          await tx
            .update(packageSessions)
            .set({
              status: "completed",
              completedAt: new Date(),
              bookingId: existing.id,
              staffId: s.staff_id,
            })
            .where(eq(packageSessions.id, s.use_package.session_id));
          await incrementPackageSessionsUsed(tx, s.use_package.client_package_id);
        }
      }

      // INSERT new rows
      for (const s of toInsert) {
        const svc = svcMap.get(s.service_id)!;
        const start = s.start_time ? parseISO(s.start_time) : new Date();
        const end = addMinutes(
          start,
          svc.preBufferMinutes +
            svc.durationMinutes +
            svc.bufferMinutes +
            svc.postBufferMinutes,
        );
        const listPrice = s.price_sgd !== undefined ? s.price_sgd.toFixed(2) : svc.priceSgd;
        const effectivePrice = s.use_package ? "0.00" : listPrice;
        const [b] = await tx
          .insert(bookings)
          .values({
            merchantId,
            clientId: group.clientId,
            serviceId: s.service_id,
            staffId: s.staff_id,
            secondaryStaffId: s.secondary_staff_id ?? null,
            startTime: start,
            endTime: end,
            durationMinutes: svc.durationMinutes,
            status: "confirmed",
            priceSgd: effectivePrice,
            paymentMethod: body.payment_method ?? group.paymentMethod,
            bookingSource: "walkin_manual",
            commissionRate: "0",
            commissionSgd: "0",
            groupId: groupId,
          })
          .returning();
        await writeAuditDiff(
          { userId, userRole, bookingId: b.id, bookingGroupId: groupId },
          { exists: false },
          { exists: true, serviceId: s.service_id, staffId: s.staff_id },
          tx
        );
        if (s.use_package) {
          await tx
            .update(packageSessions)
            .set({
              status: "completed",
              completedAt: new Date(),
              bookingId: b.id,
              staffId: s.staff_id,
            })
            .where(eq(packageSessions.id, s.use_package.session_id));
          await incrementPackageSessionsUsed(tx, s.use_package.client_package_id);
        }
      }

      // Recompute group total + audit group-level fields
      const remaining = await tx
        .select({ price: bookings.priceSgd })
        .from(bookings)
        .where(eq(bookings.groupId, groupId));
      const bookingsSum = remaining.reduce((s, r) => s + Number(r.price), 0);
      // Use the already-stored packagePriceSgd — PATCH never modifies it.
      const newTotal = (bookingsSum + Number(group.packagePriceSgd)).toFixed(2);

      await writeAuditDiff(
        { userId, userRole, bookingGroupId: groupId },
        {
          paymentMethod: group.paymentMethod,
          notes: group.notes,
          totalPriceSgd: group.totalPriceSgd,
        },
        {
          paymentMethod: body.payment_method ?? group.paymentMethod,
          notes: body.notes === undefined ? group.notes : body.notes,
          totalPriceSgd: newTotal,
        },
        tx
      );

      await tx
        .update(bookingGroups)
        .set({
          paymentMethod: body.payment_method ?? group.paymentMethod,
          notes: body.notes === undefined ? group.notes : body.notes,
          totalPriceSgd: newTotal,
          updatedAt: new Date(),
        })
        .where(eq(bookingGroups.id, groupId));

      // Propagate paymentMethod down to child bookings (denormalized field)
      if (body.payment_method && body.payment_method !== group.paymentMethod) {
        await tx
          .update(bookings)
          .set({ paymentMethod: body.payment_method, updatedAt: new Date() })
          .where(eq(bookings.groupId, groupId));
      }
    });

    await invalidateAvailabilityCacheByMerchantId(merchantId);
    return c.json({ success: true });
  }
);
