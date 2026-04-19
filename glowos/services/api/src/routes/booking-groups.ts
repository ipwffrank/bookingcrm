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
import { findStaffConflict } from "../lib/booking-conflicts.js";
import { writeAuditDiff } from "../lib/booking-edits.js";
import { normalizePhone } from "../lib/normalize.js";
import { findOrCreateClient } from "../lib/findOrCreateClient.js";
import type { AppVariables } from "../lib/types.js";

export const bookingGroupsRouter = new Hono<{ Variables: AppVariables }>();

const serviceItemSchema = z.object({
  booking_id: z.string().uuid().optional(),
  service_id: z.string().uuid(),
  staff_id: z.string().uuid(),
  start_time: z.string().datetime().optional(),
  price_sgd: z.number().nonnegative().optional(),
  use_package: z
    .object({
      client_package_id: z.string().uuid(),
      session_id: z.string().uuid(),
    })
    .optional(),
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
  services: z.array(serviceItemSchema).min(1),
  sell_package: z
    .object({
      package_id: z.string().uuid(),
      price_sgd: z.number().nonnegative().optional(),
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

    // Ensure client_profile exists for this merchant (required for analytics)
    const [profileExisting] = await db
      .select({ id: clientProfiles.id })
      .from(clientProfiles)
      .where(and(eq(clientProfiles.merchantId, merchantId), eq(clientProfiles.clientId, client.id)))
      .limit(1);
    if (!profileExisting) {
      await db.insert(clientProfiles).values({ merchantId, clientId: client.id });
    }

    // Load all service rows referenced
    const serviceIds = Array.from(new Set(body.services.map((s) => s.service_id)));
    const serviceRows = await db
      .select({
        id: services.id,
        priceSgd: services.priceSgd,
        durationMinutes: services.durationMinutes,
        bufferMinutes: services.bufferMinutes,
      })
      .from(services)
      .where(and(inArray(services.id, serviceIds), eq(services.merchantId, merchantId)));
    if (serviceRows.length !== serviceIds.length) {
      return c.json({ error: "Not Found", message: "One or more services not found" }, 404);
    }
    const svcMap = new Map(serviceRows.map((s) => [s.id, s]));

    // Verify staff ownership
    const staffIds = Array.from(new Set(body.services.map((s) => s.staff_id)));
    const staffRows = await db
      .select({ id: staff.id })
      .from(staff)
      .where(and(inArray(staff.id, staffIds), eq(staff.merchantId, merchantId)));
    if (staffRows.length !== staffIds.length) {
      return c.json({ error: "Not Found", message: "One or more staff not found" }, 404);
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
    };
    const plan: Plan[] = [];
    for (let i = 0; i < body.services.length; i++) {
      const row = body.services[i];
      const svc = svcMap.get(row.service_id)!;
      const start = row.start_time ? parseISO(row.start_time) : cursor;
      const totalDuration = svc.durationMinutes + svc.bufferMinutes;
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
      });
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

    const totalPrice = plan.reduce((s, p) => s + Number(p.priceSgd), 0).toFixed(2);

    // Transactional write
    let result;
    try {
      result = await db.transaction(async (tx) => {
        const [group] = await tx
          .insert(bookingGroups)
          .values({
            merchantId,
            clientId: client.id,
            totalPriceSgd: totalPrice,
            paymentMethod: body.payment_method,
            notes: body.notes ?? null,
            createdByUserId: userId,
          })
          .returning();

        const inserted = [];
        for (const p of plan) {
          const [b] = await tx
            .insert(bookings)
            .values({
              merchantId,
              clientId: client.id,
              serviceId: p.serviceId,
              staffId: p.staffId,
              startTime: p.startTime,
              endTime: p.endTime,
              durationMinutes: p.durationMinutes,
              status: "confirmed",
              priceSgd: p.priceSgd,
              paymentMethod: body.payment_method,
              bookingSource: "walkin_manual",
              commissionRate: "0",
              commissionSgd: "0",
              groupId: group.id,
            })
            .returning();
          inserted.push(b);

          if (p.usePackage) {
            await tx
              .update(packageSessions)
              .set({
                status: "completed",
                completedAt: new Date(),
                bookingId: b.id,
                staffId: p.staffId,
              })
              .where(eq(packageSessions.id, p.usePackage.sessionId));
            await tx
              .update(clientPackages)
              .set({ sessionsUsed: sql`${clientPackages.sessionsUsed} + 1` })
              .where(eq(clientPackages.id, p.usePackage.clientPackageId));
          }
        }

        let soldPackage = null;
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
          if (sessionValues.length > 0) {
            await tx.insert(packageSessions).values(sessionValues);
          }
          soldPackage = clientPkg;
        }

        return { group, bookings: inserted, soldPackage };
      });
    } catch (err) {
      if (err instanceof Error && err.message === "sell_package_not_found") {
        return c.json({ error: "Not Found", message: "Package template not found" }, 404);
      }
      throw err;
    }

    await invalidateAvailabilityCacheByMerchantId(merchantId);
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
      })
      .from(services)
      .where(and(inArray(services.id, serviceIds), eq(services.merchantId, merchantId)));
    const svcMap = new Map(serviceRows.map((s) => [s.id, s]));
    if (svcMap.size !== serviceIds.length) {
      return c.json({ error: "Not Found", message: "One or more services not found" }, 404);
    }

    // Classify submitted rows
    const currentMap = new Map(currentBookings.map((b) => [b.id, b]));
    const submittedIds = new Set(
      body.services.map((s) => s.booking_id).filter(Boolean) as string[]
    );
    const toDelete = currentBookings.filter((b) => !submittedIds.has(b.id));
    const toKeep = body.services.filter((s) => s.booking_id && currentMap.has(s.booking_id));
    const toInsert = body.services.filter((s) => !s.booking_id);

    // Conflict checks for kept + new
    const excludeIds = currentBookings.map((b) => b.id);
    for (const s of [...toKeep, ...toInsert]) {
      const svc = svcMap.get(s.service_id)!;
      const start = s.start_time ? parseISO(s.start_time) : new Date();
      const end = addMinutes(start, svc.durationMinutes + svc.bufferMinutes);
      const conflict = await findStaffConflict({
        merchantId,
        staffId: s.staff_id,
        startTime: start,
        endTime: end,
        excludeBookingIds: excludeIds,
      });
      if (conflict) {
        return c.json(
          { error: "Conflict", message: "Staff double-booked", ...conflict },
          409
        );
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
          await tx
            .update(clientPackages)
            .set({
              sessionsUsed: sql`${clientPackages.sessionsUsed} - 1`,
              status: "active",
            })
            .where(eq(clientPackages.id, sess.clientPackageId));
        }
        await writeAuditDiff(
          { userId, userRole, bookingId: b.id, bookingGroupId: groupId },
          { deleted: false },
          { deleted: true }
        );
        await tx.delete(bookings).where(eq(bookings.id, b.id));
      }

      // UPDATE kept rows
      for (const s of toKeep) {
        const existing = currentMap.get(s.booking_id!)!;
        const svc = svcMap.get(s.service_id)!;
        const start = s.start_time ? parseISO(s.start_time) : existing.startTime;
        const end = addMinutes(start, svc.durationMinutes + svc.bufferMinutes);
        const listPrice = s.price_sgd !== undefined ? s.price_sgd.toFixed(2) : svc.priceSgd;
        const effectivePrice = s.use_package ? "0.00" : listPrice;

        const newValues = {
          serviceId: s.service_id,
          staffId: s.staff_id,
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
            startTime: existing.startTime,
            endTime: existing.endTime,
            priceSgd: existing.priceSgd,
          },
          newValues
        );

        await tx
          .update(bookings)
          .set({ ...newValues, updatedAt: new Date() })
          .where(eq(bookings.id, existing.id));

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
          await tx
            .update(clientPackages)
            .set({
              sessionsUsed: sql`${clientPackages.sessionsUsed} - 1`,
              status: "active",
            })
            .where(eq(clientPackages.id, sessCurrent.clientPackageId));
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
          await tx
            .update(clientPackages)
            .set({ sessionsUsed: sql`${clientPackages.sessionsUsed} + 1` })
            .where(eq(clientPackages.id, s.use_package.client_package_id));
        }
      }

      // INSERT new rows
      for (const s of toInsert) {
        const svc = svcMap.get(s.service_id)!;
        const start = s.start_time ? parseISO(s.start_time) : new Date();
        const end = addMinutes(start, svc.durationMinutes + svc.bufferMinutes);
        const listPrice = s.price_sgd !== undefined ? s.price_sgd.toFixed(2) : svc.priceSgd;
        const effectivePrice = s.use_package ? "0.00" : listPrice;
        const [b] = await tx
          .insert(bookings)
          .values({
            merchantId,
            clientId: group.clientId,
            serviceId: s.service_id,
            staffId: s.staff_id,
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
          { exists: true, serviceId: s.service_id, staffId: s.staff_id }
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
          await tx
            .update(clientPackages)
            .set({ sessionsUsed: sql`${clientPackages.sessionsUsed} + 1` })
            .where(eq(clientPackages.id, s.use_package.client_package_id));
        }
      }

      // Recompute group total + audit group-level fields
      const remaining = await tx
        .select({ price: bookings.priceSgd })
        .from(bookings)
        .where(eq(bookings.groupId, groupId));
      const newTotal = remaining.reduce((s, r) => s + Number(r.price), 0).toFixed(2);

      await writeAuditDiff(
        { userId, userRole, bookingGroupId: groupId },
        {
          paymentMethod: group.paymentMethod,
          notes: group.notes,
          totalPriceSgd: group.totalPriceSgd,
        },
        {
          paymentMethod: body.payment_method ?? group.paymentMethod,
          notes: body.notes ?? group.notes,
          totalPriceSgd: newTotal,
        }
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
