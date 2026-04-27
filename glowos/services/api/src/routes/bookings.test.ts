/**
 * Tests for the booking-complete route, specifically the loyalty auto-earn hook.
 *
 * Tests:
 *   - Completing a booking fires a loyalty earn transaction when program is enabled
 *   - Completing a booking does NOT write a transaction when program is disabled
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppVariables } from "../lib/types.js";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const { _selectQueue, _insertQueue, _updateQueue, mockDb, insertCallArgs } = vi.hoisted(() => {
  const _selectQueue: unknown[] = [];
  const _insertQueue: unknown[] = [];
  const _updateQueue: unknown[] = [];
  // Track insert calls for assertion
  const insertCallArgs: unknown[] = [];

  function makeMockChain(result: unknown, captureValues?: (v: unknown) => void) {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(() => Promise.resolve(result));
    chain.returning = vi.fn(() => Promise.resolve(result));
    chain.values = vi.fn((v: unknown) => {
      if (captureValues) captureValues(v);
      return chain;
    });
    chain.orderBy = vi.fn(() => chain);
    chain.set = vi.fn(() => chain);
    chain.onConflictDoUpdate = vi.fn(() => chain);
    chain.onConflictDoNothing = vi.fn(() => Promise.resolve([]));
    return chain;
  }

  const mockDb = {
    select: vi.fn(() => {
      const result = _selectQueue.shift() ?? [];
      return makeMockChain(result);
    }),
    insert: vi.fn(() => {
      const result = _insertQueue.shift() ?? [];
      return makeMockChain(result, (v) => insertCallArgs.push(v));
    }),
    update: vi.fn(() => {
      const result = _updateQueue.shift() ?? [];
      return makeMockChain(result);
    }),
  };

  return { _selectQueue, _insertQueue, _updateQueue, mockDb, insertCallArgs };
});

vi.mock("@glowos/db", () => ({
  db: mockDb,
  bookings: {},
  merchants: {},
  services: {},
  staff: {},
  staffServices: {},
  slotLeases: {},
  clients: {},
  clientProfiles: {},
  bookingGroups: {},
  bookingEdits: {},
  clientPackages: {},
  packageSessions: {},
  loyaltyPrograms: {},
  loyaltyTransactions: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn(() => "and"),
  gte: vi.fn(() => "gte"),
  lte: vi.fn(() => "lte"),
  inArray: vi.fn(() => "inArray"),
  or: vi.fn(() => "or"),
  sql: Object.assign(vi.fn(() => "sql"), { join: vi.fn(() => "sql_join") }),
}));

vi.mock("../middleware/auth.js", () => ({
  requireMerchant: vi.fn(async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set("userId", "user-1");
    c.set("merchantId", "merchant-1");
    c.set("userRole", "owner");
    await next();
  }),
  requireRole: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => next()),
  requireAdmin: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => next()),
}));

vi.mock("../middleware/validate.js", () => ({
  zValidator: (schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } }) =>
    async (
      c: { req: { json: () => Promise<unknown> }; set: (k: string, v: unknown) => void; json: (body: unknown, status?: number) => Response },
      next: () => Promise<void>
    ) => {
      let raw: unknown;
      try { raw = await c.req.json(); } catch {
        return c.json({ error: "Bad Request" }, 400);
      }
      const result = schema.safeParse(raw);
      if (!result.success) return c.json({ error: "Validation Error" }, 400);
      c.set("body", result.data);
      await next();
    },
}));

vi.mock("../lib/availability.js", () => ({
  getAvailability: vi.fn().mockResolvedValue({ slots: [] }),
  invalidateAvailabilityCacheByMerchantId: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/jwt.js", () => ({
  generateBookingToken: vi.fn(() => "token"),
  verifyBookingToken: vi.fn(() => ({ bookingId: "b-1" })),
  generateAccessToken: vi.fn(() => "access-token"),
  verifyAccessToken: vi.fn(() => ({ userId: "user-1" })),
  verifyVerificationToken: vi.fn(() => ({ clientId: "client-1" })),
}));

vi.mock("../lib/confirmation-token.js", () => ({
  generateConfirmationToken: vi.fn(() => "confirm-token"),
}));

vi.mock("../lib/normalize.js", () => ({
  normalizePhone: vi.fn((v: string) => v),
  normalizeEmail: vi.fn((v: string) => v),
}));

vi.mock("../lib/findOrCreateClient.js", () => ({
  findOrCreateClient: vi.fn().mockResolvedValue({ id: "client-1" }),
}));

vi.mock("../lib/firstTimerCheck.js", () => ({
  isFirstTimerAtMerchant: vi.fn().mockResolvedValue(false),
}));

vi.mock("../lib/refunds.js", () => ({
  processRefund: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/booking-conflicts.js", () => ({
  findStaffConflict: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/booking-edits.js", () => ({
  writeAuditDiff: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/queue.js", () => ({
  addJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/scheduler.js", () => ({
  scheduleReminder: vi.fn().mockResolvedValue(undefined),
  scheduleReviewRequest: vi.fn().mockResolvedValue(undefined),
  scheduleRebookCheckin: vi.fn().mockResolvedValue(undefined),
  scheduleNoShowReengagement: vi.fn().mockResolvedValue(undefined),
  scheduleRebookingPrompt: vi.fn().mockResolvedValue(undefined),
  schedulePostServiceSequence: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/waitlist-scheduler.js", () => ({
  scheduleWaitlistMatchJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/config.js", () => ({
  config: { jwtSecret: "test-secret", queuePrefix: "test" },
  isSuperAdminEmail: () => false,
}));

// ─── Import router after mocks ────────────────────────────────────────────────

import { merchantBookingsRouter } from "./bookings.js";

type ApiBody = Record<string, unknown>;
async function jsonBody(res: Response): Promise<ApiBody> {
  return res.json() as Promise<ApiBody>;
}

function makeApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.route("/merchant/bookings", merchantBookingsRouter);
  return app;
}

// ─── Shared booking data ──────────────────────────────────────────────────────

const completedBooking = {
  id: "booking-1",
  merchantId: "merchant-1",
  clientId: "client-1",
  status: "completed",
  priceSgd: "80.00",
  completedAt: new Date(),
  updatedAt: new Date(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Booking complete — loyalty auto-earn", () => {
  beforeEach(() => {
    _selectQueue.length = 0;
    _insertQueue.length = 0;
    _updateQueue.length = 0;
    insertCallArgs.length = 0;
  });

  it("inserts a loyalty earn transaction when program is enabled", async () => {
    // existing booking lookup (status check)
    _selectQueue.push([{ id: "booking-1", status: "in_progress" }]);
    // booking UPDATE returning
    _updateQueue.push([completedBooking]);
    // loyalty program lookup (enabled)
    _selectQueue.push([{
      id: "lp-1",
      enabled: true,
      pointsPerDollar: 1,
      pointsPerVisit: 5,
      pointsPerDollarRedeem: 100,
      minRedeemPoints: 100,
      earnExpiryMonths: 0,
    }]);
    // loyalty insert
    _insertQueue.push([{ id: "tx-earn" }]);

    const app = makeApp();
    const res = await app.request("/merchant/bookings/booking-1/complete", {
      method: "PUT",
    });

    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect((body.booking as Record<string, unknown>).id).toBe("booking-1");

    // Allow the fire-and-forget async to complete
    await new Promise((r) => setTimeout(r, 10));

    // The insert to loyalty_transactions should have been called
    expect(mockDb.insert).toHaveBeenCalled();
    const earnValues = insertCallArgs.find((v) => {
      const obj = v as Record<string, unknown>;
      return obj.kind === "earn";
    }) as Record<string, unknown> | undefined;
    expect(earnValues).toBeDefined();
    // 80 * 1 + 5 = 85 points
    expect(earnValues?.amount).toBe(85);
    expect(earnValues?.earnedFromSgd).toBe("80.00");
    expect(earnValues?.bookingId).toBe("booking-1");
  });

  it("does NOT insert a loyalty transaction when program is disabled", async () => {
    // existing booking lookup
    _selectQueue.push([{ id: "booking-1", status: "in_progress" }]);
    // booking UPDATE returning
    _updateQueue.push([completedBooking]);
    // loyalty program lookup (disabled)
    _selectQueue.push([{
      id: "lp-1",
      enabled: false,
      pointsPerDollar: 1,
      pointsPerVisit: 0,
      pointsPerDollarRedeem: 100,
      minRedeemPoints: 100,
      earnExpiryMonths: 0,
    }]);

    const insertsBefore = mockDb.insert.mock.calls.length;

    const app = makeApp();
    const res = await app.request("/merchant/bookings/booking-1/complete", {
      method: "PUT",
    });

    expect(res.status).toBe(200);

    // Allow the fire-and-forget async to complete
    await new Promise((r) => setTimeout(r, 10));

    // No new inserts should have happened (program was disabled)
    const insertsAfter = mockDb.insert.mock.calls.length;
    expect(insertsAfter).toBe(insertsBefore);
  });

  it("does NOT insert when program row doesn't exist", async () => {
    _selectQueue.push([{ id: "booking-1", status: "in_progress" }]);
    _updateQueue.push([completedBooking]);
    // no loyalty program row
    _selectQueue.push([]);

    const insertsBefore = mockDb.insert.mock.calls.length;

    const app = makeApp();
    const res = await app.request("/merchant/bookings/booking-1/complete", {
      method: "PUT",
    });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));

    const insertsAfter = mockDb.insert.mock.calls.length;
    expect(insertsAfter).toBe(insertsBefore);
  });
});
