/**
 * Tests for the super-admin routes.
 *
 * Covers:
 *   - PATCH /super/merchants/:id/tier rejects an invalid tier value (400)
 *   - PATCH /super/merchants/:id/tier writes the new tier, returns the updated
 *     merchant, and writes a row to super_admin_audit_log with
 *     action='write' and metadata.subAction='set_tier'
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppVariables } from "../lib/types.js";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const { _selectQueue, _updateQueue, _insertCalls, mockDb } = vi.hoisted(() => {
  const _selectQueue: unknown[] = [];
  const _updateQueue: unknown[] = [];
  const _insertCalls: Array<{ table: unknown; values: unknown }> = [];

  function makeMockChain(result: unknown) {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(() => Promise.resolve(result));
    chain.set = vi.fn(() => chain);
    chain.returning = vi.fn(() => Promise.resolve(result));
    chain.orderBy = vi.fn(() => chain);
    chain.offset = vi.fn(() => Promise.resolve(result));
    chain.leftJoin = vi.fn(() => chain);
    return chain;
  }

  const mockDb = {
    select: vi.fn(() => makeMockChain(_selectQueue.shift() ?? [])),
    update: vi.fn(() => makeMockChain(_updateQueue.shift() ?? [])),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        _insertCalls.push({ table, values });
        return Promise.resolve();
      }),
    })),
    execute: vi.fn(async () => ({ rows: [] })),
    selectDistinct: vi.fn(() => makeMockChain([])),
  };
  return { _selectQueue, _updateQueue, _insertCalls, mockDb };
});

// Tag schema objects with __name sentinels so we can assert which table the
// audit insert targeted without depending on real drizzle metadata.
vi.mock("@glowos/db", () => ({
  db: mockDb,
  superAdminAuditLog: { __name: "super_admin_audit_log" },
  merchants: { __name: "merchants" },
  merchantUsers: { __name: "merchant_users" },
  bookings: {},
  clients: {},
  notificationLog: {},
  whatsappInboundLog: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn(() => "and"),
  or: vi.fn(() => "or"),
  ilike: vi.fn(() => "ilike"),
  desc: vi.fn(() => "desc"),
  gte: vi.fn(() => "gte"),
  count: vi.fn(() => "count"),
  sum: vi.fn(() => "sum"),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn(() => "sql_raw") }),
}));

// ─── Auth middleware mock ─────────────────────────────────────────────────────
// In-test middleware override doesn't help because requireMerchant /
// requireSuperAdmin run first via superRouter.use("*", ...) and 401 on missing
// Authorization. Mock the module so they become no-ops that set the JWT
// claims our handler expects.
vi.mock("../middleware/auth.js", () => ({
  requireMerchant: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set("userId", "u1");
    c.set("merchantId", "host");
    c.set("userRole", "owner");
    c.set("superAdmin", true);
    c.set("impersonating", false);
    await next();
  },
  requireSuperAdmin: async (
    _c: unknown,
    next: () => Promise<void>,
  ) => {
    await next();
  },
}));

// JWT helpers are imported by super.ts (impersonate path). Stub them so import
// doesn't blow up if vitest evaluates the module greedily.
vi.mock("../lib/jwt.js", () => ({
  generateAccessToken: vi.fn(() => "test-access-token"),
  generateRefreshToken: vi.fn(() => "test-refresh-token"),
}));

vi.mock("../lib/config.js", () => ({
  isSuperAdminEmail: vi.fn(() => true),
}));

// ─── Import router after mocks ────────────────────────────────────────────────

import { superRouter } from "./super.js";

function buildApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.route("/super", superRouter);
  return app;
}

describe("PATCH /super/merchants/:id/tier", () => {
  beforeEach(() => {
    _selectQueue.length = 0;
    _updateQueue.length = 0;
    _insertCalls.length = 0;
    vi.clearAllMocks();
  });

  it("returns 400 when tier is not in the allowed enum", async () => {
    const app = buildApp();
    const res = await app.request("/super/merchants/m1/tier", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier: "platinum" }),
    });
    expect(res.status).toBe(400);
  });

  it("writes the new tier, returns the updated merchant, and audits the change", async () => {
    // 1st select: previous-tier read
    _selectQueue.push([{ id: "m1", subscriptionTier: "starter" }]);
    // update().returning(): updated row
    _updateQueue.push([
      { id: "m1", subscriptionTier: "multibranch", name: "Test" },
    ]);
    // 2nd select: actor email lookup inside logAudit's caller
    _selectQueue.push([{ email: "host@glowos.com" }]);

    const app = buildApp();
    const res = await app.request("/super/merchants/m1/tier", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier: "multibranch" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.subscriptionTier).toBe("multibranch");
    expect(body.id).toBe("m1");

    // Verify the audit insert landed in super_admin_audit_log with the
    // expected subAction discriminator + tier transition payload.
    const auditCall = _insertCalls.find(
      (call) =>
        (call.table as { __name?: string }).__name === "super_admin_audit_log",
    );
    expect(auditCall).toBeDefined();
    const values = auditCall!.values as {
      action: string;
      targetMerchantId: string;
      metadata: { subAction: string; previousTier: string; newTier: string };
    };
    expect(values.action).toBe("write");
    expect(values.targetMerchantId).toBe("m1");
    expect(values.metadata.subAction).toBe("set_tier");
    expect(values.metadata.previousTier).toBe("starter");
    expect(values.metadata.newTier).toBe("multibranch");
  });
});

describe("PATCH /super/merchants/:id/gateway", () => {
  beforeEach(() => {
    _selectQueue.length = 0;
    _updateQueue.length = 0;
    _insertCalls.length = 0;
    vi.clearAllMocks();
  });

  it("returns 400 when gateway is not in the allowed enum", async () => {
    const app = buildApp();
    const res = await app.request("/super/merchants/m1/gateway", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gateway: "hitpay" }),
    });
    expect(res.status).toBe(400);
  });

  it("writes the new gateway, returns the updated merchant, and audits the change", async () => {
    // 1st select: previous-gateway read
    _selectQueue.push([{ id: "m1", paymentGateway: "stripe" }]);
    // update().returning(): updated row
    _updateQueue.push([
      { id: "m1", paymentGateway: "ipay88", name: "Test" },
    ]);
    // 2nd select: actor email lookup
    _selectQueue.push([{ email: "host@glowos.com" }]);

    const app = buildApp();
    const res = await app.request("/super/merchants/m1/gateway", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gateway: "ipay88" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.paymentGateway).toBe("ipay88");
    expect(body.id).toBe("m1");

    const auditCall = _insertCalls.find(
      (call) =>
        (call.table as { __name?: string }).__name === "super_admin_audit_log",
    );
    expect(auditCall).toBeDefined();
    const values = auditCall!.values as {
      action: string;
      targetMerchantId: string;
      metadata: { subAction: string; previousGateway: string; newGateway: string };
    };
    expect(values.action).toBe("write");
    expect(values.targetMerchantId).toBe("m1");
    expect(values.metadata.subAction).toBe("set_gateway");
    expect(values.metadata.previousGateway).toBe("stripe");
    expect(values.metadata.newGateway).toBe("ipay88");
  });
});

describe("PATCH /super/merchants/:id/pilot", () => {
  beforeEach(() => {
    _selectQueue.length = 0;
    _updateQueue.length = 0;
    _insertCalls.length = 0;
    vi.clearAllMocks();
  });

  it("returns 400 when isPilot is not a boolean", async () => {
    const app = buildApp();
    const res = await app.request("/super/merchants/m1/pilot", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPilot: "yes" }),
    });
    expect(res.status).toBe(400);
  });

  it("writes the new pilot flag, returns the updated merchant, and audits the change", async () => {
    // 1st select: previous-pilot read
    _selectQueue.push([{ id: "m1", isPilot: false }]);
    // update().returning(): updated row
    _updateQueue.push([
      { id: "m1", isPilot: true, name: "Test" },
    ]);
    // 2nd select: actor email lookup
    _selectQueue.push([{ email: "host@glowos.com" }]);

    const app = buildApp();
    const res = await app.request("/super/merchants/m1/pilot", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPilot: true }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.isPilot).toBe(true);
    expect(body.id).toBe("m1");

    const auditCall = _insertCalls.find(
      (call) =>
        (call.table as { __name?: string }).__name === "super_admin_audit_log",
    );
    expect(auditCall).toBeDefined();
    const values = auditCall!.values as {
      action: string;
      targetMerchantId: string;
      metadata: { subAction: string; previousIsPilot: boolean; newIsPilot: boolean };
    };
    expect(values.action).toBe("write");
    expect(values.targetMerchantId).toBe("m1");
    expect(values.metadata.subAction).toBe("set_pilot");
    expect(values.metadata.previousIsPilot).toBe(false);
    expect(values.metadata.newIsPilot).toBe(true);
  });
});
