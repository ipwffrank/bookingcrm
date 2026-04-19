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

// Stub — filled in Task 6
bookingGroupsRouter.post(
  "/",
  requireMerchant,
  zValidator(createGroupSchema),
  async (c) => {
    return c.json({ error: "Not Implemented" }, 501);
  }
);
