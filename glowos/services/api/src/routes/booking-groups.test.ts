/**
 * Tests for the merchant-side group booking router, specifically the new
 * secondary-staff validation and persistence introduced with the buffer
 * feature.
 *
 * Covers:
 *   - POST /merchant/bookings/group with secondary_staff_id but the service
 *     has no buffers → 400 with the precise spec'd error message
 *   - getStaffBlockedWindows-driven conflict checks are exercised in
 *     ./../lib/booking-conflicts.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppVariables } from "../lib/types.js";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const { _selectQueue, _insertQueue, _updateQueue, mockDb } = vi.hoisted(() => {
  const _selectQueue: unknown[] = [];
  const _insertQueue: unknown[] = [];
  const _updateQueue: unknown[] = [];

  function makeMockChain(result: unknown) {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    // .where is sometimes the terminal step (no .limit chained); make it
    // both chainable AND thenable so `await chain` resolves to the result.
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(() => Promise.resolve(result));
    chain.returning = vi.fn(() => Promise.resolve(result));
    chain.values = vi.fn(() => chain);
    chain.orderBy = vi.fn(() => chain);
    chain.set = vi.fn(() => chain);
    chain.innerJoin = vi.fn(() => chain);
    chain.leftJoin = vi.fn(() => chain);
    chain.onConflictDoUpdate = vi.fn(() => chain);
    chain.onConflictDoNothing = vi.fn(() => Promise.resolve([]));
    chain.then = (resolve: (v: unknown) => void) => resolve(result);
    return chain;
  }

  const mockDb: Record<string, unknown> = {
    select: vi.fn(() => {
      const result = _selectQueue.shift() ?? [];
      return makeMockChain(result);
    }),
    insert: vi.fn(() => {
      const result = _insertQueue.shift() ?? [];
      return makeMockChain(result);
    }),
    update: vi.fn(() => {
      const result = _updateQueue.shift() ?? [];
      return makeMockChain(result);
    }),
    delete: vi.fn(() => makeMockChain([])),
  };
  mockDb.transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(mockDb),
  );

  return { _selectQueue, _insertQueue, _updateQueue, mockDb };
});

vi.mock("@glowos/db", () => ({
  db: mockDb,
  bookings: {},
  bookingGroups: {},
  bookingEdits: {},
  services: {},
  staff: {},
  clients: {},
  clientProfiles: {},
  clientPackages: {},
  packageSessions: {},
  servicePackages: {},
  // merchants is read by the operating-hours gate that runs at the top of
  // the create handler. Tests don't model hours so the gate must see null
  // and skip — push an empty row at the head of the select queue per test.
  merchants: { id: "merchants.id", operatingHours: "merchants.operatingHours" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn(() => "and"),
  inArray: vi.fn(() => "inArray"),
  sql: Object.assign(vi.fn(() => "sql"), { join: vi.fn(() => "sql_join") }),
  ne: vi.fn(() => "ne"),
}));

vi.mock("../middleware/auth.js", () => ({
  requireMerchant: vi.fn(
    async (
      c: { set: (k: string, v: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("userId", "user-1");
      c.set("merchantId", "merchant-1");
      c.set("userRole", "owner");
      await next();
    },
  ),
}));

vi.mock("../middleware/validate.js", () => ({
  zValidator:
    (schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } }) =>
    async (
      c: {
        req: { json: () => Promise<unknown> };
        set: (k: string, v: unknown) => void;
        json: (body: unknown, status?: number) => Response;
      },
      next: () => Promise<void>,
    ) => {
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json({ error: "Bad Request" }, 400);
      }
      const result = schema.safeParse(raw);
      if (!result.success) return c.json({ error: "Validation Error" }, 400);
      c.set("body", result.data);
      await next();
    },
}));

vi.mock("../lib/availability.js", () => ({
  invalidateAvailabilityCacheByMerchantId: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/booking-conflicts.js", () => ({
  findBookingConflict: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/booking-edits.js", () => ({
  writeAuditDiff: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/package-helpers.js", () => ({
  incrementPackageSessionsUsed: vi.fn().mockResolvedValue(undefined),
  decrementPackageSessionsUsed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/normalize.js", () => ({
  normalizePhone: vi.fn((v: string) => v),
}));

vi.mock("../lib/findOrCreateClient.js", () => ({
  findOrCreateClient: vi.fn().mockResolvedValue({ id: "client-1" }),
}));

vi.mock("../lib/waitlist-scheduler.js", () => ({
  scheduleWaitlistMatchJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/confirmation-token.js", () => ({
  generateConfirmationToken: vi.fn(() => "confirm-token"),
}));

vi.mock("../lib/queue.js", () => ({
  addJob: vi.fn().mockResolvedValue(undefined),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { bookingGroupsRouter } from "./booking-groups.js";

function makeApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.route("/", bookingGroupsRouter);
  return app;
}

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /merchant/bookings/group — secondary staff validation", () => {
  beforeEach(() => {
    _selectQueue.length = 0;
    _insertQueue.length = 0;
    _updateQueue.length = 0;
  });

  it("returns 400 when secondary_staff_id is set but the service has no buffers", async () => {
    const SERVICE_ID = "11111111-1111-1111-1111-111111111111";
    const PRIMARY_ID = "22222222-2222-2222-2222-222222222222";
    const SECONDARY_ID = "33333333-3333-3333-3333-333333333333";

    // Operating-hours gate runs first now (universal — no owner exemption).
    // Push a row with operatingHours=null so the gate sees nothing to enforce
    // and falls through to the rest of the handler.
    _selectQueue.push([{ operatingHours: null }]);
    // Service rows lookup: returns one service with no pre/post buffer
    _selectQueue.push([
      {
        id: SERVICE_ID,
        priceSgd: "100.00",
        durationMinutes: 60,
        bufferMinutes: 0,
        preBufferMinutes: 0,
        postBufferMinutes: 0,
      },
    ]);
    // Staff rows lookup: returns both primary + secondary so ownership check passes
    _selectQueue.push([{ id: PRIMARY_ID }, { id: SECONDARY_ID }]);

    const app = makeApp();
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Alice",
        client_phone: "+6591234567",
        payment_method: "cash",
        services: [
          {
            service_id: SERVICE_ID,
            staff_id: PRIMARY_ID,
            secondary_staff_id: SECONDARY_ID,
            start_time: "2026-05-01T10:00:00.000Z",
          },
        ],
      }),
    });

    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error).toBe("Bad Request");
    expect(String(body.message)).toBe(
      "Secondary staff requires the service to have pre or post buffer minutes",
    );
  });
});
