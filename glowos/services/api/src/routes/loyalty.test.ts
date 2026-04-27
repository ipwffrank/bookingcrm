/**
 * Tests for the loyalty routes.
 *
 * Tests:
 *   - GET /merchant/loyalty/program — returns default when no row
 *   - PUT /merchant/loyalty/program — upserts, validates zod ranges
 *   - Balance: SUM of earns + redeem = correct net
 *   - Manual adjust requires manager/owner (staff → 403)
 *   - Redeem fails if balance insufficient (409)
 *   - Redeem fails if program disabled (409)
 *   - Redeem fails below minRedeemPoints (409)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppVariables } from "../lib/types.js";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const { _selectQueue, _insertQueue, mockDb } = vi.hoisted(() => {
  const _selectQueue: unknown[] = [];
  const _insertQueue: unknown[] = [];

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
  };

  return { _selectQueue, _insertQueue, mockDb };
});

vi.mock("@glowos/db", () => ({
  db: mockDb,
  loyaltyPrograms: {},
  loyaltyTransactions: {},
  merchantUsers: {},
  clientProfiles: {},
  clients: {},
  merchants: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn(() => "and"),
  desc: vi.fn(() => "desc"),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn(() => "sql_raw") }),
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

// ─── Import routers after mocks ───────────────────────────────────────────────

import { loyaltyProgramRouter, loyaltyClientRouter } from "./loyalty.js";

type ApiBody = Record<string, unknown>;
async function jsonBody(res: Response): Promise<ApiBody> {
  return res.json() as Promise<ApiBody>;
}

function makeApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.route("/merchant/loyalty", loyaltyProgramRouter);
  app.route("/merchant/clients", loyaltyClientRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /merchant/loyalty/program", () => {
  beforeEach(() => {
    _roleRef.value = "owner";
    _selectQueue.length = 0;
    _insertQueue.length = 0;
  });

  it("returns default shape when no DB row exists", async () => {
    _selectQueue.push([]); // no row
    const app = makeApp();
    const res = await app.request("/merchant/loyalty/program");
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    const program = body.program as Record<string, unknown>;
    expect(program.id).toBeNull();
    expect(program.enabled).toBe(false);
    expect(program.pointsPerDollar).toBe(1);
  });

  it("returns existing row when found", async () => {
    const existing = { id: "lp-1", merchantId: "merchant-1", enabled: true, pointsPerDollar: 2 };
    _selectQueue.push([existing]);
    const app = makeApp();
    const res = await app.request("/merchant/loyalty/program");
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect((body.program as Record<string, unknown>).id).toBe("lp-1");
  });

  it("returns 403 for staff role", async () => {
    _roleRef.value = "staff";
    const app = makeApp();
    const res = await app.request("/merchant/loyalty/program");
    expect(res.status).toBe(403);
  });
});

describe("PUT /merchant/loyalty/program", () => {
  beforeEach(() => {
    _roleRef.value = "owner";
    _selectQueue.length = 0;
    _insertQueue.length = 0;
  });

  const validBody = {
    enabled: true,
    pointsPerDollar: 1,
    pointsPerVisit: 0,
    pointsPerDollarRedeem: 100,
    minRedeemPoints: 100,
    earnExpiryMonths: 0,
  };

  it("upserts and returns program row", async () => {
    const row = { id: "lp-1", merchantId: "merchant-1", ...validBody };
    _insertQueue.push([row]);
    const app = makeApp();
    const res = await app.request("/merchant/loyalty/program", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect((body.program as Record<string, unknown>).id).toBe("lp-1");
  });

  it("returns 400 when pointsPerDollar is negative", async () => {
    const app = makeApp();
    const res = await app.request("/merchant/loyalty/program", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, pointsPerDollar: -1 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when pointsPerDollar exceeds max (100)", async () => {
    const app = makeApp();
    const res = await app.request("/merchant/loyalty/program", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, pointsPerDollar: 101 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when earnExpiryMonths exceeds max (60)", async () => {
    const app = makeApp();
    const res = await app.request("/merchant/loyalty/program", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, earnExpiryMonths: 61 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 for manager role (owner-only write)", async () => {
    _roleRef.value = "manager";
    const app = makeApp();
    const res = await app.request("/merchant/loyalty/program", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /merchant/clients/:profileId/loyalty — balance calculation", () => {
  beforeEach(() => {
    _roleRef.value = "owner";
    _selectQueue.length = 0;
    _insertQueue.length = 0;
  });

  it("returns correct net balance: two earns + one redeem", async () => {
    // profile lookup → returns clientId
    _selectQueue.push([{ clientId: "client-1" }]);
    // program lookup
    _selectQueue.push([{ id: "lp-1", enabled: true, pointsPerDollar: 1, pointsPerVisit: 0, pointsPerDollarRedeem: 100, minRedeemPoints: 100, earnExpiryMonths: 0 }]);
    // SUM query — coalesce returns "150"
    _selectQueue.push([{ balance: "150" }]);
    // recent transactions list
    _selectQueue.push([
      { id: "tx-1", kind: "earn", amount: 100, createdAt: new Date().toISOString() },
      { id: "tx-2", kind: "earn", amount: 100, createdAt: new Date().toISOString() },
      { id: "tx-3", kind: "redeem", amount: -50, createdAt: new Date().toISOString() },
    ]);

    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/loyalty");
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.balance).toBe(150);
    const txns = body.recentTransactions as Array<{ amount: number }>;
    expect(txns).toHaveLength(3);
  });

  it("returns 404 when profile not found", async () => {
    _selectQueue.push([]); // profile not found
    const app = makeApp();
    const res = await app.request("/merchant/clients/bogus/loyalty");
    expect(res.status).toBe(404);
  });
});

describe("POST /merchant/clients/:profileId/loyalty/adjust", () => {
  beforeEach(() => {
    _roleRef.value = "owner";
    _selectQueue.length = 0;
    _insertQueue.length = 0;
  });

  it("returns 403 for staff role", async () => {
    _roleRef.value = "staff";
    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/loyalty/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 50, reason: "Goodwill" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 for clinician role", async () => {
    _roleRef.value = "clinician";
    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/loyalty/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 50, reason: "Goodwill" }),
    });
    expect(res.status).toBe(403);
  });

  it("inserts transaction and returns new balance for manager", async () => {
    _roleRef.value = "manager";
    // profile lookup
    _selectQueue.push([{ clientId: "client-1" }]);
    // actor lookup
    _selectQueue.push([{ name: "Jane Manager" }]);
    // insert transaction returns
    _insertQueue.push([{ id: "tx-new", kind: "adjust", amount: 50 }]);
    // balance refetch
    _selectQueue.push([{ balance: "150" }]);

    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/loyalty/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 50, reason: "Goodwill credit" }),
    });
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.newBalance).toBe(150);
  });

  it("returns 400 for zero amount", async () => {
    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/loyalty/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 0, reason: "Test" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /merchant/clients/:profileId/loyalty/redeem", () => {
  beforeEach(() => {
    _roleRef.value = "owner";
    _selectQueue.length = 0;
    _insertQueue.length = 0;
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

  it("fails with 409 when program is disabled", async () => {
    _selectQueue.push([{ clientId: "client-1" }]);
    _selectQueue.push([{ ...enabledProgram, enabled: false }]);
    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/loyalty/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: 100 }),
    });
    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(String(body.message)).toMatch(/not enabled/i);
  });

  it("fails with 409 when balance is insufficient", async () => {
    _selectQueue.push([{ clientId: "client-1" }]);
    _selectQueue.push([enabledProgram]);
    _selectQueue.push([{ balance: "50" }]); // balance only 50

    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/loyalty/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: 100 }),
    });
    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(String(body.message)).toMatch(/insufficient/i);
  });

  it("fails with 409 when points below minRedeemPoints", async () => {
    _selectQueue.push([{ clientId: "client-1" }]);
    _selectQueue.push([{ ...enabledProgram, minRedeemPoints: 200 }]);
    _selectQueue.push([{ balance: "500" }]);

    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/loyalty/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: 100 }),
    });
    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(String(body.message)).toMatch(/minimum/i);
  });

  it("succeeds and returns sgdValue when valid", async () => {
    _selectQueue.push([{ clientId: "client-1" }]);
    _selectQueue.push([enabledProgram]);
    _selectQueue.push([{ balance: "500" }]);
    // actor lookup
    _selectQueue.push([{ name: "Admin User" }]);
    // insert
    _insertQueue.push([{ id: "tx-redeem", kind: "redeem", amount: -200 }]);
    // new balance
    _selectQueue.push([{ balance: "300" }]);

    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/loyalty/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: 200 }),
    });
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.pointsRedeemed).toBe(200);
    expect(body.sgdValue).toBe("2.00");
    expect(body.newBalance).toBe(300);
  });
});
