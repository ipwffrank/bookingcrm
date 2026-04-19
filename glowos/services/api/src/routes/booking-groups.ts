import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
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
