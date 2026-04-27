/**
 * Tests for requireMerchant and requireSuperAdmin middleware.
 * The DB is mocked at the module level so no real Postgres connection is needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { generateAccessToken } from "../lib/jwt.js";
import type { AppVariables } from "../lib/types.js";

// ─── DB mock ──────────────────────────────────────────────────────────────────
// We need a chainable mock for drizzle's builder pattern:
// db.select({...}).from(table).where(cond).limit(n)

type MockDbSelect = {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
};

const mockDbRows = { merchantUser: [] as object[], merchant: [] as object[] };

function makeMockChain(resolveWith: object[]): MockDbSelect {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockResolvedValue(resolveWith);
  return chain;
}

// Track how many times select() has been called to alternate between
// user-lookup and merchant-lookup.
let _selectCallCount = 0;
const mockSelect = vi.fn(() => {
  _selectCallCount++;
  // First select = merchantUsers lookup, second = merchants lookup
  if (_selectCallCount % 2 === 1) {
    return makeMockChain(mockDbRows.merchantUser);
  }
  return makeMockChain(mockDbRows.merchant);
});

vi.mock("@glowos/db", () => ({
  // vi.fn() infers no-arg signature; cast to accept any call shape from drizzle.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: { select: (_arg?: unknown) => (mockSelect as any)() },
  merchantUsers: { id: "id", email: "email", isActive: "isActive", merchantId: "merchantId", role: "role", staffId: "staffId", brandAdminGroupId: "brandAdminGroupId" },
  merchants: { id: "id", groupId: "groupId" },
}));

// ─── Config mock — provide a stable JWT secret ────────────────────────────────
vi.mock("../lib/config.js", () => ({
  config: {
    jwtSecret: "test-secret",
    jwtExpiry: "15m",
    refreshTokenExpiry: "30d",
    superAdminEmails: ["super@example.com"],
  },
  isSuperAdminEmail: (email: string) => email === "super@example.com",
}));

// Import after mocks are registered
import { requireMerchant, requireSuperAdmin } from "./auth.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeApp(handler?: (c: ReturnType<typeof createCtx>) => void) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireMerchant);
  app.get("/test", (c) => {
    handler?.(c as unknown as ReturnType<typeof createCtx>);
    return c.json({ ok: true });
  });
  return app;
}

function createCtx() {
  return {} as Record<string, unknown>;
}

function validUserRow(overrides: Partial<{
  id: string;
  email: string;
  isActive: boolean;
  merchantId: string;
  role: string;
  staffId: string | null;
  brandAdminGroupId: string | null;
}> = {}) {
  return {
    id: "user-1",
    email: "user@example.com",
    isActive: true,
    merchantId: "merchant-1",
    role: "owner",
    staffId: null,
    brandAdminGroupId: null,
    ...overrides,
  };
}

function bearerToken(payload: Parameters<typeof generateAccessToken>[0]) {
  return `Bearer ${generateAccessToken(payload)}`;
}

type ApiBody = { error?: string; message?: string; [key: string]: unknown };
async function jsonBody(res: Response): Promise<ApiBody> {
  return res.json() as Promise<ApiBody>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("requireMerchant", () => {
  beforeEach(() => {
    _selectCallCount = 0;
    mockSelect.mockClear();
    mockDbRows.merchantUser = [];
    mockDbRows.merchant = [];
  });

  it("returns 401 when Authorization header is missing", async () => {
    const app = makeApp();
    const res = await app.request("/test");
    expect(res.status).toBe(401);
    const body = await jsonBody(res);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when Authorization header has wrong prefix", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      headers: { Authorization: "Basic abc123" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is invalid/expired", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer invalid.jwt.token" },
    });
    expect(res.status).toBe(401);
    const body = await jsonBody(res);
    expect(body.message).toMatch(/invalid or expired/i);
  });

  it("returns 401 when user is not found in DB", async () => {
    mockDbRows.merchantUser = [];
    const app = makeApp();
    const token = bearerToken({ userId: "user-1", merchantId: "merchant-1", role: "owner" });
    const res = await app.request("/test", { headers: { Authorization: token } });
    expect(res.status).toBe(401);
    const body = await jsonBody(res);
    expect(body.message).toMatch(/inactive or not found/i);
  });

  it("returns 401 when user.isActive is false", async () => {
    mockDbRows.merchantUser = [validUserRow({ isActive: false })];
    const app = makeApp();
    const token = bearerToken({ userId: "user-1", merchantId: "merchant-1", role: "owner" });
    const res = await app.request("/test", { headers: { Authorization: token } });
    expect(res.status).toBe(401);
  });

  it("calls next() and sets merchantId/userRole for a valid active user", async () => {
    mockDbRows.merchantUser = [validUserRow()];
    let capturedMerchantId: unknown;
    let capturedRole: unknown;
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", requireMerchant);
    app.get("/test", (c) => {
      capturedMerchantId = c.get("merchantId");
      capturedRole = c.get("userRole");
      return c.json({ ok: true });
    });
    const token = bearerToken({ userId: "user-1", merchantId: "merchant-1", role: "owner" });
    const res = await app.request("/test", { headers: { Authorization: token } });
    expect(res.status).toBe(200);
    expect(capturedMerchantId).toBe("merchant-1");
    expect(capturedRole).toBe("owner");
  });

  it("sets viewingMerchantId + userRole=owner when viewingMerchantId claim is valid and in same group", async () => {
    // First DB call = user lookup (with brandAdminGroupId set)
    // Second DB call = merchant lookup (target merchant in same group)
    mockDbRows.merchantUser = [validUserRow({ brandAdminGroupId: "group-1" })];
    mockDbRows.merchant = [{ id: "branch-2", groupId: "group-1" }];

    let capturedMerchantId: unknown;
    let capturedRole: unknown;
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", requireMerchant);
    app.get("/test", (c) => {
      capturedMerchantId = c.get("merchantId");
      capturedRole = c.get("userRole");
      return c.json({ ok: true });
    });

    const token = bearerToken({
      userId: "user-1",
      merchantId: "merchant-1",
      role: "owner",
      viewingMerchantId: "branch-2",
      brandAdminGroupId: "group-1",
    });
    const res = await app.request("/test", { headers: { Authorization: token } });
    expect(res.status).toBe(200);
    expect(capturedMerchantId).toBe("branch-2");
    expect(capturedRole).toBe("owner");
  });

  it("returns 403 when viewingMerchantId claim present but user has no brandAdminGroupId", async () => {
    mockDbRows.merchantUser = [validUserRow({ brandAdminGroupId: null })];
    const app = makeApp();
    const token = bearerToken({
      userId: "user-1",
      merchantId: "merchant-1",
      role: "owner",
      viewingMerchantId: "branch-2",
    });
    const res = await app.request("/test", { headers: { Authorization: token } });
    expect(res.status).toBe(403);
    const body = await jsonBody(res);
    expect(body.message).toMatch(/brand authority revoked/i);
  });

  it("returns 403 when viewingMerchantId target merchant is in a different group", async () => {
    mockDbRows.merchantUser = [validUserRow({ brandAdminGroupId: "group-1" })];
    mockDbRows.merchant = [{ id: "branch-x", groupId: "group-OTHER" }];

    const app = makeApp();
    const token = bearerToken({
      userId: "user-1",
      merchantId: "merchant-1",
      role: "owner",
      viewingMerchantId: "branch-x",
      brandAdminGroupId: "group-1",
    });
    const res = await app.request("/test", { headers: { Authorization: token } });
    expect(res.status).toBe(403);
    const body = await jsonBody(res);
    expect(body.message).toMatch(/not in your group/i);
  });

  it("returns 403 when viewingMerchantId target merchant is not found", async () => {
    mockDbRows.merchantUser = [validUserRow({ brandAdminGroupId: "group-1" })];
    // Second select returns empty — merchant not found
    mockDbRows.merchant = [];

    const app = makeApp();
    const token = bearerToken({
      userId: "user-1",
      merchantId: "merchant-1",
      role: "owner",
      viewingMerchantId: "nonexistent",
      brandAdminGroupId: "group-1",
    });
    const res = await app.request("/test", { headers: { Authorization: token } });
    expect(res.status).toBe(403);
  });
});

describe("requireSuperAdmin", () => {
  it("returns 403 when superAdmin context variable is not set", async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", requireSuperAdmin);
    app.get("/super", (c) => c.json({ ok: true }));
    const res = await app.request("/super");
    expect(res.status).toBe(403);
    const body = await jsonBody(res);
    expect(body.message).toMatch(/superadmin access required/i);
  });

  it("returns 403 when impersonating is true even if superAdmin is set", async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", async (c, next) => {
      c.set("superAdmin", true);
      c.set("impersonating", true);
      await next();
    });
    app.use("*", requireSuperAdmin);
    app.get("/super", (c) => c.json({ ok: true }));
    const res = await app.request("/super");
    expect(res.status).toBe(403);
    const body = await jsonBody(res);
    expect(body.message).toMatch(/end impersonation/i);
  });

  it("calls next() when superAdmin=true and impersonating is not set", async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", async (c, next) => {
      c.set("superAdmin", true);
      await next();
    });
    app.use("*", requireSuperAdmin);
    app.get("/super", (c) => c.json({ ok: true }));
    const res = await app.request("/super");
    expect(res.status).toBe(200);
  });
});
