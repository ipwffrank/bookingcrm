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
    chain.innerJoin = vi.fn(() => chain);
    chain.leftJoin = vi.fn(() => chain);
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
    // Transaction callback runs against mockDb itself so .insert/.update/.select
    // continue to consume the same queues.
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb)),
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
  merchantUsers: {},
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

const { _roleRef } = vi.hoisted(() => ({ _roleRef: { value: "owner" } }));

vi.mock("../middleware/auth.js", () => ({
  requireMerchant: vi.fn(async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set("userId", "user-1");
    c.set("merchantId", "merchant-1");
    c.set("userRole", _roleRef.value);
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
  restoreLoyaltyOnCancel: vi.fn().mockResolvedValue(undefined),
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

import { merchantBookingsRouter, bookingsRouter } from "./bookings.js";
import { restoreLoyaltyOnCancel } from "../lib/refunds.js";

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

// ─── apply-loyalty-redemption ─────────────────────────────────────────────────

describe("POST /merchant/bookings/:id/apply-loyalty-redemption", () => {
  beforeEach(() => {
    _roleRef.value = "owner";
    _selectQueue.length = 0;
    _insertQueue.length = 0;
    _updateQueue.length = 0;
    insertCallArgs.length = 0;
  });

  const enabledProgram = {
    id: "lp-1",
    enabled: true,
    pointsPerDollar: 1,
    pointsPerVisit: 0,
    pointsPerDollarRedeem: 100,
    minRedeemPoints: 100,
    earnExpiryMonths: 0,
  };

  const cleanBooking = {
    id: "booking-1",
    merchantId: "merchant-1",
    clientId: "client-1",
    status: "confirmed",
    priceSgd: "80.00",
    discountSgd: "0",
    loyaltyPointsRedeemed: 0,
    loyaltyRedemptionTxId: null,
  };

  it("succeeds: inserts ledger row and updates booking; returns new balance", async () => {
    // booking lookup
    _selectQueue.push([cleanBooking]);
    // program lookup
    _selectQueue.push([enabledProgram]);
    // balance SUM
    _selectQueue.push([{ balance: "500" }]);
    // actor lookup
    _selectQueue.push([{ name: "Owner User" }]);
    // tx insert returning
    _insertQueue.push([{ id: "tx-redeem-1", kind: "redeem", amount: -200 }]);
    // booking update returning
    _updateQueue.push([
      { ...cleanBooking, discountSgd: "2.00", loyaltyPointsRedeemed: 200, loyaltyRedemptionTxId: "tx-redeem-1" },
    ]);

    const app = makeApp();
    const res = await app.request(
      "/merchant/bookings/booking-1/apply-loyalty-redemption",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: 200 }),
      },
    );

    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.newBalance).toBe(300);
    const redeemArgs = insertCallArgs.find(
      (v) => (v as Record<string, unknown>).kind === "redeem",
    ) as Record<string, unknown> | undefined;
    expect(redeemArgs).toBeDefined();
    expect(redeemArgs?.amount).toBe(-200);
    expect(redeemArgs?.bookingId).toBe("booking-1");
    expect(redeemArgs?.redeemedSgd).toBe("2.00");
  });

  it("returns 409 when program is disabled", async () => {
    _selectQueue.push([cleanBooking]);
    _selectQueue.push([{ ...enabledProgram, enabled: false }]);

    const app = makeApp();
    const res = await app.request(
      "/merchant/bookings/booking-1/apply-loyalty-redemption",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: 200 }),
      },
    );

    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(String(body.message)).toMatch(/not enabled/i);
  });

  it("returns 409 when balance is insufficient", async () => {
    _selectQueue.push([cleanBooking]);
    _selectQueue.push([enabledProgram]);
    _selectQueue.push([{ balance: "50" }]);

    const app = makeApp();
    const res = await app.request(
      "/merchant/bookings/booking-1/apply-loyalty-redemption",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: 200 }),
      },
    );

    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(String(body.message)).toMatch(/insufficient/i);
  });

  it("returns 409 when below minRedeemPoints", async () => {
    _selectQueue.push([cleanBooking]);
    _selectQueue.push([{ ...enabledProgram, minRedeemPoints: 500 }]);

    const app = makeApp();
    const res = await app.request(
      "/merchant/bookings/booking-1/apply-loyalty-redemption",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: 200 }),
      },
    );

    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(String(body.message)).toMatch(/minimum/i);
  });

  it("returns 409 when SGD value would exceed booking price (cap)", async () => {
    // priceSgd 80.00; redeeming 10000 pts at 100 ppd = SGD 100, exceeds total
    _selectQueue.push([cleanBooking]);
    _selectQueue.push([enabledProgram]);
    _selectQueue.push([{ balance: "20000" }]);

    const app = makeApp();
    const res = await app.request(
      "/merchant/bookings/booking-1/apply-loyalty-redemption",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: 10000 }),
      },
    );

    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(String(body.message)).toMatch(/exceeds/i);
  });

  it("returns 409 when booking already has a redemption", async () => {
    _selectQueue.push([
      { ...cleanBooking, loyaltyPointsRedeemed: 100, discountSgd: "1.00" },
    ]);

    const app = makeApp();
    const res = await app.request(
      "/merchant/bookings/booking-1/apply-loyalty-redemption",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: 200 }),
      },
    );

    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(String(body.message)).toMatch(/already has/i);
  });

  it("returns 409 when booking is completed", async () => {
    _selectQueue.push([{ ...cleanBooking, status: "completed" }]);

    const app = makeApp();
    const res = await app.request(
      "/merchant/bookings/booking-1/apply-loyalty-redemption",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: 200 }),
      },
    );

    expect(res.status).toBe(409);
  });

  it("returns 409 when booking is still pending (redemption defers to check-in)", async () => {
    _selectQueue.push([{ ...cleanBooking, status: "pending" }]);

    const app = makeApp();
    const res = await app.request(
      "/merchant/bookings/booking-1/apply-loyalty-redemption",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: 200 }),
      },
    );

    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(String(body.message)).toMatch(/check-in/i);
  });
});

// ─── remove-loyalty-redemption ────────────────────────────────────────────────

describe("POST /merchant/bookings/:id/remove-loyalty-redemption", () => {
  beforeEach(() => {
    _roleRef.value = "owner";
    _selectQueue.length = 0;
    _insertQueue.length = 0;
    _updateQueue.length = 0;
    insertCallArgs.length = 0;
  });

  const redeemedBooking = {
    id: "booking-1",
    merchantId: "merchant-1",
    clientId: "client-1",
    status: "confirmed",
    priceSgd: "80.00",
    discountSgd: "2.00",
    loyaltyPointsRedeemed: 200,
    loyaltyRedemptionTxId: "tx-redeem-1",
  };

  it("succeeds: inserts offsetting adjust row and zeros booking", async () => {
    // booking lookup
    _selectQueue.push([redeemedBooking]);
    // actor lookup
    _selectQueue.push([{ name: "Owner User" }]);
    // adjust insert
    _insertQueue.push([{ id: "tx-adjust-1", kind: "adjust", amount: 200 }]);
    // booking update returning
    _updateQueue.push([
      { ...redeemedBooking, discountSgd: "0", loyaltyPointsRedeemed: 0, loyaltyRedemptionTxId: null },
    ]);
    // balance SUM (after)
    _selectQueue.push([{ balance: "500" }]);

    const app = makeApp();
    const res = await app.request(
      "/merchant/bookings/booking-1/remove-loyalty-redemption",
      { method: "POST" },
    );

    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.newBalance).toBe(500);
    const adjustArgs = insertCallArgs.find(
      (v) => (v as Record<string, unknown>).kind === "adjust",
    ) as Record<string, unknown> | undefined;
    expect(adjustArgs).toBeDefined();
    expect(adjustArgs?.amount).toBe(200);
    expect(String(adjustArgs?.reason)).toMatch(/Reversed booking redemption/);
  });

  it("returns 409 when no redemption is present", async () => {
    _selectQueue.push([
      {
        ...redeemedBooking,
        loyaltyPointsRedeemed: 0,
        discountSgd: "0",
        loyaltyRedemptionTxId: null,
      },
    ]);

    const app = makeApp();
    const res = await app.request(
      "/merchant/bookings/booking-1/remove-loyalty-redemption",
      { method: "POST" },
    );

    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(String(body.message)).toMatch(/no loyalty redemption/i);
  });

  it("returns 409 when booking is completed", async () => {
    _selectQueue.push([{ ...redeemedBooking, status: "completed" }]);

    const app = makeApp();
    const res = await app.request(
      "/merchant/bookings/booking-1/remove-loyalty-redemption",
      { method: "POST" },
    );

    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(String(body.message)).toMatch(/completed booking/i);
  });
});

// ─── cancel hook ──────────────────────────────────────────────────────────────

describe("Public booking cancel — restoreLoyaltyOnCancel hook", () => {
  beforeEach(() => {
    _roleRef.value = "owner";
    _selectQueue.length = 0;
    _insertQueue.length = 0;
    _updateQueue.length = 0;
    insertCallArgs.length = 0;
    (restoreLoyaltyOnCancel as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it("calls restoreLoyaltyOnCancel when the public cancel endpoint runs", async () => {
    // The public cancel endpoint requires a verifyBookingToken-validated
    // token; verifyBookingToken is mocked to always return true.
    const merchant = {
      id: "merchant-1",
      cancellationPolicy: { free_cancellation_hours: 24, late_cancellation_refund_pct: 50 },
    };
    const booking = {
      id: "b-1",
      merchantId: "merchant-1",
      status: "confirmed",
      priceSgd: "80.00",
      paymentMethod: "cash",
      paymentStatus: "pending",
      startTime: new Date(Date.now() + 48 * 60 * 60 * 1000),
      endTime: new Date(Date.now() + 49 * 60 * 60 * 1000),
      staffId: "staff-1",
      serviceId: "service-1",
    };
    // initial booking+merchant lookup
    _selectQueue.push([{ booking, merchant }]);
    // cash branch update returning
    _updateQueue.push([{ ...booking, status: "cancelled", cancelledAt: new Date() }]);
    // post-cancel reload booking
    _selectQueue.push([{ ...booking, status: "cancelled" }]);

    // Build a base64url JSON-encoded token whose payload includes bookingId.
    const token = Buffer.from(JSON.stringify({ bookingId: "b-1" })).toString("base64url");

    const app = new Hono<{ Variables: AppVariables }>();
    app.route("/booking", bookingsRouter);
    const res = await app.request(`/booking/cancel/${token}`, { method: "POST" });

    expect(res.status).toBe(200);
    expect(restoreLoyaltyOnCancel).toHaveBeenCalledWith("b-1", null);
  });
});

// ─── restoreLoyaltyOnCancel unit (real impl) ─────────────────────────────────
// We exercise the helper directly to confirm it inserts a compensating adjust
// row when the booking has loyaltyPointsRedeemed > 0 and skips when it's 0.

describe("restoreLoyaltyOnCancel (real implementation)", () => {
  beforeEach(() => {
    _selectQueue.length = 0;
    _insertQueue.length = 0;
    _updateQueue.length = 0;
    insertCallArgs.length = 0;
  });

  it("inserts a compensating adjust row when booking had a redemption", async () => {
    // un-mock just for this block
    const { restoreLoyaltyOnCancel: realFn } = await vi.importActual<
      typeof import("../lib/refunds.js")
    >("../lib/refunds.js");

    // booking lookup → has redemption
    _selectQueue.push([
      { merchantId: "merchant-1", clientId: "client-1", loyaltyPointsRedeemed: 200 },
    ]);
    // existing-adjust idempotency lookup → none
    _selectQueue.push([]);

    await realFn("b-1", "user-1");

    const adjustArgs = insertCallArgs.find(
      (v) => (v as Record<string, unknown>).kind === "adjust",
    ) as Record<string, unknown> | undefined;
    expect(adjustArgs).toBeDefined();
    expect(adjustArgs?.amount).toBe(200);
    expect(adjustArgs?.bookingId).toBe("b-1");
    expect(String(adjustArgs?.reason)).toMatch(/Restored on booking cancellation/);
  });

  it("is a no-op when no redemption was applied", async () => {
    const { restoreLoyaltyOnCancel: realFn } = await vi.importActual<
      typeof import("../lib/refunds.js")
    >("../lib/refunds.js");

    _selectQueue.push([
      { merchantId: "merchant-1", clientId: "client-1", loyaltyPointsRedeemed: 0 },
    ]);

    const insertsBefore = mockDb.insert.mock.calls.length;
    await realFn("b-1", null);
    const insertsAfter = mockDb.insert.mock.calls.length;
    expect(insertsAfter).toBe(insertsBefore);
  });
});
