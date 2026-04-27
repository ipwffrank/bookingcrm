/**
 * Tests for the merchant routes.
 *
 * Covers:
 *   - POST /merchant/upgrade-to-brand returns 403 Forbidden when merchant is on
 *     the 'starter' tier (and never opens a transaction)
 *   - POST /merchant/upgrade-to-brand proceeds past the tier check when the
 *     merchant is on 'multibranch'
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppVariables } from "../lib/types.js";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const { _selectQueue, mockDb } = vi.hoisted(() => {
  const _selectQueue: unknown[] = [];

  function makeMockChain(result: unknown) {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(() => Promise.resolve(result));
    chain.set = vi.fn(() => chain);
    chain.values = vi.fn(() => chain);
    chain.returning = vi.fn(() => Promise.resolve(result));
    return chain;
  }

  const mockDb: Record<string, unknown> = {
    select: vi.fn(() => {
      const result = _selectQueue.shift() ?? [];
      return makeMockChain(result);
    }),
    insert: vi.fn(() => makeMockChain([])),
    update: vi.fn(() => makeMockChain([])),
  };
  // transaction passes the same mockDb in as `tx`, so tx.select etc. share
  // the queue. Defined after so we can self-reference.
  mockDb.transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockDb));

  return { _selectQueue, mockDb };
});

vi.mock("@glowos/db", () => ({
  db: mockDb,
  merchants: {},
  merchantUsers: {},
  groups: {},
  clinicalRecordAccessLog: {},
  clients: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn(() => "and"),
  gte: vi.fn(() => "gte"),
  lte: vi.fn(() => "lte"),
}));

// ─── Auth + validate middleware mocks ─────────────────────────────────────────

const { _authState } = vi.hoisted(() => {
  return {
    _authState: {
      userId: "u1",
      merchantId: "m1",
      role: "owner",
      impersonating: false,
    },
  };
});

vi.mock("../middleware/auth.js", () => ({
  requireMerchant: vi.fn(
    async (
      c: { set: (k: string, v: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("userId", _authState.userId);
      c.set("merchantId", _authState.merchantId);
      c.set("userRole", _authState.role);
      if (_authState.impersonating) c.set("impersonating", true);
      await next();
    },
  ),
  requireRole: () => async (
    c: { get: (k: string) => unknown; json: (b: unknown, s?: number) => Response },
    next: () => Promise<void>,
  ) => {
    // Permissive in tests — role gating is exercised elsewhere.
    void c;
    await next();
  },
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

// JWT helpers are imported by the router; stub them so token issuance during
// the success path doesn't blow up if/when we exercise it.
vi.mock("../lib/jwt.js", () => ({
  generateAccessToken: vi.fn(() => "test-access-token"),
  generateRefreshToken: vi.fn(() => "test-refresh-token"),
}));

// ─── Import router after mocks ────────────────────────────────────────────────

import { merchantRouter } from "./merchant.js";

function buildApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.route("/merchant", merchantRouter);
  return app;
}

describe("POST /merchant/upgrade-to-brand — tier gate", () => {
  beforeEach(() => {
    _selectQueue.length = 0;
    _authState.userId = "u1";
    _authState.merchantId = "m1";
    _authState.role = "owner";
    _authState.impersonating = false;
    vi.clearAllMocks();
  });

  it("returns 403 Forbidden when subscription_tier is 'starter'", async () => {
    // First select inside handler is the merchant row to read tier.
    _selectQueue.push([{ id: "m1", tier: "starter" }]);

    const app = buildApp();
    const res = await app.request("/merchant/upgrade-to-brand", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupName: "My Group" }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("Forbidden");
    expect(body.message).toMatch(/multi-branch/i);
    // Confirm the handler short-circuited before opening the transaction.
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("passes the tier check when subscription_tier is 'multibranch'", async () => {
    // Tier read returns multibranch; transaction reads then return inactive
    // user so the handler exits with a different error AFTER the tier check.
    // We're only asserting the tier check no longer blocks.
    _selectQueue.push([{ id: "m1", tier: "multibranch" }]);
    _selectQueue.push([]); // user lookup inside tx → no row → "user_inactive"

    const app = buildApp();
    const res = await app.request("/merchant/upgrade-to-brand", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupName: "My Group" }),
    });

    // Deterministic post-gate outcome: the in-tx user lookup returns no row,
    // hitting the `user_inactive` switch case which maps to 401 Unauthorized.
    // Asserting the exact status (vs. just `not.toBe(403)`) guards against
    // future changes that might silently break the gate-passes-through path.
    expect(res.status).toBe(401);
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it("passes the tier check for any non-starter tier (e.g. 'professional')", async () => {
    // Production already has 'professional' tier merchants. Gate policy is
    // "block only starter", so 'professional' must pass — this test pins
    // that behaviour against accidental tightening to a strict allow-list.
    _selectQueue.push([{ id: "m1", tier: "professional" }]);
    _selectQueue.push([]); // user lookup → no row → "user_inactive" (post-gate)

    const app = buildApp();
    const res = await app.request("/merchant/upgrade-to-brand", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupName: "My Group" }),
    });

    expect(res.status).toBe(401);
    expect(mockDb.transaction).toHaveBeenCalled();
  });
});
