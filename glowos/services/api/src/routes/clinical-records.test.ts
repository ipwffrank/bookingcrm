/**
 * Tests for the clinical-records router.
 * The DB, @vercel/blob, and auth middleware are fully mocked.
 *
 * Router path structure (mirroring how it's mounted in index.ts):
 *   GET  /merchant/clients/:profileId/clinical-records
 *   POST /merchant/clients/:profileId/clinical-records
 *   POST /merchant/clients/:profileId/clinical-records/:recordId/amend
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppVariables } from "../lib/types.js";

// ─── Hoisted mock state ───────────────────────────────────────────────────────
// vi.mock factories are hoisted to the top of the file by Vitest's transformer.
// Variables used inside them must also be hoisted with vi.hoisted().

const { _selectQueue, _insertQueue, mockDb } = vi.hoisted(() => {
  const _selectQueue: unknown[] = [];
  const _insertQueue: unknown[] = [];

  function makeMockChain(result: unknown) {
    // Make the chain object itself thenable so that `await chain` resolves.
    // This handles cases where drizzle queries end without `.limit()`.
    const chain: Record<string, unknown> & { then?: (resolve: (v: unknown) => void) => void } = {
      then(resolve: (v: unknown) => void) { resolve(result); },
    };
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(() => Promise.resolve(result));
    chain.returning = vi.fn(() => Promise.resolve(result));
    chain.values = vi.fn(() => chain);
    chain.orderBy = vi.fn(() => chain);
    chain.set = vi.fn(() => chain);
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
    update: vi.fn(() => makeMockChain([])),
  };

  return { _selectQueue, _insertQueue, mockDb };
});

vi.mock("@glowos/db", () => ({
  db: mockDb,
  clinicalRecords: {},
  clinicalRecordAccessLog: {},
  clientProfiles: {},
  merchantUsers: {},
  clients: {},
  merchants: {},
  bookings: {},
  clientNotes: {},
  clientPackages: {},
  packageSessions: {},
  reviews: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn(() => "and"),
  desc: vi.fn(() => "desc"),
}));

// ─── Vercel Blob mock ─────────────────────────────────────────────────────────

vi.mock("@vercel/blob", () => ({
  put: vi.fn().mockResolvedValue({ url: "https://blob.example.com/file", pathname: "clinical/file" }),
  del: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue(null),
}));

// ─── Auth middleware mock ─────────────────────────────────────────────────────

const { _injectedRoleRef } = vi.hoisted(() => {
  const _injectedRoleRef = { value: "owner" };
  return { _injectedRoleRef };
});

vi.mock("../middleware/auth.js", () => ({
  requireMerchant: vi.fn(async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set("userId", "user-1");
    c.set("merchantId", "merchant-1");
    c.set("userRole", _injectedRoleRef.value);
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
        return c.json({ error: "Bad Request", message: "Request body must be valid JSON" }, 400);
      }
      const result = schema.safeParse(raw);
      if (!result.success) return c.json({ error: "Validation Error", message: "Validation failed" }, 400);
      c.set("body", result.data);
      await next();
    },
}));

// ─── Import router after mocks ────────────────────────────────────────────────

import { clinicalRecordsRouter } from "./clinical-records.js";

type ApiBody = { error?: string; message?: string; record?: { id?: string; [k: string]: unknown }; [key: string]: unknown };
async function jsonBody(res: Response): Promise<ApiBody> {
  return res.json() as Promise<ApiBody>;
}

// ─── Test app factory ─────────────────────────────────────────────────────────

function makeApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.route("/merchant/clients", clinicalRecordsRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Clinical records — auth gate (role check)", () => {
  beforeEach(() => {
    _injectedRoleRef.value = "owner";
    _selectQueue.length = 0;
    _insertQueue.length = 0;
    vi.clearAllMocks();
  });

  it("staff role → 403 with 'owner or clinician' message", async () => {
    _injectedRoleRef.value = "staff";
    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/clinical-records", {
      method: "GET",
    });
    expect(res.status).toBe(403);
    const body = await jsonBody(res);
    expect(body.message).toMatch(/owner or clinician/i);
  });

  it("manager role → 403 (manager no longer has clinical access)", async () => {
    _injectedRoleRef.value = "manager";
    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/clinical-records");
    expect(res.status).toBe(403);
    const body = await jsonBody(res);
    expect(body.message).toMatch(/owner or clinician/i);
  });

  it("clinician role → proceeds past role gate (returns 200)", async () => {
    _injectedRoleRef.value = "clinician";
    _selectQueue.push([{ clientId: "client-1" }]);  // resolveClientId
    _selectQueue.push([]);                            // records query
    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/clinical-records");
    expect(res.status).toBe(200);
  });

  it("owner role → proceeds past role gate (returns 200)", async () => {
    _injectedRoleRef.value = "owner";
    _selectQueue.push([{ clientId: "client-1" }]);
    _selectQueue.push([]);
    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/clinical-records");
    expect(res.status).toBe(200);
  });
});

describe("Clinical records — POST create", () => {
  beforeEach(() => {
    _injectedRoleRef.value = "owner";
    _selectQueue.length = 0;
    _insertQueue.length = 0;
    vi.clearAllMocks();
  });

  it("returns 404 when client profile not found", async () => {
    _selectQueue.push([]);  // resolveClientId returns empty
    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/clinical-records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "consultation_note", body: "Some notes" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when body field is missing (schema validation fails)", async () => {
    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/clinical-records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // omit body field (schema requires body: string.min(1))
      body: JSON.stringify({ type: "consultation_note" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 201 with record.id when valid body is provided", async () => {
    const newRecord = {
      id: "rec-1",
      merchantId: "merchant-1",
      clientId: "client-1",
      type: "consultation_note",
      body: "Detailed notes",
    };
    _selectQueue.push([{ clientId: "client-1" }]);                 // resolveClientId
    _selectQueue.push([{ name: "Dr Smith", email: "dr@spa.com" }]); // user lookup
    _insertQueue.push([newRecord]);   // clinicalRecords insert
    _insertQueue.push([]);            // access log insert

    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/clinical-records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "consultation_note", body: "Detailed notes" }),
    });
    expect(res.status).toBe(201);
    const resp = await jsonBody(res);
    expect(resp.record?.id).toBe("rec-1");
  });

  it("returns 400 when type is 'amendment' (not a valid enum value)", async () => {
    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/clinical-records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "amendment", body: "Some notes" }),
    });
    // zValidator rejects: "amendment" not in enum [consultation_note, treatment_log, prescription]
    expect(res.status).toBe(400);
  });
});

describe("Clinical records — POST amend", () => {
  beforeEach(() => {
    _injectedRoleRef.value = "owner";
    _selectQueue.length = 0;
    _insertQueue.length = 0;
    vi.clearAllMocks();
  });

  it("returns 404 when the record to amend does not exist", async () => {
    _selectQueue.push([{ clientId: "client-1" }]);  // resolveClientId
    _selectQueue.push([]);                            // prior record lookup → empty

    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/clinical-records/rec-99/amend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "amendment text", amendmentReason: "Correcting typo" }),
    });
    expect(res.status).toBe(404);
    const body = await jsonBody(res);
    expect(body.message).toMatch(/record not found/i);
  });

  it("returns 400 when amendmentReason is missing", async () => {
    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/clinical-records/rec-1/amend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "amendment text" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 201 when amendment succeeds on a valid (non-locked) record", async () => {
    _selectQueue.push([{ clientId: "client-1" }]);
    _selectQueue.push([{
      id: "rec-1",
      type: "consultation_note",
      title: null,
      serviceId: null,
      bookingId: null,
      lockedAt: null,
    }]);
    _selectQueue.push([{ name: "Dr Smith", email: "dr@spa.com" }]);  // user lookup
    _insertQueue.push([{ id: "rec-2", type: "consultation_note" }]); // amendment insert
    _insertQueue.push([]);                                             // access log

    const app = makeApp();
    const res = await app.request("/merchant/clients/profile-1/clinical-records/rec-1/amend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "corrected text", amendmentReason: "Typo fix" }),
    });
    expect(res.status).toBe(201);
    const resp = await jsonBody(res);
    expect(resp.record?.id).toBe("rec-2");
  });
});
