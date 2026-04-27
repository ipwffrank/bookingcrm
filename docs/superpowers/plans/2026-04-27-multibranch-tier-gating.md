# Multi-branch Tier Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the multi-branch capability (Group tab + `/merchant/upgrade-to-brand` endpoint) behind `merchants.subscription_tier === 'multibranch'`. Add a host-side tier-flip control in `/super/merchants` and a contact-us upsell card on the merchant Settings page.

**Architecture:** Soft gate (no data destruction on downgrade). One new endpoint (`PATCH /super/merchants/:id/tier`), one modified endpoint (`POST /merchant/upgrade-to-brand` with tier check), four frontend touchpoints (`dashboard/layout.tsx` for Group nav, `dashboard/group/layout.tsx` for route guard, `dashboard/settings/page.tsx` for upsell card, `super/merchants/page.tsx` for Tier column). All tier writes go through the existing `logAudit` helper in `super.ts`. No DB migration — `subscription_tier` column already exists.

**Tech Stack:** Hono (API), Drizzle ORM, Vitest, Next.js 15 (web), Tailwind, pnpm workspaces.

**Spec:** `~/Desktop/projects/bookingcrm - doc/2026-04-27-multibranch-tier-gating-design.md`

**Spec deviation:** The spec said audit `action: 'set_tier'`, but the `super_admin_audit_log.action` column is a typed enum of `"impersonate_start" | "impersonate_end" | "write" | "read"`. To avoid a schema migration we'll log with `action: 'write'` and put the discriminator in `metadata: { event: 'set_tier', previous_tier, new_tier }`. The audit-log UI already renders metadata, so this stays queryable.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `glowos/services/api/src/routes/merchant.ts` | modify | Add tier check at top of `POST /merchant/upgrade-to-brand` handler |
| `glowos/services/api/src/routes/merchant.test.ts` | **create** | Vitest tests for the tier gate on `/merchant/upgrade-to-brand` |
| `glowos/services/api/src/routes/super.ts` | modify | Add `PATCH /super/merchants/:id/tier` handler |
| `glowos/services/api/src/routes/super.test.ts` | **create** | Vitest tests for the tier-flip endpoint (auth, validation, audit insert) |
| `glowos/apps/web/app/dashboard/layout.tsx` | modify | Extend `Merchant` interface with `subscription_tier` + `groupId`; gate Group nav on tier |
| `glowos/apps/web/app/dashboard/group/layout.tsx` | modify | Add tier guard: redirect starter-tier callers to `/dashboard` |
| `glowos/apps/web/app/dashboard/settings/page.tsx` | modify | Render Multi-Branch upsell card when `subscription_tier === 'starter'` |
| `glowos/apps/web/app/super/merchants/page.tsx` | modify | Add Tier column with inline dropdown + PATCH wiring |

No new files outside the two test files. No DB migration.

---

## Task 0: Setup branch

**Files:**
- None (git only)

- [ ] **Step 1: Confirm clean working state for the feature branch**

The repo currently has an unrelated uncommitted diff in `glowos/apps/web/app/dashboard/components/ClientFullDetail.tsx` on branch `fix/redemption-at-checkin`. Stash it so the new branch starts clean:

```bash
cd ~/code/Bookingcrm
git stash push -m "fix/redemption-at-checkin WIP — restored after multibranch work" -- glowos/apps/web/app/dashboard/components/ClientFullDetail.tsx
git status -s
```
Expected: `git status -s` returns no output.

- [ ] **Step 2: Branch off main**

```bash
git checkout main
git pull --ff-only
git checkout -b feat/multibranch-tier-gating
```

Expected: on branch `feat/multibranch-tier-gating`, working tree clean.

- [ ] **Step 3: Sanity-check tier column exists**

```bash
grep -n "subscriptionTier" glowos/packages/db/src/schema/merchants.ts
```
Expected: one match, line ≈51, default `"starter"`. If missing, stop and surface — the spec assumes it exists.

---

## Task 1: Backend — gate `/merchant/upgrade-to-brand` on tier (TDD)

**Files:**
- Create: `glowos/services/api/src/routes/merchant.test.ts`
- Modify: `glowos/services/api/src/routes/merchant.ts` — handler at line 195 (`/upgrade-to-brand`)

- [ ] **Step 1: Write the failing test file**

Model after `glowos/services/api/src/routes/loyalty.test.ts` for the hoisted-mock pattern. Create `glowos/services/api/src/routes/merchant.test.ts` with:

```typescript
/**
 * Tests for the merchant routes.
 *
 * Covers:
 *   - POST /merchant/upgrade-to-brand returns 403 PlanGate when merchant is on
 *     the 'starter' tier (and never opens a transaction)
 *   - POST /merchant/upgrade-to-brand proceeds past the tier check when the
 *     merchant is on 'multibranch'
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppVariables } from "../lib/types.js";

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

  const mockDb = {
    select: vi.fn(() => {
      const result = _selectQueue.shift() ?? [];
      return makeMockChain(result);
    }),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockDb)),
    insert: vi.fn(() => makeMockChain([])),
    update: vi.fn(() => makeMockChain([])),
  };

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

import { merchantRouter } from "./merchant.js";

function buildApp(opts: { merchantId: string; userId: string; role: string; impersonating?: boolean }) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", async (c, next) => {
    c.set("userId", opts.userId);
    c.set("merchantId", opts.merchantId);
    c.set("userRole", opts.role);
    c.set("impersonating", opts.impersonating ?? false);
    await next();
  });
  app.route("/merchant", merchantRouter);
  return app;
}

describe("POST /merchant/upgrade-to-brand — tier gate", () => {
  beforeEach(() => {
    _selectQueue.length = 0;
    vi.clearAllMocks();
  });

  it("returns 403 PlanGate when subscription_tier is 'starter'", async () => {
    // First select inside handler is the merchant row to read tier.
    _selectQueue.push([{ id: "m1", subscriptionTier: "starter", groupId: null }]);

    const app = buildApp({ merchantId: "m1", userId: "u1", role: "owner" });
    const res = await app.request("/merchant/upgrade-to-brand", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupName: "My Group" }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("PlanGate");
    expect(body.message).toMatch(/multi-branch/i);
    // Confirm the handler short-circuited before opening the transaction.
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("passes the tier check when subscription_tier is 'multibranch'", async () => {
    // Tier read returns multibranch; transaction reads then return inactive
    // user so the handler exits with a different error AFTER the tier check.
    // We're only asserting the tier check no longer blocks.
    _selectQueue.push([{ id: "m1", subscriptionTier: "multibranch", groupId: null }]);
    _selectQueue.push([]); // user lookup inside tx → no row → "user_inactive"

    const app = buildApp({ merchantId: "m1", userId: "u1", role: "owner" });
    const res = await app.request("/merchant/upgrade-to-brand", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupName: "My Group" }),
    });

    expect(res.status).not.toBe(403);
    expect(mockDb.transaction).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd glowos/services/api
pnpm vitest run src/routes/merchant.test.ts
```
Expected: both tests FAIL — first because the handler doesn't return 403/PlanGate yet, second because the handler currently does its own merchant lookup and would hit the existing `merchant_in_group` path differently. We'll make both pass in the next step.

- [ ] **Step 3: Add the tier gate to the handler**

Open `glowos/services/api/src/routes/merchant.ts` and find the `POST /upgrade-to-brand` handler (around line 195, after the `if (c.get("impersonating"))` check, before the `db.transaction` call). Add this block immediately after the impersonation check:

```typescript
    // Plan gate — multi-branch must be enabled on the merchant's subscription.
    // Read the tier outside the transaction so we can short-circuit cheaply.
    const [tierRow] = await db
      .select({ tier: merchants.subscriptionTier })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .limit(1);

    if (!tierRow || tierRow.tier !== "multibranch") {
      return c.json(
        {
          error: "PlanGate",
          message: "Contact support to enable multi-branch on your plan",
        },
        403,
      );
    }
```

The mock is queued to return `[{ id, subscriptionTier, groupId }]`, so the destructuring `const [tierRow]` matches what tests provide.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm vitest run src/routes/merchant.test.ts
```
Expected: both tests PASS.

- [ ] **Step 5: Run the full API test suite to confirm no regressions**

```bash
pnpm vitest run
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add glowos/services/api/src/routes/merchant.ts glowos/services/api/src/routes/merchant.test.ts
git commit -m "feat(merchant): gate /upgrade-to-brand on subscription_tier === multibranch"
```

---

## Task 2: Backend — `PATCH /super/merchants/:id/tier` (TDD)

**Files:**
- Create: `glowos/services/api/src/routes/super.test.ts`
- Modify: `glowos/services/api/src/routes/super.ts` — append handler near other `/merchants` routes (after the `GET /super/merchants` block at line 172)

- [ ] **Step 1: Write the failing test file**

Create `glowos/services/api/src/routes/super.test.ts`:

```typescript
/**
 * Tests for /super tier-flip endpoint.
 *
 * Covers:
 *   - PATCH /super/merchants/:id/tier rejects invalid tier values (400)
 *   - PATCH /super/merchants/:id/tier writes the new tier and an audit row
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppVariables } from "../lib/types.js";

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
    return chain;
  }

  const mockDb = {
    select: vi.fn(() => {
      const result = _selectQueue.shift() ?? [];
      return makeMockChain(result);
    }),
    update: vi.fn(() => {
      const result = _updateQueue.shift() ?? [];
      return makeMockChain(result);
    }),
    insert: vi.fn((table: unknown) => {
      const chain: Record<string, unknown> = {};
      chain.values = vi.fn((values: unknown) => {
        _insertCalls.push({ table, values });
        return Promise.resolve();
      });
      return chain;
    }),
  };

  return { _selectQueue, _updateQueue, _insertCalls, mockDb };
});

vi.mock("@glowos/db", () => ({
  db: mockDb,
  superAdminAuditLog: { __name: "super_admin_audit_log" },
  merchants: { __name: "merchants" },
  merchantUsers: {},
  groups: {},
  bookings: {},
  clients: {},
  notifications: {},
  notificationLog: {},
  whatsappInboundLog: {},
  clientProfiles: {},
}));

vi.mock("../lib/auth/superAdminEmails.js", () => ({
  isSuperAdminEmail: () => true,
}));

import { superRouter } from "./super.js";

function buildSuperApp(opts: { actorUserId: string; actorEmail: string }) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", async (c, next) => {
    c.set("userId", opts.actorUserId);
    c.set("userEmail", opts.actorEmail);
    c.set("superAdmin", true);
    c.set("impersonating", false);
    c.set("merchantId", "host");
    c.set("userRole", "owner");
    await next();
  });
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

  it("returns 400 for an invalid tier value", async () => {
    const app = buildSuperApp({ actorUserId: "u1", actorEmail: "host@glowos.com" });
    const res = await app.request("/super/merchants/m1/tier", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier: "platinum" }),
    });
    expect(res.status).toBe(400);
  });

  it("updates the tier, returns the merchant, and writes an audit row", async () => {
    // 1st select: previous tier read for audit metadata.
    _selectQueue.push([{ id: "m1", subscriptionTier: "starter" }]);
    // update().returning() → updated merchant row.
    _updateQueue.push([{ id: "m1", subscriptionTier: "multibranch", name: "Test" }]);
    // 2nd select: actor email read by logAudit (it reads from DB, not JWT).
    _selectQueue.push([{ email: "host@glowos.com" }]);

    const app = buildSuperApp({ actorUserId: "u1", actorEmail: "host@glowos.com" });
    const res = await app.request("/super/merchants/m1/tier", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier: "multibranch" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscriptionTier).toBe("multibranch");

    const auditCall = _insertCalls.find(
      (c) => (c.table as { __name: string }).__name === "super_admin_audit_log",
    );
    expect(auditCall).toBeDefined();
    const audit = auditCall!.values as {
      action: string;
      targetMerchantId: string;
      metadata: { event: string; previous_tier: string; new_tier: string };
    };
    expect(audit.action).toBe("write");
    expect(audit.targetMerchantId).toBe("m1");
    expect(audit.metadata.event).toBe("set_tier");
    expect(audit.metadata.previous_tier).toBe("starter");
    expect(audit.metadata.new_tier).toBe("multibranch");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run src/routes/super.test.ts
```
Expected: both tests FAIL with 404 (route doesn't exist) for the success path, and likely 404 for the invalid case too.

- [ ] **Step 3: Add the handler to `super.ts`**

In `glowos/services/api/src/routes/super.ts`, locate the `GET /super/merchants` handler that ends around line 250-256. Immediately after that handler (and before the next `superRouter.get("/analytics/overview", ...)` block), add:

```typescript
// ─── PATCH /super/merchants/:id/tier ──────────────────────────────────────────
// Host-admin tier flip. Soft gate — does not touch existing groupId or
// brandAdminGroupId rows. Logged via the existing logAudit helper using
// action: 'write' (the action enum is closed); the discriminator lives in
// metadata.event so audit consumers can filter on it.

const setTierSchema = z.object({
  tier: z.enum(["starter", "multibranch"]),
});

superRouter.patch("/merchants/:id/tier", zValidator(setTierSchema), async (c) => {
  const merchantId = c.req.param("id");
  const body = c.get("body") as z.infer<typeof setTierSchema>;
  const actorUserId = c.get("userId");

  // Read previous tier so we can record before/after in the audit row.
  const [previous] = await db
    .select({ id: merchants.id, subscriptionTier: merchants.subscriptionTier })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  if (!previous) {
    return c.json({ error: "NotFound", message: "Merchant not found" }, 404);
  }

  const [updated] = await db
    .update(merchants)
    .set({ subscriptionTier: body.tier, updatedAt: new Date() })
    .where(eq(merchants.id, merchantId))
    .returning();

  // Resolve actor email from DB (not JWT) — keeps the audit log honest even
  // if claims drift between sessions. Mirrors the impersonate handler.
  const [actor] = await db
    .select({ email: merchantUsers.email })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, actorUserId))
    .limit(1);

  await logAudit({
    actorUserId,
    actorEmail: actor?.email ?? "unknown",
    action: "write",
    targetMerchantId: merchantId,
    method: "PATCH",
    path: `/super/merchants/${merchantId}/tier`,
    metadata: {
      event: "set_tier",
      previous_tier: previous.subscriptionTier,
      new_tier: body.tier,
    },
  });

  return c.json(updated);
});
```

Make sure `merchants` and `merchantUsers` are already imported at the top of the file (they are — line 12-15ish, inspect with `grep -n "from \"@glowos/db\"" glowos/services/api/src/routes/super.ts`). `z` and `zValidator` are also already imported.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm vitest run src/routes/super.test.ts
```
Expected: both tests PASS.

- [ ] **Step 5: Run the full API suite again**

```bash
pnpm vitest run
```
Expected: all green.

- [ ] **Step 6: TypeScript check on the API**

```bash
pnpm tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add glowos/services/api/src/routes/super.ts glowos/services/api/src/routes/super.test.ts
git commit -m "feat(super): add PATCH /super/merchants/:id/tier with audit log"
```

---

## Task 3: Frontend — extend `Merchant` interface and verify `/merchant/me` returns the tier

**Files:**
- Modify: `glowos/apps/web/app/dashboard/layout.tsx` — `Merchant` interface at lines 10-14

- [ ] **Step 1: Verify `/merchant/me` already returns `subscription_tier`**

```bash
grep -n "merchantRouter.get(\"/me\"\|merchant: merchant\b\|select.*merchants" glowos/services/api/src/routes/merchant.ts | head -20
```

The endpoint should select the full merchant row (the schema serializes `subscriptionTier` as `subscription_tier` via Drizzle defaults, but read what the actual Drizzle key is — if the route returns the merchant via `select().from(merchants)` with no column projection, the returned key will be the camelCase `subscriptionTier`). Note the actual key name — the frontend interface must match.

- [ ] **Step 2: Extend the `Merchant` interface**

In `glowos/apps/web/app/dashboard/layout.tsx`, replace lines 10-14:

```typescript
interface Merchant {
  id: string;
  name: string;
  slug: string;
  subscriptionTier: 'starter' | 'multibranch';
  groupId?: string | null;
}
```

If Step 1 revealed the API serializes as `subscription_tier` (snake_case) instead of `subscriptionTier`, use that key name throughout this plan.

- [ ] **Step 3: TypeScript check**

```bash
cd ../../apps/web
pnpm tsc --noEmit
```
Expected: exit 0. The interface widening should not break callers since the new fields are optional in usage.

- [ ] **Step 4: Commit**

```bash
git add glowos/apps/web/app/dashboard/layout.tsx
git commit -m "feat(dashboard): extend Merchant interface with subscriptionTier and groupId"
```

---

## Task 4: Frontend — gate Group nav on tier

**Files:**
- Modify: `glowos/apps/web/app/dashboard/layout.tsx` — `roleLabel` effect (lines 184-206) and `navItems` derivation (line 208)

- [ ] **Step 1: Update the role-label effect to also read merchant tier**

In `glowos/apps/web/app/dashboard/layout.tsx`, locate the `useEffect` that sets `setIsBrandAdmin` and `setRoleLabel` (around lines 184-206). Replace it with:

```typescript
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isSuper = localStorage.getItem('superAdmin') === 'true';
    const impersonating = localStorage.getItem('impersonating') === 'true';
    setShowSuperLink(isSuper && !impersonating);
    try {
      const u = JSON.parse(localStorage.getItem('user') ?? '{}');
      const m = JSON.parse(localStorage.getItem('merchant') ?? '{}');
      // isBrandAdmin = the user CAN see Group features at the role level.
      // It's a necessary but not sufficient condition — tier also has to permit it.
      const hasGroupRole = Boolean(u.brandAdminGroupId);
      const tierAllowsMultibranch = m.subscriptionTier === 'multibranch';
      setIsBrandAdmin(hasGroupRole && tierAllowsMultibranch);
      setUserName(u.name ?? u.email ?? '');
      setRoleLabel(
        hasGroupRole
          ? 'Group Admin'
          : u.role === 'staff'
            ? 'Staff'
            : u.role === 'clinician'
              ? 'Clinician'
              : u.role === 'owner' || u.role === 'manager'
                ? 'Branch Admin'
                : '',
      );
    } catch { /* ignore */ }
  }, [pathname, merchant]);
```

Two intentional changes:
- `setIsBrandAdmin(hasGroupRole && tierAllowsMultibranch)` — this is what gates the nav item (line 208's `navItems` already keys off `isBrandAdmin`).
- The label remains `Group Admin` whenever the user holds the role, even when tier is starter — so a downgraded merchant's group admin still SEES they're a group admin in the chrome (we just hide the surface). This avoids a confusing mid-session relabel. (The label is purely cosmetic; the gate is the nav item.)
- Added `merchant` to the deps so the effect re-runs when the API refresh in `/merchant/me` updates merchant state (and writes back to localStorage).

- [ ] **Step 2: TypeScript check**

```bash
pnpm tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add glowos/apps/web/app/dashboard/layout.tsx
git commit -m "feat(dashboard): gate Group nav on subscription_tier === multibranch"
```

---

## Task 5: Frontend — tier guard on `/dashboard/group/*`

**Files:**
- Modify: `glowos/apps/web/app/dashboard/group/layout.tsx`

- [ ] **Step 1: Read the existing layout to find a good guard insertion point**

```bash
sed -n '1,80p' glowos/apps/web/app/dashboard/group/layout.tsx
```

Locate the existing auth/redirect `useEffect`. The guard should sit alongside it.

- [ ] **Step 2: Add a tier-guard `useEffect`**

Add the following effect in the layout component (after the existing auth check, before any data fetching). It runs on mount + on pathname change:

```typescript
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const m = JSON.parse(localStorage.getItem('merchant') ?? '{}');
      if (m.subscriptionTier !== 'multibranch') {
        router.replace('/dashboard');
      }
    } catch {
      router.replace('/dashboard');
    }
  }, [pathname, router]);
```

If `useRouter` and `usePathname` aren't already imported in this file, add them — see how `dashboard/layout.tsx` imports them (lines 1-5) for the pattern.

- [ ] **Step 3: TypeScript check**

```bash
pnpm tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add glowos/apps/web/app/dashboard/group/layout.tsx
git commit -m "feat(group): redirect non-multibranch merchants away from /dashboard/group"
```

---

## Task 6: Frontend — Settings upsell card

**Files:**
- Modify: `glowos/apps/web/app/dashboard/settings/page.tsx`

- [ ] **Step 1: Read the settings page to find the right insertion point**

```bash
sed -n '1,80p' glowos/apps/web/app/dashboard/settings/page.tsx
```

Identify the top of the rendered content (after the page heading or first card). The upsell card should be the first card the user sees.

- [ ] **Step 2: Add merchant state + upsell card render**

If the settings page doesn't already read `merchant` from localStorage, add at the top of the component:

```typescript
  const [merchant, setMerchant] = useState<{ name: string; subscriptionTier?: 'starter' | 'multibranch' } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setMerchant(JSON.parse(localStorage.getItem('merchant') ?? '{}'));
    } catch { /* ignore */ }
  }, []);
```

Then, at the top of the returned JSX (above the existing first card), insert:

```tsx
{merchant?.subscriptionTier === 'starter' && (
  <div className="mb-6 rounded-xl border border-tone-sage/30 bg-tone-surface-warm p-5 shadow-sm">
    <h2 className="font-newsreader text-lg font-semibold text-tone-ink">
      Manage multiple locations
    </h2>
    <p className="mt-1 text-sm text-grey-70">
      You're on the Starter plan. Upgrade to Multi-Branch to open additional
      branches and roll up reporting across all of them.
    </p>
    <a
      href={`mailto:test@test.com?subject=${encodeURIComponent('GlowOS multi-branch upgrade')}&body=${encodeURIComponent(`Hi, I'd like to upgrade ${merchant.name} to the Multi-Branch plan.`)}`}
      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-tone-ink px-4 py-2 text-sm font-medium text-tone-surface-warm transition-colors hover:bg-tone-sage"
    >
      Contact us
      <span aria-hidden="true">→</span>
    </a>
  </div>
)}
```

Palette: only `tone-*`, `grey-*`, no raw hue classes — required by `glowos/apps/web/app/dashboard/CLAUDE.md`. The recipient `test@test.com` is the placeholder agreed in the design — replace before launch.

- [ ] **Step 3: TypeScript check**

```bash
pnpm tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add glowos/apps/web/app/dashboard/settings/page.tsx
git commit -m "feat(settings): add multi-branch upgrade upsell card for starter-tier merchants"
```

---

## Task 7: Frontend — Tier column in `/super/merchants`

**Files:**
- Modify: `glowos/apps/web/app/super/merchants/page.tsx`

- [ ] **Step 1: Read the existing merchants page to find the table structure**

```bash
sed -n '1,160p' glowos/apps/web/app/super/merchants/page.tsx
```

Identify (a) the row type / fetched-merchant shape, (b) the `<thead>` / `<tbody>` markup, (c) where the API base URL or `apiFetch` helper is sourced from. Note the existing pattern for action buttons in the rightmost column (e.g. "View as") — the dropdown should sit alongside or in its own column on the same row.

- [ ] **Step 2: Add `subscriptionTier` to the row type**

Where the merchant row type is declared (e.g. `interface MerchantRow { ... }`), add:

```typescript
  subscriptionTier: 'starter' | 'multibranch';
```

If the GET `/super/merchants` endpoint doesn't currently return `subscriptionTier`, also extend its select projection in `glowos/services/api/src/routes/super.ts` to include `subscriptionTier: merchants.subscriptionTier`. (Inspect the existing select first — it may already return the full row.)

- [ ] **Step 3: Add a per-row tier-flip handler**

Inside the page component, add:

```typescript
  const [pendingTierMerchantId, setPendingTierMerchantId] = useState<string | null>(null);

  async function setTier(merchantId: string, tier: 'starter' | 'multibranch') {
    setPendingTierMerchantId(merchantId);
    try {
      const updated = await apiFetch(`/super/merchants/${merchantId}/tier`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier }),
      }) as { id: string; subscriptionTier: 'starter' | 'multibranch' };
      // Optimistically update the local merchants list.
      setMerchants((prev) => prev.map((m) => m.id === updated.id ? { ...m, subscriptionTier: updated.subscriptionTier } : m));
    } catch (err) {
      console.error('tier flip failed', err);
      // No-op — the dropdown will still show the previous value because we
      // didn't mutate state on failure.
      alert('Could not update tier. Try again.');
    } finally {
      setPendingTierMerchantId(null);
    }
  }
```

Adjust `setMerchants` to whatever the local state setter is named in the existing page; if it's a different shape (e.g. `data.merchants`), adapt accordingly.

- [ ] **Step 4: Add the Tier column header + cell**

In the `<thead>` row, add a new `<th>` (between an existing column and the actions column — pick a sensible position):

```tsx
<th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-grey-70">Tier</th>
```

In each merchant `<tr>`, add the matching `<td>`:

```tsx
<td className="px-3 py-2">
  <select
    className="rounded border border-grey-20 bg-tone-surface-warm px-2 py-1 text-xs"
    value={m.subscriptionTier}
    disabled={pendingTierMerchantId === m.id}
    onChange={(e) => setTier(m.id, e.target.value as 'starter' | 'multibranch')}
  >
    <option value="starter">starter</option>
    <option value="multibranch">multibranch</option>
  </select>
</td>
```

- [ ] **Step 5: TypeScript check**

```bash
pnpm tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add glowos/apps/web/app/super/merchants/page.tsx glowos/services/api/src/routes/super.ts
git commit -m "feat(super): add Tier column with inline starter/multibranch dropdown"
```

(Include `super.ts` in the commit only if Step 2 required widening the select projection.)

---

## Task 8: Verification

**Files:**
- None (verification only)

- [ ] **Step 1: Full TypeScript pass on both packages**

```bash
cd ~/code/Bookingcrm/glowos/apps/web && pnpm tsc --noEmit && echo "WEB OK"
cd ~/code/Bookingcrm/glowos/services/api && pnpm tsc --noEmit && echo "API OK"
```
Expected: both print "OK" with exit 0.

- [ ] **Step 2: Full Vitest run**

```bash
cd ~/code/Bookingcrm/glowos/services/api && pnpm vitest run
```
Expected: all tests pass, including the two new files (`merchant.test.ts`, `super.test.ts`).

- [ ] **Step 3: Manual smoke test — starter tier**

Boot the stack:

```bash
cd ~/code/Bookingcrm/glowos
pnpm dev
```

In a browser:
1. Sign up a fresh merchant (or pick an existing starter-tier merchant).
2. Confirm `/dashboard/settings` shows the Multi-Branch upsell card.
3. Confirm `/dashboard` does NOT show a Group nav item.
4. Try navigating directly to `/dashboard/group/overview` — confirm redirect to `/dashboard`.
5. From a terminal, hit the gated endpoint:

   ```bash
   curl -i -X POST http://localhost:3001/merchant/upgrade-to-brand \
     -H "Authorization: Bearer <token from localStorage.access_token>" \
     -H "content-type: application/json" \
     -d '{"groupName":"Test"}'
   ```
   Expected: HTTP 403, body `{"error":"PlanGate","message":"Contact support to enable multi-branch on your plan"}`.

- [ ] **Step 4: Manual smoke test — tier flip via super admin**

1. Log in as a super-admin email (one in `SUPER_ADMIN_EMAILS`).
2. Visit `/super/merchants`. Confirm the Tier column renders with each merchant's current tier.
3. Flip the test merchant from `starter` → `multibranch`. Confirm the dropdown updates.
4. Visit `/super/audit-log`. Confirm a row exists with `action: write`, `path: /super/merchants/<id>/tier`, and `metadata` containing `{ event: "set_tier", previous_tier: "starter", new_tier: "multibranch" }`.

- [ ] **Step 5: Manual smoke test — multibranch happy path**

1. Log back in as the test merchant (or refresh the dashboard so localStorage `merchant` is updated by the next `/merchant/me` call).
2. Confirm `/dashboard/settings` no longer shows the upsell card.
3. Re-run the curl from Step 3 — confirm it now passes the tier check (next failure mode might be `already_brand_admin` or `merchant_in_group`, which is fine — it means we're past the gate).
4. Use the existing UI flow to complete the brand upgrade. Confirm the Group nav item appears in `/dashboard`.

- [ ] **Step 6: Manual smoke test — downgrade preserves data**

1. From `/super/merchants`, flip the test merchant back to `starter`.
2. Confirm Group nav disappears in `/dashboard` (after a refresh).
3. Confirm the `groups` row and the user's `brandAdminGroupId` are still in the DB:

   ```bash
   psql "$DATABASE_URL" -c "select id, name, group_id, subscription_tier from merchants where id = '<test merchant id>';"
   psql "$DATABASE_URL" -c "select id, email, brand_admin_group_id from merchant_users where merchant_id = '<test merchant id>';"
   ```
   Expected: `group_id` still set on the merchant, `brand_admin_group_id` still set on the user.

If any smoke step fails, fix and re-run before Task 9.

---

## Task 9: PR

**Files:**
- None (git only)

- [ ] **Step 1: Push the branch**

```bash
cd ~/code/Bookingcrm
git push -u origin feat/multibranch-tier-gating
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat: gate multi-branch features on subscription_tier" --body "$(cat <<'EOF'
## Summary
- Adds a soft-gate so the Group tab + `/merchant/upgrade-to-brand` endpoint require `merchants.subscription_tier === 'multibranch'`. Existing data is preserved on downgrade.
- New host-side endpoint `PATCH /super/merchants/:id/tier` with audit log entry (`action: write`, `metadata.event: set_tier`).
- New Tier column with inline dropdown in `/super/merchants` for host admins.
- New "Manage multiple locations" upsell card in `/dashboard/settings` for starter-tier merchants (mailto placeholder — `test@test.com`, replace before launch).

Spec: `~/Desktop/projects/bookingcrm - doc/2026-04-27-multibranch-tier-gating-design.md`

## Test plan
- [x] `pnpm vitest run` in `services/api` — all green, including 2 new test files.
- [x] `pnpm tsc --noEmit` clean in both `apps/web` and `services/api`.
- [x] Manual smoke per spec §9 — starter gate, tier flip via super admin, multibranch happy path, downgrade preserves data.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: prints the PR URL.

- [ ] **Step 3: Restore the unrelated WIP if you want to keep working on it next**

The `fix/redemption-at-checkin` diff is still in the stash from Task 0:

```bash
git stash list
```

When ready to resume that work: `git checkout fix/redemption-at-checkin && git stash pop`. (Don't do this on the multibranch branch — it'd contaminate the diff.)

---

## Self-Review Notes

- All spec sections have at least one task: §3 tier model → Task 0 step 3 (existence check), Task 4 (read on web). §4 behaviour matrix → Tasks 1, 4, 5, 6, 7. §5 host-side flip → Task 2 (API) + Task 7 (UI). §6 settings card → Task 6. §7 files-touched → covered. §8 out of scope → respected (no Stripe, no auto-downgrade, no rollback of brandAdminGroupId). §9 testing → Task 8.
- Spec said `action: 'set_tier'`; plan deviates to `action: 'write'` + `metadata.event: 'set_tier'` because the audit-log enum is closed. Documented at the top of this plan and in Task 2 step 3.
- All function signatures (`logAudit`, `setTier`, `setMerchants`) and field names (`subscriptionTier`, `groupId`, `brandAdminGroupId`) are consistent across tasks.
- Endpoint paths used: `POST /merchant/upgrade-to-brand` (existing, modified), `PATCH /super/merchants/:id/tier` (new) — same names used in tests, handler, and frontend `apiFetch`.
- No "TODO", "TBD", "similar to above" placeholders. Each task carries the concrete code or commands needed.
