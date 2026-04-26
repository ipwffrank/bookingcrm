# Brand-admin Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1 of the multi-branch architecture: a merchant `owner` can self-upgrade to brand admin, manage branches in their group (create/edit), switch operator context into any branch, and access the existing `/dashboard/group/*` analytics — all from a single login.

**Architecture:** Backend extends the existing JWT/middleware stack (no new auth model — adds `viewingMerchantId`, `brandViewing`, `homeMerchantId` claims that mirror the super-admin impersonation pattern but scoped to "branches in my group"). Frontend reuses the existing `apiFetch` + `localStorage` session pattern, adds one `BrandViewBanner` (parallel to `ImpersonationBanner`), and migrates `/dashboard/group/*` from indigo to the 3-tone palette mandated by `app/dashboard/CLAUDE.md`.

**Tech Stack:** TypeScript, Hono + drizzle + zod (API), Next.js 14 + React + Tailwind (web). pnpm workspaces.

**Spec:** [`docs/superpowers/specs/2026-04-26-brand-admin-frontend-design.md`](../specs/2026-04-26-brand-admin-frontend-design.md)

**Testing approach:** This codebase has no automated test framework today. Each task verifies via `pnpm --filter @glowos/api typecheck` / `pnpm --filter @glowos/web typecheck` plus targeted manual checks (curl for API, browser for UI). Adding a test framework is out of scope for this slot.

**Branch:** Already on `feat/brand-admin-foundation`. Each task commits incrementally; do not squash until the user requests it.

---

## Task 1 — Extend JWT payloads and AppVariables for view-as-branch claims

**Files:**
- Modify: `glowos/services/api/src/lib/jwt.ts`
- Modify: `glowos/services/api/src/lib/types.ts`

- [ ] **Step 1: Add `viewingMerchantId`, `brandViewing`, `homeMerchantId` to AccessTokenPayload and RefreshTokenPayload**

In `glowos/services/api/src/lib/jwt.ts`, find `AccessTokenPayload` (around line 18-25, where `brandAdminGroupId` was added) and add three new optional fields. Find `RefreshTokenPayload` and add the same three.

```ts
// AccessTokenPayload — add these three fields after brandAdminGroupId
viewingMerchantId?: string;
brandViewing?: boolean;
homeMerchantId?: string;
```

```ts
// RefreshTokenPayload — same three fields
viewingMerchantId?: string;
brandViewing?: boolean;
homeMerchantId?: string;
```

- [ ] **Step 2: Add the keys to AppVariables**

In `glowos/services/api/src/lib/types.ts`, find `AppVariables` (around line 18 where `brandAdminGroupId` lives) and append:

```ts
brandViewing?: boolean;
homeMerchantId?: string;
viewingMerchantId?: string;
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/api typecheck
```

Expected: clean (no errors, no output).

- [ ] **Step 4: Commit**

```bash
cd /Users/chrisrine/code/Bookingcrm
git add glowos/services/api/src/lib/jwt.ts glowos/services/api/src/lib/types.ts
git commit -m "feat(brand): add view-as-branch claim types to JWT + AppVariables"
```

---

## Task 2 — Extend `POST /auth/login` to return `group: {id, name}` for brand admins

**Files:**
- Modify: `glowos/services/api/src/routes/auth.ts:130-187` (the merchant-user branch of /auth/login)

- [ ] **Step 1: Import groups schema**

At the top of `routes/auth.ts`, ensure `groups` is imported from `@glowos/db`. If the file already imports `merchants, merchantUsers` from `@glowos/db`, extend the destructuring to include `groups`:

```ts
import { db, merchants, merchantUsers, groups, /* ... existing ... */ } from "@glowos/db";
```

- [ ] **Step 2: Fetch the group when brandAdminGroupId is set**

Inside the merchant-user branch of `/auth/login`, **after** the `passwordValid` / `isActive` checks succeed and `brandAdminGroupId` is computed (around line 153 today), fetch the group row when present:

```ts
let group: { id: string; name: string } | null = null;
if (brandAdminGroupId) {
  const [groupRow] = await db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(eq(groups.id, brandAdminGroupId))
    .limit(1);
  if (groupRow) group = groupRow;
  // Else: brand_admin_group_id points to a missing/deleted group.
  // Don't fail login — just omit `group` from the response. The frontend
  // will not render the Group sidebar item; superadmin can clean up.
}
```

- [ ] **Step 3: Add `group` to the response (merchant + staff branches)**

In the `if (user.role === 'staff') { return c.json({ ... }) }` block (around line 168) and the subsequent merchant-owner/manager `return c.json({ ... })` (around line 179), add `...(group ? { group } : {})` to the response object so the field is included only when present.

Before:
```ts
return c.json({
  userType: "merchant",
  user: safeUser,
  merchant,
  access_token: accessToken,
  refresh_token: refreshToken,
  ...(superAdmin ? { superAdmin: true } : {}),
});
```

After:
```ts
return c.json({
  userType: "merchant",
  user: safeUser,
  merchant,
  ...(group ? { group } : {}),
  access_token: accessToken,
  refresh_token: refreshToken,
  ...(superAdmin ? { superAdmin: true } : {}),
});
```

Apply the same `...(group ? { group } : {})` insertion to the staff `c.json({ ... })` block.

- [ ] **Step 4: Typecheck**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/api typecheck
```

- [ ] **Step 5: Manual smoke test (against a merchant_users row WITHOUT brand_admin_group_id)**

```bash
# Start API: pnpm dev (or use a running instance)
curl -s -X POST http://localhost:3001/auth/login -H "Content-Type: application/json" \
  -d '{"email":"<existing merchant owner email>","password":"<password>"}' | jq '. | {userType, has_group: (.group != null)}'
```

Expected: `{"userType": "merchant", "has_group": false}`. (No DB rows have `brand_admin_group_id` yet — that's normal pre-bootstrap.)

- [ ] **Step 6: Commit**

```bash
git add glowos/services/api/src/routes/auth.ts
git commit -m "feat(brand): /auth/login returns group when user is a brand admin"
```

---

## Task 3 — Update `/auth/refresh-token` to forward `viewingMerchantId` / `brandViewing` / `homeMerchantId`

**Files:**
- Modify: `glowos/services/api/src/routes/auth.ts` (the `/auth/refresh-token` handler around line 227-300)

- [ ] **Step 1: Read the existing handler**

The current `/auth/refresh-token` handler decodes the refresh JWT, re-loads the merchant_users row, and re-issues tokens preserving `brandAdminGroupId`. Extend it to also preserve the three new claims.

- [ ] **Step 2: Forward the new claims into the new token pair**

Locate the section that builds the new `accessToken` and `refreshToken` (around line 270-296 — currently spreads `...(brandAdminGroupId ? { brandAdminGroupId } : {})` into both). Read the three new claims from the verified payload BEFORE re-issue:

```ts
const viewingMerchantId = payload.viewingMerchantId;
const brandViewing = payload.brandViewing;
const homeMerchantId = payload.homeMerchantId;
```

Then add these spreads alongside the existing `brandAdminGroupId` spread in BOTH `generateAccessToken({...})` and `generateRefreshToken({...})`:

```ts
...(viewingMerchantId ? { viewingMerchantId } : {}),
...(brandViewing ? { brandViewing: true as const } : {}),
...(homeMerchantId ? { homeMerchantId } : {}),
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/api typecheck
```

- [ ] **Step 4: Commit**

```bash
git add glowos/services/api/src/routes/auth.ts
git commit -m "feat(brand): /auth/refresh-token preserves view-as-branch claims"
```

---

## Task 4 — `requireMerchant` honors `viewingMerchantId`

**Files:**
- Modify: `glowos/services/api/src/middleware/auth.ts:15-71`

- [ ] **Step 1: Import `merchants` schema**

At the top of `middleware/auth.ts`, replace `import { merchantUsers } from "@glowos/db";` with:

```ts
import { merchantUsers, merchants } from "@glowos/db";
```

- [ ] **Step 2: Insert the view-as-branch override block**

After the existing `merchant_users` lookup succeeds (around line 44, right after `if (!user || !user.isActive)` returns 401), and BEFORE the existing `c.set("merchantId", user.merchantId)` line, insert:

```ts
// view-as-branch: brand admin scoping their session to a branch in their group.
// The JWT carries the target merchantId; we re-validate group membership on every
// request so revoking brand authority or moving a branch out of the group takes
// effect immediately.
if (payload.viewingMerchantId) {
  if (!user.brandAdminGroupId) {
    return c.json(
      { error: "Forbidden", message: "Brand authority revoked" },
      403,
    );
  }
  const [target] = await db
    .select({ id: merchants.id, groupId: merchants.groupId })
    .from(merchants)
    .where(eq(merchants.id, payload.viewingMerchantId))
    .limit(1);
  if (!target || target.groupId !== user.brandAdminGroupId) {
    return c.json(
      { error: "Forbidden", message: "Branch not in your group" },
      403,
    );
  }
  c.set("userId", user.id);
  c.set("merchantId", payload.viewingMerchantId);
  c.set("userRole", "owner"); // synthetic — brand admin holds owner-equivalent within their group
  c.set("brandViewing", true);
  c.set("homeMerchantId", user.merchantId);
  c.set("viewingMerchantId", payload.viewingMerchantId);
  if (user.staffId) c.set("staffId", user.staffId);
  if (payload.brandAdminGroupId) c.set("brandAdminGroupId", payload.brandAdminGroupId);
  await next();
  return;
}
```

The remainder of the middleware (the existing `c.set("merchantId", user.merchantId)` and below) only runs in non-brand-viewing requests.

- [ ] **Step 3: Typecheck**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/api typecheck
```

- [ ] **Step 4: Commit**

```bash
git add glowos/services/api/src/middleware/auth.ts
git commit -m "feat(brand): requireMerchant honors viewingMerchantId for brand-viewing sessions"
```

---

## Task 5 — `POST /merchant/upgrade-to-brand` (bootstrap self-upgrade)

**Files:**
- Modify: `glowos/services/api/src/routes/merchant.ts`

- [ ] **Step 1: Add zod schema near the top of the file**

Locate the existing `updateMerchantSchema` block in `routes/merchant.ts` and append a new schema after it:

```ts
const upgradeToBrandSchema = z.object({
  groupName: z.string().trim().min(1).max(255),
}).strict();
```

- [ ] **Step 2: Import `merchantUsers`, `groups`, and the JWT helpers**

Find the existing imports at the top:

```ts
import { db, merchants } from "@glowos/db";
```

Replace with:

```ts
import { db, merchants, merchantUsers, groups } from "@glowos/db";
import { generateAccessToken, generateRefreshToken } from "../lib/jwt.js";
```

(Skip the second import line if those helpers are already imported.)

- [ ] **Step 3: Add the route handler**

At the end of the file (before the `export { merchantRouter };` line), add:

```ts
// ─── POST /merchant/upgrade-to-brand ───────────────────────────────────────────
// Self-upgrade: an owner-role merchant_user creates a new group with their
// existing merchant as the first branch and grants themselves brand-admin
// authority. Re-issues tokens so the upgrade takes effect without a logout.
//
// Refuses to run for managers/staff (frontend gates anyway, but the API is
// authoritative), for users who already hold brandAdminGroupId, for merchants
// already in a group, and for impersonating sessions.
merchantRouter.post(
  "/upgrade-to-brand",
  requireMerchant,
  requireRole("owner"),
  zValidator(upgradeToBrandSchema),
  async (c) => {
    const userId = c.get("userId")!;
    const merchantId = c.get("merchantId")!;
    const body = c.get("body") as z.infer<typeof upgradeToBrandSchema>;

    if (c.get("impersonating")) {
      return c.json(
        { error: "Forbidden", message: "End impersonation before upgrading" },
        403,
      );
    }

    const result = await db.transaction(async (tx) => {
      const [user] = await tx
        .select({
          id: merchantUsers.id,
          email: merchantUsers.email,
          name: merchantUsers.name,
          role: merchantUsers.role,
          staffId: merchantUsers.staffId,
          brandAdminGroupId: merchantUsers.brandAdminGroupId,
          merchantId: merchantUsers.merchantId,
          isActive: merchantUsers.isActive,
        })
        .from(merchantUsers)
        .where(eq(merchantUsers.id, userId))
        .limit(1);

      if (!user || !user.isActive) {
        return { error: "user_inactive" as const };
      }
      if (user.brandAdminGroupId) {
        return { error: "already_brand_admin" as const };
      }

      const [merchant] = await tx
        .select()
        .from(merchants)
        .where(eq(merchants.id, merchantId))
        .limit(1);

      if (!merchant) {
        return { error: "merchant_missing" as const };
      }
      if (merchant.groupId) {
        return { error: "merchant_in_group" as const };
      }

      const [newGroup] = await tx
        .insert(groups)
        .values({ name: body.groupName })
        .returning({ id: groups.id, name: groups.name });

      await tx
        .update(merchants)
        .set({ groupId: newGroup.id, updatedAt: new Date() })
        .where(eq(merchants.id, merchantId));

      await tx
        .update(merchantUsers)
        .set({ brandAdminGroupId: newGroup.id })
        .where(eq(merchantUsers.id, userId));

      return {
        ok: true as const,
        user,
        merchant: { ...merchant, groupId: newGroup.id },
        group: newGroup,
      };
    });

    if ("error" in result) {
      switch (result.error) {
        case "user_inactive":
          return c.json({ error: "Unauthorized", message: "Account inactive" }, 401);
        case "already_brand_admin":
          return c.json(
            { error: "Conflict", message: "You are already a brand admin" },
            409,
          );
        case "merchant_in_group":
          return c.json(
            {
              error: "Conflict",
              message:
                "This branch is already part of a group. Contact support to merge or transfer.",
            },
            409,
          );
        case "merchant_missing":
          return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
      }
    }

    const { user, merchant, group } = result;

    const accessToken = generateAccessToken({
      userId: user.id,
      merchantId: user.merchantId,
      role: user.role,
      ...(user.staffId ? { staffId: user.staffId } : {}),
      brandAdminGroupId: group.id,
    });
    const refreshToken = generateRefreshToken({
      userId: user.id,
      brandAdminGroupId: group.id,
    });

    const { /* never returned */ ...safeUser } = { ...user };
    return c.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      user: { ...safeUser, brandAdminGroupId: group.id },
      merchant,
      group,
    });
  },
);
```

> **Note on the safeUser stripping above:** the existing `merchant_users` query in this transaction does NOT select `passwordHash`, so `user` is already safe. The destructure is a stylistic placeholder — drop it if you prefer `user: { ...user, brandAdminGroupId: group.id }` directly. Keep behavior identical.

- [ ] **Step 4: Typecheck**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/api typecheck
```

- [ ] **Step 5: Manual API check (against a clean owner-role merchant_user)**

```bash
# 1. Login first to get a token
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login -H "Content-Type: application/json" \
  -d '{"email":"<owner email>","password":"<pw>"}' | jq -r '.access_token')

# 2. Upgrade
curl -s -X POST http://localhost:3001/merchant/upgrade-to-brand \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"groupName":"Test Brand"}' | jq '. | {user: .user.brandAdminGroupId, merchant: .merchant.groupId, group: .group}'

# 3. Repeat — should now 409
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/merchant/upgrade-to-brand \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"groupName":"Another"}'
```

Expected first call: `{user: "<uuid>", merchant: "<same uuid>", group: {id, name}}`. Second call: `409`.

- [ ] **Step 6: Manual API check that managers cannot upgrade**

Login as a `manager` role user, run the upgrade call. Expected: `403`.

- [ ] **Step 7: Commit**

```bash
git add glowos/services/api/src/routes/merchant.ts
git commit -m "feat(brand): POST /merchant/upgrade-to-brand for owner self-upgrade"
```

---

## Task 6 — `POST /group/branches` (create empty branch in caller's group)

**Files:**
- Modify: `glowos/services/api/src/routes/group.ts`

- [ ] **Step 1: Import zod and `zValidator`**

At the top of `routes/group.ts`, add:

```ts
import { z } from "zod";
import { zValidator } from "../middleware/validate.js";
```

- [ ] **Step 2: Define the create schema (place near the existing `parseDateRange` helper)**

```ts
const createBranchSchema = z.object({
  name: z.string().trim().min(1).max(255),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(100)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "slug must be lowercase letters, numbers, dashes; no leading/trailing dash"),
  country: z.enum(["SG", "MY"]),
  category: z
    .enum(["hair_salon", "nail_studio", "spa", "massage", "beauty_centre", "restaurant", "beauty_clinic", "medical_clinic", "other"])
    .optional(),
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  postalCode: z.string().max(10).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().max(255).optional(),
  description: z.string().optional(),
}).strict();
```

- [ ] **Step 3: Add the handler**

Append after the existing `groupRouter.get("/clients", ...)` handler:

```ts
// ─── POST /group/branches ──────────────────────────────────────────────────────
groupRouter.post("/branches", zValidator(createBranchSchema), async (c) => {
  const groupId = c.get("groupId")!;
  const body = c.get("body") as z.infer<typeof createBranchSchema>;

  // Slug uniqueness — explicit pre-check for a friendly 409 ahead of the unique-
  // constraint violation that would surface as a generic 500.
  const [existing] = await db
    .select({ id: merchants.id })
    .from(merchants)
    .where(eq(merchants.slug, body.slug))
    .limit(1);
  if (existing) {
    return c.json({ error: "Conflict", message: "Slug already taken" }, 409);
  }

  const timezone = body.country === "MY" ? "Asia/Kuala_Lumpur" : "Asia/Singapore";
  const paymentGateway = body.country === "MY" ? "ipay88" : "stripe";

  const [created] = await db
    .insert(merchants)
    .values({
      slug: body.slug,
      name: body.name,
      country: body.country,
      timezone,
      paymentGateway,
      groupId,
      ...(body.category ? { category: body.category } : {}),
      ...(body.addressLine1 !== undefined ? { addressLine1: body.addressLine1 } : {}),
      ...(body.addressLine2 !== undefined ? { addressLine2: body.addressLine2 } : {}),
      ...(body.postalCode !== undefined ? { postalCode: body.postalCode } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
    })
    .returning();

  return c.json({ merchant: created }, 201);
});
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/api typecheck
```

- [ ] **Step 5: Manual API check (must be a brand admin token from Task 5)**

```bash
TOKEN=<access token from upgrade-to-brand response>
curl -s -X POST http://localhost:3001/group/branches \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Aura Damansara","slug":"aura-damansara","country":"MY","category":"spa","addressLine1":"Lot 3.10"}' | jq

# Repeat with same slug → 409
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/group/branches \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"X","slug":"aura-damansara","country":"MY"}'
```

Expected: first call returns 201 with full merchant row including `groupId` matching the brand admin's group; second call returns `409`.

- [ ] **Step 6: Commit**

```bash
git add glowos/services/api/src/routes/group.ts
git commit -m "feat(brand): POST /group/branches creates empty branch in brand admin's group"
```

---

## Task 7 — `PATCH /group/branches/:merchantId` (edit branch profile)

**Files:**
- Modify: `glowos/services/api/src/routes/group.ts`

- [ ] **Step 1: Define the update schema near `createBranchSchema`**

```ts
const updateBranchSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    category: z.enum(["hair_salon", "nail_studio", "spa", "massage", "beauty_centre", "restaurant", "beauty_clinic", "medical_clinic", "other"]),
    addressLine1: z.string().max(255).nullable(),
    addressLine2: z.string().max(255).nullable(),
    postalCode: z.string().max(10).nullable(),
    phone: z.string().max(20).nullable(),
    email: z.string().email().max(255).nullable(),
    description: z.string().nullable(),
    logoUrl: z.string().url().nullable(),
    coverPhotoUrl: z.string().url().nullable(),
  })
  .partial()
  .strict();
```

`.strict()` rejects forbidden fields (slug, subscriptionTier, etc.) with a 400 — exactly what we want.

- [ ] **Step 2: Add the handler after `POST /group/branches`**

```ts
// ─── PATCH /group/branches/:merchantId ─────────────────────────────────────────
groupRouter.patch(
  "/branches/:merchantId",
  zValidator(updateBranchSchema),
  async (c) => {
    const groupId = c.get("groupId")!;
    const merchantId = c.req.param("merchantId")!;
    const body = c.get("body") as z.infer<typeof updateBranchSchema>;

    if (Object.keys(body).length === 0) {
      return c.json({ error: "Bad Request", message: "No fields provided" }, 400);
    }

    // Verify target is in caller's group
    const [target] = await db
      .select({ id: merchants.id })
      .from(merchants)
      .where(and(eq(merchants.id, merchantId), eq(merchants.groupId, groupId)))
      .limit(1);
    if (!target) {
      return c.json({ error: "Not Found", message: "Branch not in your group" }, 404);
    }

    const [updated] = await db
      .update(merchants)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(merchants.id, merchantId))
      .returning();

    return c.json({ merchant: updated });
  },
);
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/api typecheck
```

- [ ] **Step 4: Manual API checks**

```bash
# Edit a branch in your group — should succeed
curl -s -X PATCH http://localhost:3001/group/branches/<merchantId-in-your-group> \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Aura — Damansara Renamed"}' | jq

# Try with slug — should 400
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH http://localhost:3001/group/branches/<id> \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"slug":"new-slug"}'

# Try a merchant NOT in your group — should 404
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH http://localhost:3001/group/branches/<other-merchant-id> \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Hijack"}'
```

Expected: 200, 400, 404 respectively.

- [ ] **Step 5: Commit**

```bash
git add glowos/services/api/src/routes/group.ts
git commit -m "feat(brand): PATCH /group/branches/:id edits branch profile within group"
```

---

## Task 8 — Extend `GET /group/branches/:merchantId` to return full editable profile

**Files:**
- Modify: `glowos/services/api/src/routes/group.ts:163-218` (the existing GET handler)

- [ ] **Step 1: Replace the merchant select**

Find the block that currently does:

```ts
const [merchant] = await db
  .select({ id: merchants.id, name: merchants.name, addressLine1: merchants.addressLine1 })
  .from(merchants)
  .where(and(eq(merchants.id, merchantId), eq(merchants.groupId, groupId)))
  .limit(1);
```

Replace with:

```ts
const [merchant] = await db
  .select({
    id: merchants.id,
    slug: merchants.slug,
    name: merchants.name,
    country: merchants.country,
    timezone: merchants.timezone,
    category: merchants.category,
    addressLine1: merchants.addressLine1,
    addressLine2: merchants.addressLine2,
    postalCode: merchants.postalCode,
    phone: merchants.phone,
    email: merchants.email,
    description: merchants.description,
    logoUrl: merchants.logoUrl,
    coverPhotoUrl: merchants.coverPhotoUrl,
  })
  .from(merchants)
  .where(and(eq(merchants.id, merchantId), eq(merchants.groupId, groupId)))
  .limit(1);
```

- [ ] **Step 2: Update the response shape**

Find the final `return c.json({ merchant: { id: merchant.id, name: merchant.name, location: merchant.addressLine1 ?? "" }, revenue, bookingCount, activeClients, recentBookings });` and replace with:

```ts
return c.json({
  merchant,
  revenue: parseFloat(stats?.revenue ?? "0"),
  bookingCount: stats?.bookingCount ?? 0,
  activeClients: activeClients ?? 0,
  recentBookings,
});
```

(Drop the `location` synthetic field — frontend will read `addressLine1` directly.)

- [ ] **Step 3: Typecheck**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/api typecheck
```

- [ ] **Step 4: Manual API check**

```bash
curl -s http://localhost:3001/group/branches/<your-merchant-id> -H "Authorization: Bearer $TOKEN" | jq '.merchant | keys'
```

Expected: lists all 14 profile fields.

- [ ] **Step 5: Commit**

```bash
git add glowos/services/api/src/routes/group.ts
git commit -m "feat(brand): GET /group/branches/:id returns full editable profile"
```

---

## Task 9 — `POST /group/view-as-branch`

**Files:**
- Modify: `glowos/services/api/src/routes/group.ts`

- [ ] **Step 1: Import JWT helpers**

Add to existing imports at the top of `routes/group.ts`:

```ts
import { generateAccessToken, generateRefreshToken } from "../lib/jwt.js";
import { merchantUsers } from "@glowos/db";
```

(Combine with existing `@glowos/db` import.)

- [ ] **Step 2: Define schema**

Near the other schemas:

```ts
const viewAsBranchSchema = z.object({
  merchantId: z.string().uuid(),
}).strict();
```

- [ ] **Step 3: Add the handler**

```ts
// ─── POST /group/view-as-branch ────────────────────────────────────────────────
// Brand-admin counterpart of /super/impersonate, scoped to "any branch in my
// group" instead of "any merchant on the platform". Re-issues tokens carrying
// the new viewing claims.
groupRouter.post("/view-as-branch", zValidator(viewAsBranchSchema), async (c) => {
  const userId = c.get("userId")!;
  const groupId = c.get("groupId")!;
  const body = c.get("body") as z.infer<typeof viewAsBranchSchema>;

  // Brand-viewing requires a merchant_users JWT path (the legacy group_users
  // path doesn't have brand-admin context to switch INTO a branch). Reject if
  // requireGroupAccess took the legacy route.
  if (!c.get("brandAdminGroupId")) {
    return c.json(
      { error: "Forbidden", message: "Only brand admins on a merchant_users login can view-as-branch" },
      403,
    );
  }
  if (c.get("impersonating")) {
    return c.json(
      { error: "Forbidden", message: "End impersonation before viewing a branch" },
      403,
    );
  }

  const [target] = await db
    .select({ id: merchants.id, name: merchants.name, slug: merchants.slug })
    .from(merchants)
    .where(and(eq(merchants.id, body.merchantId), eq(merchants.groupId, groupId)))
    .limit(1);
  if (!target) {
    return c.json({ error: "Not Found", message: "Branch not in your group" }, 404);
  }

  const [user] = await db
    .select({
      id: merchantUsers.id,
      role: merchantUsers.role,
      staffId: merchantUsers.staffId,
      merchantId: merchantUsers.merchantId,
      brandAdminGroupId: merchantUsers.brandAdminGroupId,
    })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, userId))
    .limit(1);
  if (!user || !user.brandAdminGroupId || user.brandAdminGroupId !== groupId) {
    return c.json({ error: "Forbidden", message: "Brand authority revoked" }, 403);
  }

  const accessToken = generateAccessToken({
    userId: user.id,
    merchantId: user.merchantId, // home (informational; viewingMerchantId overrides downstream)
    role: user.role,
    ...(user.staffId ? { staffId: user.staffId } : {}),
    brandAdminGroupId: user.brandAdminGroupId,
    viewingMerchantId: target.id,
    brandViewing: true,
    homeMerchantId: user.merchantId,
  });
  const refreshToken = generateRefreshToken({
    userId: user.id,
    brandAdminGroupId: user.brandAdminGroupId,
    viewingMerchantId: target.id,
    brandViewing: true,
    homeMerchantId: user.merchantId,
  });

  // Return the target merchant (full row) for the frontend to write into
  // localStorage.merchant.
  const [targetFull] = await db
    .select()
    .from(merchants)
    .where(eq(merchants.id, target.id))
    .limit(1);

  return c.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    merchant: targetFull,
    brandViewing: true,
    homeMerchantId: user.merchantId,
  });
});
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/api typecheck
```

- [ ] **Step 5: Manual API check**

```bash
# Brand admin token from Task 5
curl -s -X POST http://localhost:3001/group/view-as-branch \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"merchantId":"<another-branch-in-your-group>"}' | jq '.merchant.id, .brandViewing'

# Wrong group → 404
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/group/view-as-branch \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"merchantId":"<merchant-in-different-group>"}'
```

Expected: 200 + correct merchant id; 404 for cross-group attempt.

- [ ] **Step 6: Commit**

```bash
git add glowos/services/api/src/routes/group.ts
git commit -m "feat(brand): POST /group/view-as-branch issues view-as-branch tokens"
```

---

## Task 10 — `POST /auth/end-brand-view`

**Files:**
- Modify: `glowos/services/api/src/routes/auth.ts`

- [ ] **Step 1: Add the handler near `/auth/end-impersonation`**

After the `/auth/end-impersonation` handler (around line 442 currently), add:

```ts
// ─── POST /auth/end-brand-view ─────────────────────────────────────────────────
// Counterpart of /auth/end-impersonation for brand-viewing sessions. Lives on
// /auth so it remains callable while view-as-branch claims are active (the
// /group prefix middleware already permits brand-viewing, but symmetry with
// end-impersonation matters more).
auth.post("/end-brand-view", requireMerchant, async (c) => {
  if (!c.get("brandViewing")) {
    return c.json({ error: "Conflict", message: "Not currently brand-viewing" }, 409);
  }

  const userId = c.get("userId")!;

  const [user] = await db
    .select({
      id: merchantUsers.id,
      email: merchantUsers.email,
      isActive: merchantUsers.isActive,
      merchantId: merchantUsers.merchantId,
      role: merchantUsers.role,
      staffId: merchantUsers.staffId,
      brandAdminGroupId: merchantUsers.brandAdminGroupId,
    })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, userId))
    .limit(1);

  if (!user || !user.isActive) {
    return c.json({ error: "Forbidden", message: "Account inactive" }, 403);
  }

  const superAdmin = isSuperAdminEmail(user.email);
  const accessToken = generateAccessToken({
    userId: user.id,
    merchantId: user.merchantId,
    role: user.role,
    ...(user.staffId ? { staffId: user.staffId } : {}),
    ...(superAdmin ? { superAdmin: true } : {}),
    ...(user.brandAdminGroupId ? { brandAdminGroupId: user.brandAdminGroupId } : {}),
  });
  const refreshToken = generateRefreshToken({
    userId: user.id,
    ...(user.brandAdminGroupId ? { brandAdminGroupId: user.brandAdminGroupId } : {}),
  });

  // Return the home merchant row so the frontend can write it back into
  // localStorage.merchant.
  const [homeMerchant] = await db
    .select()
    .from(merchants)
    .where(eq(merchants.id, user.merchantId))
    .limit(1);

  return c.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    merchant: homeMerchant,
  });
});
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/api typecheck
```

- [ ] **Step 3: Manual API check**

```bash
# After view-as-branch (Task 9), use the resulting token:
VIEW_TOKEN=<access_token from view-as-branch>
curl -s -X POST http://localhost:3001/auth/end-brand-view -H "Authorization: Bearer $VIEW_TOKEN" | jq '.merchant.id'

# Without view claim → 409
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/auth/end-brand-view \
  -H "Authorization: Bearer $TOKEN"  # original brand-admin token, not view-as
```

Expected: home merchant id; 409.

- [ ] **Step 4: Commit**

```bash
git add glowos/services/api/src/routes/auth.ts
git commit -m "feat(brand): POST /auth/end-brand-view restores home-branch tokens"
```

---

## Task 11 — `/super/impersonate` rejects brand-viewing sessions

**Files:**
- Modify: `glowos/services/api/src/routes/super.ts`

- [ ] **Step 1: Add the brand-viewing guard**

In the `superRouter.post("/impersonate", ...)` handler, after the existing actor-eligibility check and before the merchant lookup (around line 79-82), add:

```ts
if (c.get("brandViewing")) {
  return c.json(
    { error: "Forbidden", message: "End brand-view before impersonating" },
    403,
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/api typecheck
```

- [ ] **Step 3: Commit**

```bash
git add glowos/services/api/src/routes/super.ts
git commit -m "feat(brand): /super/impersonate rejects brand-viewing sessions"
```

---

## Task 12 — Login page writes `group` to localStorage when present

**Files:**
- Modify: `glowos/apps/web/app/login/page.tsx:35-53`

- [ ] **Step 1: Update the merchant branch**

Find the `userType: 'merchant'` branch of the response handler (around line 39-46 today). It currently writes access_token, refresh_token, user, merchant, and conditionally superAdmin. Add a parallel block that writes/clears `group`:

```ts
} else if (data.userType === 'merchant') {
  localStorage.setItem('access_token', data.access_token);
  localStorage.setItem('refresh_token', data.refresh_token);
  localStorage.setItem('user', JSON.stringify(data.user));
  localStorage.setItem('merchant', JSON.stringify(data.merchant));
  if (data.superAdmin) localStorage.setItem('superAdmin', 'true');
  else localStorage.removeItem('superAdmin');
  if (data.group) localStorage.setItem('group', JSON.stringify(data.group));
  else localStorage.removeItem('group');
  // ... existing redirect logic ...
}
```

Do NOT touch the staff branch — staff don't get group context.

- [ ] **Step 2: Typecheck**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/web typecheck
```

- [ ] **Step 3: Commit**

```bash
git add glowos/apps/web/app/login/page.tsx
git commit -m "feat(brand): login persists group to localStorage for brand admins"
```

---

## Task 13 — `BrandViewBanner` component + mount in dashboard and staff layouts

**Files:**
- Create: `glowos/apps/web/app/dashboard/components/BrandViewBanner.tsx`
- Modify: `glowos/apps/web/app/dashboard/layout.tsx`
- Modify: `glowos/apps/web/app/staff/layout.tsx`

- [ ] **Step 1: Create the component**

Write `glowos/apps/web/app/dashboard/components/BrandViewBanner.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../lib/api';

interface ViewingMerchant {
  id: string;
  name: string;
}

/**
 * Visible when the current session is a brand admin viewing a branch other
 * than their home branch. Reads the local flag set by the BranchPicker.
 * Sage tint — informational, not warn.
 */
export function BrandViewBanner() {
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [merchant, setMerchant] = useState<ViewingMerchant | null>(null);
  const [homeName, setHomeName] = useState<string>('');
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const flag = localStorage.getItem('brandViewing') === 'true';
    if (!flag) return;
    setActive(true);
    try {
      const m = JSON.parse(localStorage.getItem('merchant') ?? 'null');
      if (m) setMerchant({ id: m.id, name: m.name });
    } catch { /* ignore */ }
    setHomeName(localStorage.getItem('homeMerchantName') ?? 'your home branch');
  }, []);

  async function handleExit() {
    setExiting(true);
    try {
      const data = await apiFetch('/auth/end-brand-view', { method: 'POST' });
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      localStorage.setItem('merchant', JSON.stringify(data.merchant));
      localStorage.removeItem('brandViewing');
      localStorage.removeItem('homeMerchantId');
      localStorage.removeItem('homeMerchantName');
      router.push('/dashboard');
      router.refresh();
    } catch {
      setExiting(false);
    }
  }

  if (!active || !merchant) return null;

  return (
    <div className="bg-tone-sage/10 border-b border-tone-sage/30 px-4 py-2 text-sm flex items-center justify-between">
      <span className="text-tone-ink">
        Viewing <strong>{merchant.name}</strong> as a brand admin.
      </span>
      <button
        onClick={handleExit}
        disabled={exiting}
        className="text-tone-sage hover:text-tone-ink underline underline-offset-2 disabled:opacity-50"
      >
        {exiting ? 'Exiting…' : `End view → ${homeName}`}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Mount in `/dashboard/layout.tsx`**

Find the existing `<ImpersonationBanner />` mount (around line 375) and add `<BrandViewBanner />` right after it. Add the import near the top:

```ts
import { BrandViewBanner } from './components/BrandViewBanner';
```

```tsx
<ImpersonationBanner />
<BrandViewBanner />
```

- [ ] **Step 3: Mount in `/staff/layout.tsx`**

Same pattern — find `<ImpersonationBanner />` (around line 131), add `<BrandViewBanner />` immediately after, plus the import:

```ts
import { BrandViewBanner } from '../dashboard/components/BrandViewBanner';
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/web typecheck
```

- [ ] **Step 5: Commit**

```bash
git add glowos/apps/web/app/dashboard/components/BrandViewBanner.tsx \
        glowos/apps/web/app/dashboard/layout.tsx \
        glowos/apps/web/app/staff/layout.tsx
git commit -m "feat(brand): BrandViewBanner shown during view-as-branch sessions"
```

---

## Task 14 — Add "Group" sidebar item to merchant dashboard

**Files:**
- Modify: `glowos/apps/web/app/dashboard/layout.tsx`

- [ ] **Step 1: Add a `BuildingIcon` (it's not in dashboard/layout.tsx yet)**

After the existing icon component definitions (around the other `function XIcon(...)` blocks), add:

```tsx
function BuildingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
    </svg>
  );
}
```

- [ ] **Step 2: Compute `isBrandAdmin` alongside the existing localStorage reads**

Find the block that reads `localStorage.getItem('superAdmin')` (around line 156-157). Add:

```ts
const userJson = localStorage.getItem('user');
const isBrandAdmin = (() => {
  try { return Boolean(JSON.parse(userJson ?? '{}').brandAdminGroupId); }
  catch { return false; }
})();
const [brandAdmin, setBrandAdmin] = useState(false);
```

(Place `useState(false)` near the other `useState` hooks at the top of the component; the immediate compute can populate it inside the effect.)

Actually, do this cleanly — use a single `useState`:

```ts
const [isBrandAdmin, setIsBrandAdmin] = useState(false);
```

And inside the existing mount effect (where `localStorage.getItem('superAdmin')` is read), append:

```ts
try {
  const u = JSON.parse(localStorage.getItem('user') ?? '{}');
  setIsBrandAdmin(Boolean(u.brandAdminGroupId));
} catch { /* ignore */ }
```

- [ ] **Step 3: Build the nav list dynamically**

Replace the static `NAV_ITEMS` const with a function that returns the array conditional on flags. Find the existing const (around line 15-26):

```ts
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: CalendarIcon },
  // ...
];
```

Replace with the static base array plus an inline insertion in the component:

```ts
const BASE_NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: CalendarIcon },
  { href: '/dashboard/analytics', label: 'Analytics', icon: ChartBarIcon },
  { href: '/dashboard/services', label: 'Services', icon: ScissorsIcon },
  { href: '/dashboard/packages', label: 'Packages', icon: PackageIcon },
  { href: '/dashboard/staff', label: 'Staff', icon: UsersIcon },
  { href: '/dashboard/calendar', label: 'Calendar', icon: CalendarGridIcon },
  { href: '/dashboard/clients', label: 'Clients', icon: HeartIcon },
  { href: '/dashboard/reviews', label: 'Reviews', icon: StarIcon },
  { href: '/dashboard/import', label: 'Import Clients', icon: ImportIcon },
  { href: '/dashboard/campaigns', label: 'Campaigns', icon: MegaphoneIcon },
];
```

Inside the component, build the rendered list:

```ts
const navItems = isBrandAdmin
  ? [...BASE_NAV_ITEMS, { href: '/dashboard/group/overview', label: 'Group', icon: BuildingIcon }]
  : BASE_NAV_ITEMS;
```

Then update the `.map(...)` over `NAV_ITEMS` to iterate `navItems` instead.

- [ ] **Step 4: Typecheck + manual smoke**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/web typecheck
```

Then `pnpm dev`, log in as a brand admin (created via Task 5 + login), confirm the "Group" item appears in the sidebar. Log in as a regular merchant — confirm it does NOT appear.

- [ ] **Step 5: Commit**

```bash
git add glowos/apps/web/app/dashboard/layout.tsx
git commit -m "feat(brand): Group sidebar item visible to brand admins"
```

---

## Task 15 — "Convert to brand admin" card on `/dashboard/settings`

**Files:**
- Modify: `glowos/apps/web/app/dashboard/settings/page.tsx`
- Create (optional, only if the file gets unwieldy): `glowos/apps/web/app/dashboard/settings/components/UpgradeToBrandCard.tsx`

- [ ] **Step 1: Create the component**

Write `glowos/apps/web/app/dashboard/settings/components/UpgradeToBrandCard.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../lib/api';

export function UpgradeToBrandCard() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const u = JSON.parse(localStorage.getItem('user') ?? '{}');
      const m = JSON.parse(localStorage.getItem('merchant') ?? '{}');
      const isOwner = u.role === 'owner';
      const noGroupOnUser = !u.brandAdminGroupId;
      const noGroupOnMerchant = !m.groupId;
      const notBrandViewing = localStorage.getItem('brandViewing') !== 'true';
      const notImpersonating = localStorage.getItem('impersonating') !== 'true';
      setShow(isOwner && noGroupOnUser && noGroupOnMerchant && notBrandViewing && notImpersonating);
    } catch { /* hide on parse error — safer default */ }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!groupName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await apiFetch('/merchant/upgrade-to-brand', {
        method: 'POST',
        body: JSON.stringify({ groupName: groupName.trim() }),
      });
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('merchant', JSON.stringify(data.merchant));
      localStorage.setItem('group', JSON.stringify(data.group));
      router.push('/dashboard/group/overview');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message ?? 'Upgrade failed');
      else setError('Upgrade failed');
      setSubmitting(false);
    }
  }

  if (!show) return null;

  return (
    <section className="bg-tone-surface border border-grey-20 rounded-lg p-6 mb-6">
      <h2 className="text-lg font-semibold text-tone-ink mb-1">
        Manage multiple branches as one brand
      </h2>
      <p className="text-sm text-grey-70 mb-4">
        If you operate more than one location under a single brand, upgrade your
        account to brand admin. You'll be able to add new branches, edit profiles
        across the brand, and switch between branches without separate logins.
        Your current branch becomes the first in your new brand.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
        <label className="flex-1">
          <span className="block text-xs uppercase tracking-wide text-grey-60 mb-1">Brand name</span>
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            required
            maxLength={255}
            placeholder="e.g. Aura Wellness Group"
            className="w-full border border-grey-20 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tone-sage focus:border-tone-sage"
          />
        </label>
        <button
          type="submit"
          disabled={submitting || !groupName.trim()}
          className="bg-tone-ink text-tone-surface px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Converting…' : 'Convert to brand admin'}
        </button>
      </form>
      {error && <p className="text-sm text-semantic-danger mt-3">{error}</p>}
    </section>
  );
}
```

- [ ] **Step 2: Mount on the settings page**

Open `glowos/apps/web/app/dashboard/settings/page.tsx`. Add at the top:

```ts
import { UpgradeToBrandCard } from './components/UpgradeToBrandCard';
```

Then mount `<UpgradeToBrandCard />` at the top of the page's main content (above the existing settings sections). Place it inside the same content wrapper used by the existing sections.

- [ ] **Step 3: Typecheck + manual smoke**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/web typecheck
```

`pnpm dev`, log in as a `manager` user → card hidden. Log in as an `owner` user with no group → card visible. Submit the form → token swap, land on /dashboard/group/overview, sidebar now shows "Group".

- [ ] **Step 4: Commit**

```bash
git add glowos/apps/web/app/dashboard/settings
git commit -m "feat(brand): convert-to-brand card on /dashboard/settings"
```

---

## Task 16 — Palette + Back-link migration of `/dashboard/group/layout.tsx`

**Files:**
- Modify: `glowos/apps/web/app/dashboard/group/layout.tsx`

- [ ] **Step 1: Replace the indigo classes**

Apply these substitutions throughout the file:

| Find | Replace |
|---|---|
| `text-indigo-600` (logo, mobile header logo) | `text-tone-ink` |
| `bg-indigo-50` (active link bg) | `bg-tone-sage/10` |
| `text-indigo-700` (active link text) | `text-tone-sage` |
| `text-indigo-600` (active icon — only the icon span) | `text-tone-sage` |
| `bg-gray-50` (page canvas) | `bg-tone-surface-warm` |
| `bg-gray-100` (mobile header hover) | `bg-grey-10` |
| `border-gray-100` (sidebar dividers) | `border-grey-10` |
| `border-gray-200` (mobile header border, aside border) | `border-grey-20` |
| `text-gray-400` (icon default, X icon, logout icon) | `text-grey-40` |
| `text-gray-500` (mobile logout link, mobile menu icon, group sub-label) | `text-grey-60` |
| `text-gray-600` (inactive link text) | `text-grey-70` |
| `text-gray-700` (mobile logout hover, hover text) | `text-tone-ink` |
| `text-gray-900` (link hover text) | `text-tone-ink` |
| `bg-black/30` (mobile drawer overlay) | `bg-tone-ink/30` |

Most occurrences are in the `Sidebar` JSX block. Read the whole file once, run a pass with your editor's find/replace, then re-read to spot any class string that mixed multiple of these.

- [ ] **Step 2: Replace the static back-link with a temporary placeholder**

Inside `Sidebar`, above the `{GROUP_NAV.map(...)}` block, the layout currently has the GlowOS logo and the small `group.name — Group Admin` line. Insert a back link placeholder above the nav list (the actual picker comes in Task 17/18):

```tsx
{merchantName && (
  <Link
    href="/dashboard"
    className="flex items-center gap-2 px-3 py-2 mb-1 text-xs font-medium text-grey-60 hover:text-tone-ink"
  >
    <ArrowLeftIcon className="w-4 h-4" />
    Back to {merchantName}
  </Link>
)}
```

Add an `ArrowLeftIcon` definition alongside the others:

```tsx
function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
    </svg>
  );
}
```

Compute `merchantName` from localStorage in the existing mount effect:

```ts
const [merchantName, setMerchantName] = useState<string>('');
// ...
const cachedMerchant = localStorage.getItem('merchant');
if (cachedMerchant) {
  try { setMerchantName((JSON.parse(cachedMerchant) as { name?: string }).name ?? ''); } catch { /* ignore */ }
}
```

If localStorage has no merchant (legacy group_users login), the link doesn't render — that's fine; legacy sessions land back via the logo + Logout.

- [ ] **Step 3: Typecheck + visual smoke**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/web typecheck
```

Browser-load `/dashboard/group/overview` as a brand admin → no indigo, sidebar reads warm + ink + sage, "Back to {Branch Name}" appears.

- [ ] **Step 4: Commit**

```bash
git add glowos/apps/web/app/dashboard/group/layout.tsx
git commit -m "refactor(brand): /group layout migrated to 3-tone palette + back link"
```

---

## Task 17 — Create `BranchPicker` component

**Files:**
- Create: `glowos/apps/web/app/dashboard/group/components/BranchPicker.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api';

interface Branch {
  merchantId: string;
  name: string;
}

/**
 * Top-of-sidebar picker. Default state: "← {currentBranchName} ▾".
 * Clicking expands a list of every branch in the group; selecting one
 * either:
 *   - takes the user to /dashboard/{currentBranch} (if same as current)
 *   - calls POST /group/view-as-branch to swap into another branch and
 *     redirects to /dashboard
 */
export function BranchPicker() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [currentName, setCurrentName] = useState<string>('');
  const [currentId, setCurrentId] = useState<string>('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const m = JSON.parse(localStorage.getItem('merchant') ?? 'null');
      if (m) {
        setCurrentName(m.name ?? '');
        setCurrentId(m.id ?? '');
      }
    } catch { /* ignore */ }
  }, []);

  async function ensureLoaded() {
    if (loaded) return;
    try {
      const data = await apiFetch('/group/branches');
      setBranches(
        (data.branches as Array<{ merchantId: string; name: string }>).map((b) => ({
          merchantId: b.merchantId,
          name: b.name,
        })),
      );
      setLoaded(true);
    } catch { /* swallow — picker stays empty */ }
  }

  async function pick(target: Branch) {
    setOpen(false);
    if (target.merchantId === currentId) {
      router.push('/dashboard');
      return;
    }
    setBusy(true);
    try {
      const data = await apiFetch('/group/view-as-branch', {
        method: 'POST',
        body: JSON.stringify({ merchantId: target.merchantId }),
      });
      // Persist the home branch name on first switch, so the banner can
      // render "End view → Home Branch" without an extra fetch.
      if (!localStorage.getItem('homeMerchantName')) {
        localStorage.setItem('homeMerchantName', currentName);
      }
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      localStorage.setItem('merchant', JSON.stringify(data.merchant));
      localStorage.setItem('brandViewing', 'true');
      localStorage.setItem('homeMerchantId', data.homeMerchantId);
      router.push('/dashboard');
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  if (!currentName) {
    // Legacy group_users session: no merchant context, no picker.
    return null;
  }

  return (
    <div className="relative px-3 py-2 mb-1">
      <button
        onClick={() => { ensureLoaded(); setOpen((v) => !v); }}
        disabled={busy}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-xs font-medium text-grey-60 hover:text-tone-ink rounded-md hover:bg-grey-10"
      >
        <span className="flex items-center gap-2 truncate">
          <ArrowLeftIcon className="w-4 h-4 flex-shrink-0" />
          <span className="truncate">{busy ? 'Switching…' : `Back to ${currentName}`}</span>
        </span>
        <ChevronDownIcon className="w-4 h-4 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute left-3 right-3 top-full mt-1 bg-tone-surface border border-grey-20 rounded-md shadow-lg z-50 max-h-72 overflow-y-auto">
          {branches.length === 0 && (
            <p className="px-3 py-2 text-xs text-grey-50">No other branches in this brand.</p>
          )}
          {branches.map((b) => (
            <button
              key={b.merchantId}
              onClick={() => pick(b)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-grey-10 ${
                b.merchantId === currentId ? 'text-tone-sage font-medium' : 'text-tone-ink'
              }`}
            >
              {b.name}
              {b.merchantId === currentId && <span className="text-xs text-grey-50 ml-2">(current)</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/web typecheck
```

- [ ] **Step 3: Commit**

```bash
git add glowos/apps/web/app/dashboard/group/components/BranchPicker.tsx
git commit -m "feat(brand): BranchPicker component for view-as-branch flow"
```

---

## Task 18 — Wire `BranchPicker` into the group layout

**Files:**
- Modify: `glowos/apps/web/app/dashboard/group/layout.tsx`

- [ ] **Step 1: Replace the back-link placeholder from Task 16 with the picker**

Add the import:

```ts
import { BranchPicker } from './components/BranchPicker';
```

Remove the `{merchantName && <Link href="/dashboard">…</Link>}` block added in Task 16, plus the `ArrowLeftIcon` definition. Replace with `<BranchPicker />` in the same position (above the nav list).

- [ ] **Step 2: Typecheck + visual smoke**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/web typecheck
```

Browser: load `/dashboard/group/overview` as brand admin → picker shows "Back to {Branch} ▾"; click expands list of branches; selecting current branch routes to `/dashboard`; selecting a different branch swaps tokens and lands on `/dashboard` with the brand-view banner mounted.

- [ ] **Step 3: Commit**

```bash
git add glowos/apps/web/app/dashboard/group/layout.tsx
git commit -m "feat(brand): mount BranchPicker in /group layout"
```

---

## Task 19 — Palette migration of `/dashboard/group/overview/page.tsx`

**Files:**
- Modify: `glowos/apps/web/app/dashboard/group/overview/page.tsx`

- [ ] **Step 1: Apply the substitutions from the Task 16 table**

Plus these page-specific substitutions for stat cards / charts:

| Find | Replace |
|---|---|
| `bg-indigo-100`, `bg-indigo-50` (card backgrounds, key metric tiles) | `bg-tone-sage/10` for the sage-tinted secondary cards; `bg-tone-ink` (with `text-tone-surface` for content) for the hero metric |
| `text-indigo-600`, `text-indigo-700` (numbers / labels in stat cards) | `text-tone-sage` (sage cards) or `text-tone-surface` (hero ink card) |
| Hero metric tile (typically Revenue) | Convert to ink-filled card: `bg-tone-ink text-tone-surface rounded-xl p-6` |
| `bg-white` (cards) | `bg-tone-surface` |
| Other gray-* | mirror Task 16's table |

If the file has chart colors (e.g. recharts series), prefer `tone-ink` for the headline series and `tone-sage` for the secondary; switch additional series to the `grey-*` ramp (`grey-30`, `grey-50`, etc.) rather than colored hues.

- [ ] **Step 2: Typecheck + visual smoke**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/web typecheck
```

Browser: `/dashboard/group/overview` — hero (Revenue) is ink-filled, secondary (Bookings) is sage-tinted, rest are neutral on warm canvas.

- [ ] **Step 3: Commit**

```bash
git add glowos/apps/web/app/dashboard/group/overview/page.tsx
git commit -m "refactor(brand): /group overview migrated to 3-tone palette"
```

---

## Task 20 — Palette migration of `/dashboard/group/clients/page.tsx`

**Files:**
- Modify: `glowos/apps/web/app/dashboard/group/clients/page.tsx`

- [ ] **Step 1: Apply substitutions**

Use the Task 16 table for layout chrome. For data table rows:

| Find | Replace |
|---|---|
| `bg-white` (table rows) | `bg-tone-surface` |
| `divide-gray-200` | `divide-grey-20` |
| `bg-gray-50` (table header) | `bg-tone-surface-warm` |
| Pill colors (if any: green/blue/etc. for status) | Convert pills to typographic state utilities — `.state-default` / `.state-completed` / `.state-active` per `globals.css` (see `app/dashboard/CLAUDE.md`). Drop the wrapping pill, keep only the text-coloring class on the text node. |

- [ ] **Step 2: Typecheck**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/web typecheck
```

- [ ] **Step 3: Commit**

```bash
git add glowos/apps/web/app/dashboard/group/clients/page.tsx
git commit -m "refactor(brand): /group clients migrated to 3-tone palette"
```

---

## Task 21 — Create `BranchForm` component (shared by create + edit modals)

**Files:**
- Create: `glowos/apps/web/app/dashboard/group/branches/components/BranchForm.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../../lib/api';

const CATEGORIES = ["hair_salon", "nail_studio", "spa", "massage", "beauty_centre", "restaurant", "beauty_clinic", "medical_clinic", "other"] as const;
type Category = typeof CATEGORIES[number];

export interface BranchFormProps {
  mode: 'create' | 'edit';
  /** When edit, the merchantId of the branch to update. */
  merchantId?: string;
  onClose: () => void;
  onSaved: () => void;
}

interface State {
  name: string;
  slug: string;
  country: 'SG' | 'MY';
  category: Category | '';
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  phone: string;
  email: string;
  description: string;
}

const EMPTY: State = {
  name: '', slug: '', country: 'MY', category: '',
  addressLine1: '', addressLine2: '', postalCode: '',
  phone: '', email: '', description: '',
};

export function BranchForm({ mode, merchantId, onClose, onSaved }: BranchFormProps) {
  const [state, setState] = useState<State>(EMPTY);
  const [loading, setLoading] = useState(mode === 'edit');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'edit' || !merchantId) return;
    setLoading(true);
    apiFetch(`/group/branches/${merchantId}`)
      .then((data) => {
        const m = data.merchant;
        setState({
          name: m.name ?? '',
          slug: m.slug ?? '',
          country: (m.country ?? 'MY') as 'SG' | 'MY',
          category: (m.category ?? '') as Category | '',
          addressLine1: m.addressLine1 ?? '',
          addressLine2: m.addressLine2 ?? '',
          postalCode: m.postalCode ?? '',
          phone: m.phone ?? '',
          email: m.email ?? '',
          description: m.description ?? '',
        });
      })
      .catch(() => setError('Failed to load branch'))
      .finally(() => setLoading(false));
  }, [mode, merchantId]);

  function set<K extends keyof State>(k: K, v: State[K]) {
    setState((s) => ({ ...s, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'create') {
        const body: Record<string, unknown> = {
          name: state.name.trim(),
          slug: state.slug.trim(),
          country: state.country,
        };
        if (state.category) body.category = state.category;
        for (const k of ['addressLine1','addressLine2','postalCode','phone','email','description'] as const) {
          if (state[k]) body[k] = state[k];
        }
        await apiFetch('/group/branches', { method: 'POST', body: JSON.stringify(body) });
      } else {
        const body: Record<string, unknown> = {};
        for (const k of ['name','category','addressLine1','addressLine2','postalCode','phone','email','description'] as const) {
          // PATCH allows null to clear an optional field; empty string also clears
          body[k] = state[k] === '' ? null : state[k];
        }
        await apiFetch(`/group/branches/${merchantId}`, { method: 'PATCH', body: JSON.stringify(body) });
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message ?? 'Save failed');
      else setError('Save failed');
      setSubmitting(false);
    }
  }

  const tz = state.country === 'MY' ? 'Asia/Kuala_Lumpur' : 'Asia/Singapore';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-tone-ink/30 px-4" role="dialog">
      <div className="bg-tone-surface rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 border border-grey-20">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-tone-ink">
            {mode === 'create' ? 'New branch' : 'Edit branch'}
          </h2>
          <button onClick={onClose} className="text-grey-50 hover:text-tone-ink">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-grey-60 py-12 text-center">Loading…</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Branch name" required>
              <input
                type="text" required maxLength={255}
                value={state.name}
                onChange={(e) => set('name', e.target.value)}
                className={inputCls}
              />
            </Field>

            <Field label="URL slug" required={mode === 'create'} hint={mode === 'create' ? 'Public booking URL: /booking/<slug>' : 'Slug cannot be changed after create'}>
              <input
                type="text"
                required={mode === 'create'}
                disabled={mode === 'edit'}
                pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
                minLength={3} maxLength={100}
                value={state.slug}
                onChange={(e) => set('slug', e.target.value.toLowerCase())}
                className={`${inputCls} ${mode === 'edit' ? 'bg-grey-10 text-grey-50' : ''}`}
              />
            </Field>

            <Field label="Country" required={mode === 'create'} hint={`This branch will operate on ${tz} time`}>
              <select
                required={mode === 'create'}
                disabled={mode === 'edit'}
                value={state.country}
                onChange={(e) => set('country', e.target.value as 'SG' | 'MY')}
                className={`${inputCls} ${mode === 'edit' ? 'bg-grey-10 text-grey-50' : ''}`}
              >
                <option value="MY">Malaysia</option>
                <option value="SG">Singapore</option>
              </select>
            </Field>

            <Field label="Category">
              <select
                value={state.category}
                onChange={(e) => set('category', e.target.value as Category | '')}
                className={inputCls}
              >
                <option value="">—</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
              </select>
            </Field>

            <Field label="Address line 1">
              <input type="text" maxLength={255} value={state.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Address line 2">
              <input type="text" maxLength={255} value={state.addressLine2} onChange={(e) => set('addressLine2', e.target.value)} className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Postal code">
                <input type="text" maxLength={10} value={state.postalCode} onChange={(e) => set('postalCode', e.target.value)} className={inputCls} />
              </Field>
              <Field label="Phone">
                <input type="text" maxLength={20} value={state.phone} onChange={(e) => set('phone', e.target.value)} className={inputCls} />
              </Field>
            </div>
            <Field label="Email">
              <input type="email" maxLength={255} value={state.email} onChange={(e) => set('email', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Description">
              <textarea rows={3} value={state.description} onChange={(e) => set('description', e.target.value)} className={inputCls} />
            </Field>

            {error && <p className="text-sm text-semantic-danger">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-grey-70 hover:text-tone-ink">Cancel</button>
              <button type="submit" disabled={submitting} className="bg-tone-ink text-tone-surface px-4 py-2 text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50">
                {submitting ? 'Saving…' : (mode === 'create' ? 'Create branch' : 'Save changes')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const inputCls =
  'w-full border border-grey-20 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-tone-sage focus:border-tone-sage';

function Field({
  label, required, hint, children,
}: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wide text-grey-60 mb-1">
        {label}{required && <span className="text-semantic-danger ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-grey-50 mt-1">{hint}</span>}
    </label>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/web typecheck
```

- [ ] **Step 3: Commit**

```bash
git add glowos/apps/web/app/dashboard/group/branches/components/BranchForm.tsx
git commit -m "feat(brand): BranchForm shared by create + edit modals"
```

---

## Task 22 — Palette migration + New/Edit modals on `/dashboard/group/branches/page.tsx`

**Files:**
- Modify: `glowos/apps/web/app/dashboard/group/branches/page.tsx`

- [ ] **Step 1: Apply the palette substitutions from Task 16**

(Same find/replace table.)

- [ ] **Step 2: Add the page header with `+ New branch` button**

At the top of the page's main return, render:

```tsx
<div className="flex items-center justify-between mb-6">
  <div>
    <h1 className="text-2xl font-semibold text-tone-ink">Branches</h1>
    <p className="text-sm text-grey-60">Every location in your brand.</p>
  </div>
  <button
    onClick={() => setCreateOpen(true)}
    className="bg-tone-ink text-tone-surface px-4 py-2 rounded-md text-sm font-medium hover:opacity-90"
  >
    + New branch
  </button>
</div>
```

- [ ] **Step 3: Add Edit button to each row**

In the existing `branches.map(...)` rendering, add an Edit button at the end of each row:

```tsx
<button
  onClick={() => setEditing(b.merchantId)}
  className="text-sm text-tone-sage hover:text-tone-ink underline underline-offset-2"
>
  Edit
</button>
```

- [ ] **Step 4: State + modal mounts**

Add to the component:

```ts
const [createOpen, setCreateOpen] = useState(false);
const [editing, setEditing] = useState<string | null>(null);
const [refetchKey, setRefetchKey] = useState(0);
```

Hook the existing `useEffect` that fetches `/group/branches` to depend on `refetchKey` — when it changes, the list re-fetches.

Mount the modals at the bottom of the return:

```tsx
{createOpen && (
  <BranchForm
    mode="create"
    onClose={() => setCreateOpen(false)}
    onSaved={() => {
      setCreateOpen(false);
      setRefetchKey((k) => k + 1);
    }}
  />
)}
{editing && (
  <BranchForm
    mode="edit"
    merchantId={editing}
    onClose={() => setEditing(null)}
    onSaved={() => {
      setEditing(null);
      setRefetchKey((k) => k + 1);
    }}
  />
)}
```

Add the import:

```ts
import { BranchForm } from './components/BranchForm';
```

- [ ] **Step 5: Typecheck + visual smoke**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm --filter @glowos/web typecheck
```

Browser: `/dashboard/group/branches` shows the list with the New button + Edit per row. Create flow → branch appears in list. Edit flow → modal pre-fills, save updates the row.

- [ ] **Step 6: Commit**

```bash
git add glowos/apps/web/app/dashboard/group/branches/page.tsx
git commit -m "feat(brand): /group/branches gains palette migration + create/edit modals"
```

---

## Task 23 — Final integration smoke test + spec sync

**Files:**
- (No code changes; verify end-to-end.)

- [ ] **Step 1: Run all typechecks**

```bash
cd /Users/chrisrine/code/Bookingcrm/glowos && pnpm typecheck
```

Expected: clean across all packages.

- [ ] **Step 2: End-to-end manual run-through**

In a single browser session:

1. Log in as an `owner` user with no group → go to `/dashboard/settings` → see the "Convert to brand admin" card → submit a brand name → land on `/dashboard/group/overview` with the "Group" sidebar item active.
2. From group sidebar: click `+ New branch` from the Branches page → create a new branch → it appears.
3. Click Edit on the new branch → change name → save → the row updates.
4. From the group sidebar BranchPicker → pick the new branch → the brand-view banner appears at the top of `/dashboard`, sidebar reflects the new branch.
5. Click "End view" in the banner → return to home branch dashboard.
6. Log out, log back in → group is preserved (cached in localStorage from `/auth/login` response), the Group sidebar item is still there.

- [ ] **Step 3: Verify no indigo remains in `/dashboard/group/**`**

```bash
grep -rn "indigo\|fuchsia\|violet" /Users/chrisrine/code/Bookingcrm/glowos/apps/web/app/dashboard/group/ 2>/dev/null
```

Expected: empty.

- [ ] **Step 4: Sync the spec to Desktop**

```bash
cp "/Users/chrisrine/code/Bookingcrm/docs/superpowers/specs/2026-04-26-brand-admin-frontend-design.md" \
   "/Users/chrisrine/Desktop/projects/bookingcrm - doc/2026-04-26-brand-admin-frontend-design.md"
```

(No-op if already in sync.)

- [ ] **Step 5: Tag a clean commit on completion**

```bash
git log --oneline feat/brand-admin-foundation ^main | head -25
git tag brand-admin-phase-1-complete
```

(Don't push the tag without user approval — `git push` requires their go-ahead per repo norms.)

---

## Self-review notes

- **Spec coverage:** every section of the spec maps to one or more tasks — auth-login extension (Task 2), upgrade-to-brand (Task 5), branch CRUD (Tasks 6/7/8), branch switching (Tasks 9/10/11/4 + 17/18 + 13), palette migration (Tasks 16/19/20/22), Group sidebar entry (Task 14), bootstrap UI (Task 15), brand-view banner (Task 13).
- **Type consistency:** new claim names (`viewingMerchantId`, `brandViewing`, `homeMerchantId`) are introduced in Task 1 and used identically in Tasks 3, 4, 9, 10, 13, 17. `BranchForm` props (`mode`, `merchantId`, `onClose`, `onSaved`) are defined in Task 21 and consumed in Task 22.
- **Audit logging:** intentionally omitted per the spec's "Out" section — actor's `userId` is already on every write.
- **Test framework:** intentionally not added — this codebase relies on typecheck + manual verification through 19 prior sessions.
