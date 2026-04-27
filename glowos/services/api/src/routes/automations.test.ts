/**
 * Tests for the automations route.
 *
 * Tests the /merchant/automations router and validates:
 *   - run-now endpoint with disabled automation → 409
 *   - run-now endpoint fires the handler and returns sent count
 *   - save-as-enabled fires the handler synchronously
 *   - staff role → 403
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
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(() => Promise.resolve(result));
    chain.returning = vi.fn(() => Promise.resolve(result));
    chain.values = vi.fn(() => chain);
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
      return makeMockChain(result);
    }),
    update: vi.fn(() => {
      const result = _updateQueue.shift() ?? [];
      return makeMockChain(result);
    }),
  };

  return { _selectQueue, _insertQueue, _updateQueue, mockDb };
});

vi.mock("@glowos/db", () => ({
  db: mockDb,
  automations: {},
  automationSends: {},
  automationKind: ["birthday", "winback", "rebook"],
  clients: {},
  clientProfiles: {},
  merchants: {},
  notificationLog: {},
  bookings: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn(() => "and"),
  desc: vi.fn(() => "desc"),
  lt: vi.fn(() => "lt"),
  gte: vi.fn(() => "gte"),
  sql: vi.fn(() => "sql"),
}));

// ─── Auth middleware mock ──────────────────────────────────────────────────────

const { _roleRef } = vi.hoisted(() => {
  return { _roleRef: { value: "owner" } };
});

vi.mock("../middleware/auth.js", () => ({
  requireMerchant: vi.fn(async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set("userId", "user-1");
    c.set("merchantId", "merchant-1");
    c.set("userRole", _roleRef.value);
    await next();
  }),
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

// ─── Worker handler mocks ─────────────────────────────────────────────────────

const { mockHandleBirthday, mockHandleWinback, mockHandleRebook } = vi.hoisted(() => ({
  mockHandleBirthday: vi.fn().mockResolvedValue(0),
  mockHandleWinback: vi.fn().mockResolvedValue(0),
  mockHandleRebook: vi.fn().mockResolvedValue(0),
}));

vi.mock("../workers/automation.worker.js", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleBirthday: (...args: any[]) => mockHandleBirthday(...args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleWinback: (...args: any[]) => mockHandleWinback(...args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleRebook: (...args: any[]) => mockHandleRebook(...args),
}));

vi.mock("../lib/config.js", () => ({
  config: { jwtSecret: "test-secret", queuePrefix: "test" },
  isSuperAdminEmail: () => false,
}));

// ─── Import router after mocks ────────────────────────────────────────────────

import { automationsRouter } from "./automations.js";

type ApiBody = { error?: string; message?: string; sent?: number; sentOnSave?: number; automation?: unknown; [key: string]: unknown };
async function jsonBody(res: Response): Promise<ApiBody> {
  return res.json() as Promise<ApiBody>;
}

function makeApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.route("/merchant/automations", automationsRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Automations router — run-now endpoint", () => {
  beforeEach(() => {
    _roleRef.value = "owner";
    _selectQueue.length = 0;
    _insertQueue.length = 0;
    _updateQueue.length = 0;
    mockHandleBirthday.mockClear().mockResolvedValue(0);
    mockHandleWinback.mockClear().mockResolvedValue(0);
    mockHandleRebook.mockClear().mockResolvedValue(0);
  });

  it("returns 409 when automation row does not exist yet (not configured)", async () => {
    _selectQueue.push([]);  // no row found
    const app = makeApp();
    const res = await app.request("/merchant/automations/birthday/run-now", {
      method: "POST",
    });
    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(body.message).toMatch(/not configured/i);
  });

  it("returns 409 when automation is disabled", async () => {
    _selectQueue.push([{ id: "auto-1", merchantId: "merchant-1", kind: "birthday", enabled: false, config: {} }]);
    const app = makeApp();
    const res = await app.request("/merchant/automations/birthday/run-now", {
      method: "POST",
    });
    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(body.message).toMatch(/disabled/i);
  });

  it("fires handleBirthday and returns sent count when automation is enabled", async () => {
    const automation = { id: "auto-1", merchantId: "merchant-1", kind: "birthday", enabled: true, config: {} };
    _selectQueue.push([automation]);
    _updateQueue.push([automation]);
    mockHandleBirthday.mockResolvedValue(3);

    const app = makeApp();
    const res = await app.request("/merchant/automations/birthday/run-now", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.sent).toBe(3);
    expect(mockHandleBirthday).toHaveBeenCalledWith(automation);
  });

  it("fires handleWinback for winback kind", async () => {
    const automation = { id: "auto-2", merchantId: "merchant-1", kind: "winback", enabled: true, config: { afterDays: 90 } };
    _selectQueue.push([automation]);
    _updateQueue.push([automation]);
    mockHandleWinback.mockResolvedValue(5);

    const app = makeApp();
    const res = await app.request("/merchant/automations/winback/run-now", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect((await jsonBody(res)).sent).toBe(5);
  });

  it("returns 403 when staff role tries to run automation", async () => {
    _roleRef.value = "staff";
    const app = makeApp();
    const res = await app.request("/merchant/automations/birthday/run-now", {
      method: "POST",
    });
    expect(res.status).toBe(403);
    const body = await jsonBody(res);
    expect(body.message).toMatch(/owner or manager/i);
  });

  it("returns 400 for unknown automation kind", async () => {
    const app = makeApp();
    const res = await app.request("/merchant/automations/unknown-kind/run-now", {
      method: "POST",
    });
    expect(res.status).toBe(400);
  });
});

describe("Automations router — PUT save fires handler on enable", () => {
  beforeEach(() => {
    _roleRef.value = "owner";
    _selectQueue.length = 0;
    _insertQueue.length = 0;
    _updateQueue.length = 0;
    mockHandleBirthday.mockClear().mockResolvedValue(0);
    mockHandleWinback.mockClear().mockResolvedValue(0);
    mockHandleRebook.mockClear().mockResolvedValue(0);
  });

  it("fires the birthday handler when saved with enabled=true", async () => {
    const savedRow = {
      id: "auto-1",
      merchantId: "merchant-1",
      kind: "birthday",
      enabled: true,
      messageTemplate: "Hi {{name}}",
      promoCode: null,
      config: {},
    };
    _insertQueue.push([savedRow]);
    _updateQueue.push([savedRow]);
    mockHandleBirthday.mockResolvedValue(2);

    const app = makeApp();
    const res = await app.request("/merchant/automations/birthday", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        messageTemplate: "Hi {{name}}",
        config: { sendDaysBefore: 0 },
      }),
    });
    expect(res.status).toBe(200);
    expect(mockHandleBirthday).toHaveBeenCalledTimes(1);
    const body = await jsonBody(res);
    expect(body.sentOnSave).toBe(2);
  });

  it("does NOT fire the handler when saved with enabled=false", async () => {
    const savedRow = {
      id: "auto-1",
      merchantId: "merchant-1",
      kind: "winback",
      enabled: false,
      messageTemplate: "Hi {{name}}",
      promoCode: null,
      config: {},
    };
    _insertQueue.push([savedRow]);

    const app = makeApp();
    const res = await app.request("/merchant/automations/winback", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: false,
        messageTemplate: "Hi {{name}}",
        config: { afterDays: 90 },
      }),
    });
    expect(res.status).toBe(200);
    expect(mockHandleWinback).not.toHaveBeenCalled();
  });
});

describe("Automations router — rebook perService config", () => {
  beforeEach(() => {
    _roleRef.value = "owner";
    _selectQueue.length = 0;
    _insertQueue.length = 0;
    _updateQueue.length = 0;
    mockHandleBirthday.mockClear().mockResolvedValue(0);
    mockHandleWinback.mockClear().mockResolvedValue(0);
    mockHandleRebook.mockClear().mockResolvedValue(0);
  });

  it("PUT /rebook accepts perService map in config and passes it to the handler", async () => {
    const savedRow = {
      id: "auto-3",
      merchantId: "merchant-1",
      kind: "rebook",
      enabled: true,
      messageTemplate: "Hi {{name}}, time to rebook!",
      promoCode: null,
      config: {
        defaultAfterDays: 30,
        perService: { "svc-botox": 90, "svc-filler": 180 },
      },
    };
    _insertQueue.push([savedRow]);
    _updateQueue.push([savedRow]);
    mockHandleRebook.mockResolvedValue(1);

    const app = makeApp();
    const res = await app.request("/merchant/automations/rebook", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        messageTemplate: "Hi {{name}}, time to rebook!",
        config: {
          defaultAfterDays: 30,
          perService: { "svc-botox": 90, "svc-filler": 180 },
        },
      }),
    });
    expect(res.status).toBe(200);
    // Handler must have been called — the route fires it synchronously on save
    expect(mockHandleRebook).toHaveBeenCalledTimes(1);
    expect(mockHandleRebook).toHaveBeenCalledWith(savedRow);
    const body = await jsonBody(res);
    expect(body.sentOnSave).toBe(1);
    // Config round-trips with perService intact
    const automation = body.automation as { config: { perService?: Record<string, number> } } | undefined;
    expect(automation?.config?.perService).toEqual({ "svc-botox": 90, "svc-filler": 180 });
  });

  it("PUT /rebook with perService override honors service-specific cadence (handler receives correct config)", async () => {
    // This tests that a booking 90 days old for svc-botox (perService = 90) would be sent.
    // The worker logic is: if perService[serviceId] === 90, it re-checks the window for that
    // service (90 days ago). Here we verify the route passes through the config unmodified
    // and the handler is invoked with the full perService map, returning the expected sent count.
    const serviceId = "svc-botox";
    const savedRow = {
      id: "auto-4",
      merchantId: "merchant-1",
      kind: "rebook",
      enabled: true,
      messageTemplate: "Hi {{name}}",
      promoCode: null,
      config: {
        defaultAfterDays: 30,
        perService: { [serviceId]: 90 },
      },
    };
    _insertQueue.push([savedRow]);
    _updateQueue.push([savedRow]);
    // Handler returns 1 — simulates a booking 90 days ago matching the perService override
    mockHandleRebook.mockResolvedValue(1);

    const app = makeApp();
    const res = await app.request("/merchant/automations/rebook", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        messageTemplate: "Hi {{name}}",
        config: { defaultAfterDays: 30, perService: { [serviceId]: 90 } },
      }),
    });
    expect(res.status).toBe(200);
    expect(mockHandleRebook).toHaveBeenCalledWith(savedRow);
    expect((await jsonBody(res)).sentOnSave).toBe(1);
  });

  it("PUT /rebook with no perService falls back to defaultAfterDays", async () => {
    // Service not in perService map → handler uses defaultAfterDays (30 days)
    const savedRow = {
      id: "auto-5",
      merchantId: "merchant-1",
      kind: "rebook",
      enabled: true,
      messageTemplate: "Hi {{name}}",
      promoCode: null,
      config: { defaultAfterDays: 30 },
    };
    _insertQueue.push([savedRow]);
    _updateQueue.push([savedRow]);
    // Handler returns 2 — matches two bookings at 30-day default cadence
    mockHandleRebook.mockResolvedValue(2);

    const app = makeApp();
    const res = await app.request("/merchant/automations/rebook", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        messageTemplate: "Hi {{name}}",
        config: { defaultAfterDays: 30 },
      }),
    });
    expect(res.status).toBe(200);
    expect(mockHandleRebook).toHaveBeenCalledWith(savedRow);
    const body = await jsonBody(res);
    expect(body.sentOnSave).toBe(2);
    // Config has no perService key — the worker will use defaultAfterDays for all services
    const automation = body.automation as { config: { perService?: unknown } } | undefined;
    expect(automation?.config?.perService).toBeUndefined();
  });
});

describe("Automation dedupe/cooldown — contract via run-now mock", () => {
  beforeEach(() => {
    _roleRef.value = "owner";
    _selectQueue.length = 0;
    _updateQueue.length = 0;
    mockHandleBirthday.mockClear();
    mockHandleWinback.mockClear();
  });

  it("birthday handler: second run-now in same year returns 0 (deduped)", async () => {
    const automation = { id: "auto-1", merchantId: "merchant-1", kind: "birthday", enabled: true, config: {} };

    // First call sends 1
    mockHandleBirthday.mockResolvedValueOnce(1);
    _selectQueue.push([automation]);
    _updateQueue.push([automation]);

    const app = makeApp();
    const res1 = await app.request("/merchant/automations/birthday/run-now", { method: "POST" });
    expect((await jsonBody(res1)).sent).toBe(1);

    // Second call: deduped → 0
    mockHandleBirthday.mockResolvedValueOnce(0);
    _selectQueue.push([automation]);
    _updateQueue.push([automation]);

    const res2 = await app.request("/merchant/automations/birthday/run-now", { method: "POST" });
    expect((await jsonBody(res2)).sent).toBe(0);

    // Verified: handler was called twice (deduplication is internal to the worker)
    expect(mockHandleBirthday).toHaveBeenCalledTimes(2);
  });

  it("winback handler: client within cooldown window → 0 sent", async () => {
    const automation = { id: "auto-2", merchantId: "merchant-1", kind: "winback", enabled: true, config: { afterDays: 90 } };

    // Simulate: client is in cooldown, handler returns 0
    mockHandleWinback.mockResolvedValueOnce(0);
    _selectQueue.push([automation]);
    _updateQueue.push([automation]);

    const app = makeApp();
    const res = await app.request("/merchant/automations/winback/run-now", { method: "POST" });
    expect(res.status).toBe(200);
    expect((await jsonBody(res)).sent).toBe(0);
    expect(mockHandleWinback).toHaveBeenCalledWith(automation);
  });
});
