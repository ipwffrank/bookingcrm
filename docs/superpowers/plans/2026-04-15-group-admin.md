# Group Admin UI (Phase 2A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only group admin dashboard so head-office operators (COO, area manager) can log in and view consolidated revenue, operations, and client data across all branches of their group.

**Architecture:** Extend `POST /auth/login` to check the `groupUsers` table as a fallback; issue a group-scoped JWT on match. Four new API endpoints under `/group/*` (guarded by `requireGroupAdmin` middleware) aggregate data across all merchants where `merchants.groupId` matches the session. Four new Next.js pages under `/dashboard/group/*` share a dedicated group admin layout with its own sidebar.

**Tech Stack:** Hono (API), Drizzle ORM, Neon PostgreSQL, Next.js 15 App Router, TypeScript ESM (`.js` imports required in API files), Tailwind CSS, `jsonwebtoken`

---

## File Map

**Create:**
- `glowos/services/api/src/middleware/groupAuth.ts` — `requireGroupAdmin` middleware
- `glowos/services/api/src/routes/group.ts` — 4 group API endpoints
- `glowos/apps/web/app/dashboard/group/layout.tsx` — group admin layout + sidebar
- `glowos/apps/web/app/dashboard/group/overview/page.tsx` — overview dashboard
- `glowos/apps/web/app/dashboard/group/branches/page.tsx` — branch list
- `glowos/apps/web/app/dashboard/group/branches/[merchantId]/page.tsx` — branch detail
- `glowos/apps/web/app/dashboard/group/clients/page.tsx` — unified client list

**Modify:**
- `glowos/services/api/src/lib/jwt.ts` — add group token functions
- `glowos/services/api/src/lib/types.ts` — add `groupId` to `AppVariables`
- `glowos/services/api/src/routes/auth.ts` — extend login to check `groupUsers`
- `glowos/services/api/src/index.ts` — mount `groupRouter`
- `glowos/apps/web/app/login/page.tsx` — handle `userType: 'group_admin'` response

---

## Task 1: Group JWT + AppVariables

**Files:**
- Modify: `glowos/services/api/src/lib/jwt.ts`
- Modify: `glowos/services/api/src/lib/types.ts`

- [ ] **Step 1: Add group token types and functions to `jwt.ts`**

Add after the existing `RefreshTokenPayload` interface and functions:

```typescript
export interface GroupAccessTokenPayload {
  userId: string;
  groupId: string;
  role: "group_owner";
  userType: "group_admin";
}

export function generateGroupAccessToken(payload: GroupAccessTokenPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "7d" });
}

export function verifyGroupAccessToken(token: string): GroupAccessTokenPayload & jwt.JwtPayload {
  const decoded = jwt.verify(token, config.jwtSecret) as GroupAccessTokenPayload & jwt.JwtPayload;
  if (decoded.userType !== "group_admin") {
    throw new Error("Token is not a group admin token");
  }
  return decoded;
}
```

- [ ] **Step 2: Add `groupId` to `AppVariables` in `types.ts`**

Replace the entire file with:

```typescript
/**
 * Hono context variable definitions.
 * Used to type c.set() / c.get() across all routes and middleware.
 */
export type AppVariables = {
  userId: string;
  merchantId: string;
  userRole: string;
  groupId: string;
  body: unknown;
};
```

- [ ] **Step 3: Verify typecheck passes**

```bash
cd /Users/chrisrine/Desktop/Projects/bookingcrm/glowos
pnpm turbo typecheck
```

Expected: 0 errors (existing routes don't set `groupId` — that's fine, Hono allows accessing unset variables).

- [ ] **Step 4: Commit**

```bash
cd /Users/chrisrine/Desktop/Projects/bookingcrm/glowos
git add services/api/src/lib/jwt.ts services/api/src/lib/types.ts
git commit -m "feat(group): add group JWT functions and groupId to AppVariables"
```

---

## Task 2: Group Auth Middleware + Router Skeleton

**Files:**
- Create: `glowos/services/api/src/middleware/groupAuth.ts`
- Create: `glowos/services/api/src/routes/group.ts`
- Modify: `glowos/services/api/src/index.ts`

- [ ] **Step 1: Create `groupAuth.ts`**

```typescript
import type { Context, Next } from "hono";
import { eq } from "drizzle-orm";
import { db } from "@glowos/db";
import { groupUsers } from "@glowos/db";
import { verifyGroupAccessToken } from "../lib/jwt.js";
import type { AppVariables } from "../lib/types.js";

type AppContext = Context<{ Variables: AppVariables }>;

/**
 * Hono middleware that requires a valid group admin JWT.
 * Sets groupId and userId on the context.
 */
export async function requireGroupAdmin(c: AppContext, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized", message: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);

  let payload: { userId: string; groupId: string };
  try {
    payload = verifyGroupAccessToken(token);
  } catch {
    return c.json({ error: "Unauthorized", message: "Invalid or expired token" }, 401);
  }

  // Verify user still exists in groupUsers
  const [user] = await db
    .select({ id: groupUsers.id, groupId: groupUsers.groupId })
    .from(groupUsers)
    .where(eq(groupUsers.id, payload.userId))
    .limit(1);

  if (!user) {
    return c.json({ error: "Unauthorized", message: "Group user not found" }, 401);
  }

  // Verify token groupId matches DB groupId (prevents token reuse after reassignment)
  if (user.groupId !== payload.groupId) {
    return c.json({ error: "Unauthorized", message: "Group mismatch" }, 401);
  }

  c.set("userId", user.id);
  c.set("groupId", user.groupId);

  await next();
}
```

- [ ] **Step 2: Create `group.ts` router skeleton**

```typescript
import { Hono } from "hono";
import { requireGroupAdmin } from "../middleware/groupAuth.js";
import type { AppVariables } from "../lib/types.js";

const groupRouter = new Hono<{ Variables: AppVariables }>();

// All group routes require group admin auth
groupRouter.use("*", requireGroupAdmin);

// ─── GET /group/overview ────────────────────────────────────────────────────────
groupRouter.get("/overview", async (c) => {
  return c.json({ message: "TODO: overview" }, 501);
});

// ─── GET /group/branches ────────────────────────────────────────────────────────
groupRouter.get("/branches", async (c) => {
  return c.json({ message: "TODO: branches" }, 501);
});

// ─── GET /group/branches/:merchantId ──────────────────────────────────────────
groupRouter.get("/branches/:merchantId", async (c) => {
  return c.json({ message: "TODO: branch detail" }, 501);
});

// ─── GET /group/clients ─────────────────────────────────────────────────────────
groupRouter.get("/clients", async (c) => {
  return c.json({ message: "TODO: clients" }, 501);
});

export { groupRouter };
```

- [ ] **Step 3: Mount `groupRouter` in `index.ts`**

Add to `index.ts` imports:
```typescript
import { groupRouter } from "./routes/group.js";
```

Add after the other `app.route()` calls:
```typescript
app.route("/group", groupRouter);
```

- [ ] **Step 4: Verify API starts**

```bash
cd /Users/chrisrine/Desktop/Projects/bookingcrm/glowos/services/api
pnpm dev
```

Expected: server starts, no TypeScript errors. `GET /group/overview` returns 401 (no token).

- [ ] **Step 5: Commit**

```bash
cd /Users/chrisrine/Desktop/Projects/bookingcrm/glowos
git add services/api/src/middleware/groupAuth.ts services/api/src/routes/group.ts services/api/src/index.ts
git commit -m "feat(group): add requireGroupAdmin middleware and group router skeleton"
```

---

## Task 3: Extend POST /auth/login for Group Users

**Files:**
- Modify: `glowos/services/api/src/routes/auth.ts`

- [ ] **Step 1: Add imports to `auth.ts`**

Add to the existing import line at the top:
```typescript
import { db, merchants, merchantUsers, groupUsers, groups } from "@glowos/db";
```

And add to the jwt import:
```typescript
import { generateAccessToken, generateRefreshToken, verifyRefreshToken, generateGroupAccessToken } from "../lib/jwt.js";
```

- [ ] **Step 2: Extend the `POST /auth/login` handler**

Find the block after `if (!passwordValid)` returns 401 and after `if (!user.isActive)` returns 403. After the existing handler returns the merchant response, add a group user fallback BEFORE the final `return c.json(...)`. 

Replace the `auth.post("/login", ...)` handler body with this new version that falls back to `groupUsers` when no merchant user is found:

```typescript
auth.post("/login", zValidator(loginSchema), async (c) => {
  const body = c.get("body") as z.infer<typeof loginSchema>;

  // ── Try merchant user first ────────────────────────────────────────────────
  const [row] = await db
    .select({ user: merchantUsers, merchant: merchants })
    .from(merchantUsers)
    .innerJoin(merchants, eq(merchantUsers.merchantId, merchants.id))
    .where(eq(merchantUsers.email, body.email))
    .limit(1);

  if (row) {
    const { user, merchant } = row;

    const passwordValid = await bcrypt.compare(body.password, user.passwordHash);
    if (!passwordValid) {
      return c.json({ error: "Unauthorized", message: "Invalid email or password" }, 401);
    }

    if (!user.isActive) {
      return c.json({ error: "Forbidden", message: "Your account has been deactivated" }, 403);
    }

    await db.update(merchantUsers).set({ lastLoginAt: new Date() }).where(eq(merchantUsers.id, user.id));

    const accessToken = generateAccessToken({ userId: user.id, merchantId: merchant.id, role: user.role });
    const refreshToken = generateRefreshToken({ userId: user.id });
    const { passwordHash: _pw, ...safeUser } = user;

    return c.json({ userType: "merchant", user: safeUser, merchant, access_token: accessToken, refresh_token: refreshToken });
  }

  // ── Fall back to group user ────────────────────────────────────────────────
  const [groupRow] = await db
    .select({ groupUser: groupUsers, group: groups })
    .from(groupUsers)
    .innerJoin(groups, eq(groupUsers.groupId, groups.id))
    .where(eq(groupUsers.email, body.email))
    .limit(1);

  if (!groupRow) {
    return c.json({ error: "Unauthorized", message: "Invalid email or password" }, 401);
  }

  const { groupUser, group } = groupRow;

  const passwordValid = await bcrypt.compare(body.password, groupUser.passwordHash);
  if (!passwordValid) {
    return c.json({ error: "Unauthorized", message: "Invalid email or password" }, 401);
  }

  const accessToken = generateGroupAccessToken({
    userId: groupUser.id,
    groupId: group.id,
    role: "group_owner",
    userType: "group_admin",
  });

  const { passwordHash: _pw, ...safeGroupUser } = groupUser;

  return c.json({
    userType: "group_admin",
    user: safeGroupUser,
    group,
    access_token: accessToken,
  });
});
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/chrisrine/Desktop/Projects/bookingcrm/glowos
pnpm turbo typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/chrisrine/Desktop/Projects/bookingcrm/glowos
git add services/api/src/routes/auth.ts
git commit -m "feat(group): extend login endpoint to authenticate group users"
```

---

## Task 4: Group Overview API

**Files:**
- Modify: `glowos/services/api/src/routes/group.ts`

- [ ] **Step 1: Add imports to `group.ts`**

Replace the top of `group.ts` with:

```typescript
import { Hono } from "hono";
import { eq, inArray, and, gte, lt, sum, count, countDistinct, desc, or, ilike, sql } from "drizzle-orm";
import { db, merchants, bookings, clients, groupUsers } from "@glowos/db";
import { requireGroupAdmin } from "../middleware/groupAuth.js";
import type { AppVariables } from "../lib/types.js";

const groupRouter = new Hono<{ Variables: AppVariables }>();

groupRouter.use("*", requireGroupAdmin);
```

- [ ] **Step 2: Implement the date range helper (add at top of file, before routes)**

```typescript
function parseDateRange(fromStr: string | undefined, toStr: string | undefined): { from: Date; to: Date } {
  const now = new Date();
  const from = fromStr ? new Date(fromStr) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = toStr ? new Date(toStr) : now;
  return { from, to };
}
```

- [ ] **Step 3: Implement `GET /group/overview`**

Replace the overview stub with:

```typescript
groupRouter.get("/overview", async (c) => {
  const groupId = c.get("groupId");
  const { from, to } = parseDateRange(c.req.query("from"), c.req.query("to"));

  // 1. Get all merchantIds for this group
  const merchantRows = await db
    .select({ id: merchants.id, name: merchants.name })
    .from(merchants)
    .where(eq(merchants.groupId, groupId));

  const merchantIds = merchantRows.map((m) => m.id);

  if (merchantIds.length === 0) {
    return c.json({ revenue: 0, bookingCount: 0, activeClients: 0, revenueByBranch: [], opsHealth: [], topClients: [] });
  }

  // 2. Total revenue + booking count (completed bookings only)
  const [stats] = await db
    .select({ revenue: sum(bookings.priceSgd), bookingCount: count(bookings.id) })
    .from(bookings)
    .where(and(inArray(bookings.merchantId, merchantIds), eq(bookings.status, "completed"), gte(bookings.startTime, from), lt(bookings.startTime, to)));

  // 3. Active clients (distinct clientId with any booking in period)
  const [{ activeClients }] = await db
    .select({ activeClients: countDistinct(bookings.clientId) })
    .from(bookings)
    .where(and(inArray(bookings.merchantId, merchantIds), gte(bookings.startTime, from), lt(bookings.startTime, to)));

  // 4. Revenue by branch (completed)
  const revenueByBranchRows = await db
    .select({ merchantId: bookings.merchantId, revenue: sum(bookings.priceSgd) })
    .from(bookings)
    .where(and(inArray(bookings.merchantId, merchantIds), eq(bookings.status, "completed"), gte(bookings.startTime, from), lt(bookings.startTime, to)))
    .groupBy(bookings.merchantId);

  // 5. Ops health: confirmed+completed+in_progress booking count per branch
  const opsRows = await db
    .select({ merchantId: bookings.merchantId, bookingCount: count(bookings.id) })
    .from(bookings)
    .where(
      and(
        inArray(bookings.merchantId, merchantIds),
        or(eq(bookings.status, "confirmed"), eq(bookings.status, "completed"), eq(bookings.status, "in_progress")),
        gte(bookings.startTime, from),
        lt(bookings.startTime, to)
      )
    )
    .groupBy(bookings.merchantId);

  // 6. Top 5 clients by total spend in period
  const topClientsRows = await db
    .select({ id: clients.id, name: clients.name, phone: clients.phone, totalSpend: sum(bookings.priceSgd) })
    .from(bookings)
    .innerJoin(clients, eq(bookings.clientId, clients.id))
    .where(and(inArray(bookings.merchantId, merchantIds), eq(bookings.status, "completed"), gte(bookings.startTime, from), lt(bookings.startTime, to)))
    .groupBy(clients.id, clients.name, clients.phone)
    .orderBy(desc(sum(bookings.priceSgd)))
    .limit(5);

  // Build name map for branch lookup
  const nameMap = Object.fromEntries(merchantRows.map((m) => [m.id, m.name]));

  return c.json({
    revenue: parseFloat(stats?.revenue ?? "0"),
    bookingCount: stats?.bookingCount ?? 0,
    activeClients: activeClients ?? 0,
    revenueByBranch: revenueByBranchRows.map((r) => ({
      merchantId: r.merchantId,
      name: nameMap[r.merchantId] ?? "Unknown",
      revenue: parseFloat(r.revenue ?? "0"),
    })).sort((a, b) => b.revenue - a.revenue),
    opsHealth: opsRows.map((r) => ({
      merchantId: r.merchantId,
      name: nameMap[r.merchantId] ?? "Unknown",
      bookingCount: r.bookingCount,
    })).sort((a, b) => b.bookingCount - a.bookingCount),
    topClients: topClientsRows.map((r) => ({
      id: r.id,
      name: r.name ?? "Unknown",
      phone: r.phone,
      totalSpend: parseFloat(r.totalSpend ?? "0"),
    })),
  });
});
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/chrisrine/Desktop/Projects/bookingcrm/glowos
pnpm turbo typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/chrisrine/Desktop/Projects/bookingcrm/glowos
git add services/api/src/routes/group.ts
git commit -m "feat(group): implement GET /group/overview aggregate endpoint"
```

---

## Task 5: Group Branches API

**Files:**
- Modify: `glowos/services/api/src/routes/group.ts`

- [ ] **Step 1: Implement `GET /group/branches`**

Replace the branches stub with:

```typescript
groupRouter.get("/branches", async (c) => {
  const groupId = c.get("groupId");
  const { from, to } = parseDateRange(c.req.query("from"), c.req.query("to"));

  const merchantRows = await db
    .select({ id: merchants.id, name: merchants.name, addressLine1: merchants.addressLine1, category: merchants.category })
    .from(merchants)
    .where(eq(merchants.groupId, groupId));

  const merchantIds = merchantRows.map((m) => m.id);

  if (merchantIds.length === 0) {
    return c.json({ branches: [] });
  }

  // Revenue + booking count per branch (completed bookings)
  const revenueRows = await db
    .select({ merchantId: bookings.merchantId, revenue: sum(bookings.priceSgd), bookingCount: count(bookings.id) })
    .from(bookings)
    .where(and(inArray(bookings.merchantId, merchantIds), eq(bookings.status, "completed"), gte(bookings.startTime, from), lt(bookings.startTime, to)))
    .groupBy(bookings.merchantId);

  const revenueMap = Object.fromEntries(revenueRows.map((r) => [r.merchantId, r]));

  return c.json({
    branches: merchantRows.map((m) => {
      const stats = revenueMap[m.id];
      return {
        merchantId: m.id,
        name: m.name,
        location: m.addressLine1 ?? "",
        category: m.category ?? "",
        revenue: parseFloat(stats?.revenue ?? "0"),
        bookingCount: stats?.bookingCount ?? 0,
      };
    }),
  });
});
```

- [ ] **Step 2: Implement `GET /group/branches/:merchantId`**

Replace the branch detail stub with:

```typescript
groupRouter.get("/branches/:merchantId", async (c) => {
  const groupId = c.get("groupId");
  const merchantId = c.req.param("merchantId")!;
  const { from, to } = parseDateRange(c.req.query("from"), c.req.query("to"));

  // Verify this merchant belongs to the group
  const [merchant] = await db
    .select({ id: merchants.id, name: merchants.name, addressLine1: merchants.addressLine1 })
    .from(merchants)
    .where(and(eq(merchants.id, merchantId), eq(merchants.groupId, groupId)))
    .limit(1);

  if (!merchant) {
    return c.json({ error: "Not Found", message: "Branch not found in your group" }, 404);
  }

  // Revenue + booking count (completed)
  const [stats] = await db
    .select({ revenue: sum(bookings.priceSgd), bookingCount: count(bookings.id) })
    .from(bookings)
    .where(and(eq(bookings.merchantId, merchantId), eq(bookings.status, "completed"), gte(bookings.startTime, from), lt(bookings.startTime, to)));

  // Active clients
  const [{ activeClients }] = await db
    .select({ activeClients: countDistinct(bookings.clientId) })
    .from(bookings)
    .where(and(eq(bookings.merchantId, merchantId), gte(bookings.startTime, from), lt(bookings.startTime, to)));

  // Recent bookings (last 10)
  const recentBookings = await db
    .select({
      id: bookings.id,
      clientId: bookings.clientId,
      serviceId: bookings.serviceId,
      startTime: bookings.startTime,
      status: bookings.status,
      priceSgd: bookings.priceSgd,
    })
    .from(bookings)
    .where(and(eq(bookings.merchantId, merchantId), gte(bookings.startTime, from), lt(bookings.startTime, to)))
    .orderBy(desc(bookings.startTime))
    .limit(10);

  return c.json({
    merchant: { id: merchant.id, name: merchant.name, location: merchant.addressLine1 ?? "" },
    revenue: parseFloat(stats?.revenue ?? "0"),
    bookingCount: stats?.bookingCount ?? 0,
    activeClients: activeClients ?? 0,
    recentBookings,
  });
});
```

- [ ] **Step 3: Typecheck and commit**

```bash
cd /Users/chrisrine/Desktop/Projects/bookingcrm/glowos
pnpm turbo typecheck
git add services/api/src/routes/group.ts
git commit -m "feat(group): implement GET /group/branches and /group/branches/:merchantId"
```

---

## Task 6: Group Clients API

**Files:**
- Modify: `glowos/services/api/src/routes/group.ts`

- [ ] **Step 1: Implement `GET /group/clients`**

Replace the clients stub with:

```typescript
groupRouter.get("/clients", async (c) => {
  const groupId = c.get("groupId");
  const search = c.req.query("search") ?? "";
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") ?? "20", 10)));
  const offset = (page - 1) * limit;

  // Get all merchantIds for this group
  const merchantRows = await db
    .select({ id: merchants.id })
    .from(merchants)
    .where(eq(merchants.groupId, groupId));

  const merchantIds = merchantRows.map((m) => m.id);

  if (merchantIds.length === 0) {
    return c.json({ clients: [], total: 0, page, limit });
  }

  // Base filter: client has at least one booking in this group
  // Deduplication is automatic — clients.id is unique per phone number
  const searchFilter = search
    ? or(ilike(clients.name, `%${search}%`), ilike(clients.phone, `%${search}%`))
    : undefined;

  const baseWhere = and(
    inArray(bookings.merchantId, merchantIds),
    searchFilter
  );

  // Count total matching clients
  const [{ total }] = await db
    .select({ total: countDistinct(clients.id) })
    .from(clients)
    .innerJoin(bookings, eq(clients.id, bookings.clientId))
    .where(baseWhere);

  // Client list with aggregates
  // MAX(startTime) gives the most recent booking date per client across the group.
  const clientRows = await db
    .select({
      id: clients.id,
      name: clients.name,
      phone: clients.phone,
      email: clients.email,
      totalSpend: sum(bookings.priceSgd),
      branchCount: countDistinct(bookings.merchantId),
      lastVisit: sql<Date | null>`MAX(${bookings.startTime})`,
    })
    .from(clients)
    .innerJoin(bookings, and(eq(clients.id, bookings.clientId), eq(bookings.status, "completed")))
    .where(baseWhere)
    .groupBy(clients.id, clients.name, clients.phone, clients.email)
    .orderBy(desc(sum(bookings.priceSgd)))
    .limit(limit)
    .offset(offset);

  return c.json({
    clients: clientRows.map((r) => ({
      id: r.id,
      name: r.name ?? "Unknown",
      phone: r.phone,
      email: r.email ?? null,
      totalSpend: parseFloat(r.totalSpend ?? "0"),
      branchCount: r.branchCount,
      lastVisit: r.lastVisit,
    })),
    total: total ?? 0,
    page,
    limit,
  });
});
```

- [ ] **Step 2: Typecheck and commit**

```bash
cd /Users/chrisrine/Desktop/Projects/bookingcrm/glowos
pnpm turbo typecheck
git add services/api/src/routes/group.ts
git commit -m "feat(group): implement GET /group/clients with search and pagination"
```

---

## Task 7: Login Page Update

**Files:**
- Modify: `glowos/apps/web/app/login/page.tsx`

- [ ] **Step 1: Update `handleSubmit` to handle group admin response**

Replace the `handleSubmit` function body inside `LoginPage`:

```typescript
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  setError('');
  if (!email.trim() || !password) {
    setError('Please enter your email and password');
    return;
  }
  setLoading(true);
  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (data.userType === 'group_admin') {
      // Group admin flow
      localStorage.setItem('group_token', data.access_token);
      localStorage.setItem('group_user', JSON.stringify(data.user));
      localStorage.setItem('group', JSON.stringify(data.group));
      router.push('/dashboard/group/overview');
    } else {
      // Branch admin flow (existing)
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('merchant', JSON.stringify(data.merchant));
      router.push('/dashboard');
    }
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Login failed');
  } finally {
    setLoading(false);
  }
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
cd /Users/chrisrine/Desktop/Projects/bookingcrm/glowos
pnpm turbo typecheck
git add apps/web/app/login/page.tsx
git commit -m "feat(group): update login page to handle group admin redirect"
```

---

## Task 8: Group Admin Layout

**Files:**
- Create: `glowos/apps/web/app/dashboard/group/layout.tsx`

- [ ] **Step 1: Create the group layout file**

```typescript
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

interface Group {
  id: string;
  name: string;
}

const GROUP_NAV = [
  { href: '/dashboard/group/overview', label: 'Overview', icon: ChartIcon },
  { href: '/dashboard/group/branches', label: 'Branches', icon: BuildingIcon },
  { href: '/dashboard/group/clients', label: 'Clients', icon: UsersIcon },
];

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    </svg>
  );
}

function BuildingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  );
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

export default function GroupLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [group, setGroup] = useState<Group | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('group_token');
    if (!token) {
      router.push('/login');
      return;
    }
    const cached = localStorage.getItem('group');
    if (cached) {
      try { setGroup(JSON.parse(cached) as Group); } catch { /* ignore */ }
    }
  }, [router]);

  function handleLogout() {
    localStorage.removeItem('group_token');
    localStorage.removeItem('group_user');
    localStorage.removeItem('group');
    router.push('/login');
  }

  const isActive = (href: string) => pathname.startsWith(href);

  const Sidebar = () => (
    <nav className="flex flex-col h-full">
      <div className="px-6 py-5 border-b border-gray-100">
        <Link href="/" className="text-xl font-bold text-indigo-600">GlowOS</Link>
        {group && <p className="text-xs text-gray-500 mt-0.5 truncate">{group.name} — Group Admin</p>}
      </div>
      <div className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {GROUP_NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Icon className={`w-5 h-5 flex-shrink-0 ${active ? 'text-indigo-600' : 'text-gray-400'}`} />
              {item.label}
            </Link>
          );
        })}
      </div>
      <div className="px-3 py-4 border-t border-gray-100">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 w-full rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
        >
          <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
          </svg>
          Logout
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="hidden lg:flex flex-col w-60 bg-white border-r border-gray-200 fixed inset-y-0 left-0 z-30">
        <Sidebar />
      </aside>

      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="fixed inset-0 bg-black/30" onClick={() => setSidebarOpen(false)} />
          <aside className="relative z-50 flex flex-col w-64 bg-white shadow-xl">
            <div className="absolute top-4 right-4">
              <button onClick={() => setSidebarOpen(false)} className="p-1 rounded-md text-gray-400 hover:text-gray-600">
                <XIcon className="w-5 h-5" />
              </button>
            </div>
            <Sidebar />
          </aside>
        </div>
      )}

      <div className="flex-1 lg:ml-60 flex flex-col min-h-screen">
        <header className="lg:hidden bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-20">
          <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-md text-gray-500 hover:bg-gray-100">
            <MenuIcon className="w-5 h-5" />
          </button>
          <Link href="/" className="text-lg font-bold text-indigo-600">GlowOS</Link>
          <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-gray-700">Logout</button>
        </header>
        <main className="flex-1 px-4 lg:px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
cd /Users/chrisrine/Desktop/Projects/bookingcrm/glowos
pnpm turbo typecheck
git add apps/web/app/dashboard/group/layout.tsx
git commit -m "feat(group): add group admin layout with sidebar"
```

---

## Task 9: Overview Page

**Files:**
- Create: `glowos/apps/web/app/dashboard/group/overview/page.tsx`

- [ ] **Step 1: Create the overview page**

```typescript
'use client';

import { useEffect, useState } from 'react';

interface OverviewData {
  revenue: number;
  bookingCount: number;
  activeClients: number;
  revenueByBranch: { merchantId: string; name: string; revenue: number }[];
  opsHealth: { merchantId: string; name: string; bookingCount: number }[];
  topClients: { id: string; name: string; phone: string; totalSpend: number }[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function fmtCurrency(n: number) {
  return `$${n.toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function DateRangePicker({ from, to, onChange }: {
  from: string; to: string;
  onChange: (from: string, to: string) => void;
}) {
  const now = new Date();
  const presets = [
    { label: 'MTD', from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) },
    { label: 'Last 30d', from: new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) },
    { label: 'Last 90d', from: new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) },
  ];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {presets.map((p) => (
        <button
          key={p.label}
          onClick={() => onChange(p.from, p.to)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            from === p.from && to === p.to
              ? 'bg-indigo-600 text-white'
              : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {p.label}
        </button>
      ))}
      <input type="date" value={from} onChange={(e) => onChange(e.target.value, to)}
        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500" />
      <span className="text-xs text-gray-400">to</span>
      <input type="date" value={to} onChange={(e) => onChange(from, e.target.value)}
        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500" />
    </div>
  );
}

export default function GroupOverviewPage() {
  const now = new Date();
  const [from, setFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('group_token');
    if (!token) return;
    setLoading(true);
    setError('');
    fetch(`${API_URL}/group/overview?from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => setData(d as OverviewData))
      .catch(() => setError('Failed to load overview data'))
      .finally(() => setLoading(false));
  }, [from, to]);

  const maxRevenue = Math.max(...(data?.revenueByBranch.map((b) => b.revenue) ?? [1]), 1);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Group Overview</h1>
        <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : data ? (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Revenue</p>
              <p className="text-3xl font-bold text-green-600 mt-1">{fmtCurrency(data.revenue)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Bookings</p>
              <p className="text-3xl font-bold text-blue-600 mt-1">{data.bookingCount.toLocaleString()}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Active Clients</p>
              <p className="text-3xl font-bold text-purple-600 mt-1">{data.activeClients.toLocaleString()}</p>
            </div>
          </div>

          {/* Revenue by Branch */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Revenue by Branch</h2>
            <div className="space-y-3">
              {data.revenueByBranch.map((b) => (
                <div key={b.merchantId} className="flex items-center gap-3">
                  <span className="text-sm text-gray-700 w-32 truncate">{b.name}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                    <div
                      className="bg-green-500 h-2.5 rounded-full transition-all"
                      style={{ width: `${(b.revenue / maxRevenue) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-700 w-24 text-right">{fmtCurrency(b.revenue)}</span>
                </div>
              ))}
              {data.revenueByBranch.length === 0 && <p className="text-sm text-gray-400">No revenue data for this period.</p>}
            </div>
          </div>

          {/* Bottom row: Ops + Top Clients */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Operations Health</h2>
              <div className="space-y-2">
                {data.opsHealth.map((b) => {
                  const color = b.bookingCount >= 50 ? 'text-green-600' : b.bookingCount >= 20 ? 'text-amber-500' : 'text-red-500';
                  const dot = b.bookingCount >= 50 ? 'bg-green-500' : b.bookingCount >= 20 ? 'bg-amber-400' : 'bg-red-400';
                  return (
                    <div key={b.merchantId} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${dot}`} />
                        <span className="text-sm text-gray-700">{b.name}</span>
                      </div>
                      <span className={`text-sm font-medium ${color}`}>{b.bookingCount} bookings</span>
                    </div>
                  );
                })}
                {data.opsHealth.length === 0 && <p className="text-sm text-gray-400">No bookings in this period.</p>}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Top Clients</h2>
              <div className="space-y-2">
                {data.topClients.map((cl) => (
                  <div key={cl.id} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{cl.name}</p>
                      <p className="text-xs text-gray-500">{cl.phone}</p>
                    </div>
                    <span className="text-sm font-semibold text-gray-700">{fmtCurrency(cl.totalSpend)}</span>
                  </div>
                ))}
                {data.topClients.length === 0 && <p className="text-sm text-gray-400">No client data for this period.</p>}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
cd /Users/chrisrine/Desktop/Projects/bookingcrm/glowos
pnpm turbo typecheck
git add apps/web/app/dashboard/group/overview/page.tsx
git commit -m "feat(group): add group overview dashboard page"
```

---

## Task 10: Branches Pages

**Files:**
- Create: `glowos/apps/web/app/dashboard/group/branches/page.tsx`
- Create: `glowos/apps/web/app/dashboard/group/branches/[merchantId]/page.tsx`

- [ ] **Step 1: Create `branches/page.tsx`**

```typescript
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Branch {
  merchantId: string;
  name: string;
  location: string;
  category: string;
  revenue: number;
  bookingCount: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function fmtCurrency(n: number) {
  return `$${n.toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function BranchesPage() {
  const now = new Date();
  const [from, setFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('group_token');
    if (!token) return;
    setLoading(true);
    fetch(`${API_URL}/group/branches?from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d: { branches: Branch[] }) => setBranches(d.branches))
      .catch(() => setError('Failed to load branches'))
      .finally(() => setLoading(false));
  }, [from, to]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Branches</h1>
        <div className="flex items-center gap-2">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500" />
          <span className="text-xs text-gray-400">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Branch</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden sm:table-cell">Location</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Revenue</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">Bookings</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {branches.map((b) => (
                <tr key={b.merchantId} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-800">{b.name}</td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{b.location || '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-green-600">{fmtCurrency(b.revenue)}</td>
                  <td className="px-4 py-3 text-right text-gray-600 hidden md:table-cell">{b.bookingCount}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/dashboard/group/branches/${b.merchantId}?from=${from}&to=${to}`}
                      className="text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
              {branches.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">No branches found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `branches/[merchantId]/page.tsx`**

Note: `useSearchParams()` in Next.js App Router requires a `<Suspense>` boundary. Split into an inner component (that calls `useSearchParams`) and a default export that wraps it.

```typescript
'use client';

import { useEffect, useState, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface BranchDetail {
  merchant: { id: string; name: string; location: string };
  revenue: number;
  bookingCount: number;
  activeClients: number;
  recentBookings: { id: string; startTime: string; status: string; priceSgd: string }[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function fmtCurrency(n: number) {
  return `$${n.toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function BranchDetailInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const merchantId = params.merchantId as string;
  const from = searchParams.get('from') ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const to = searchParams.get('to') ?? new Date().toISOString().slice(0, 10);

  const [data, setData] = useState<BranchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('group_token');
    if (!token) return;
    setLoading(true);
    fetch(`${API_URL}/group/branches/${merchantId}?from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => { if (!r.ok) throw new Error('Not found'); return r.json(); })
      .then((d) => setData(d as BranchDetail))
      .catch(() => setError('Failed to load branch data'))
      .finally(() => setLoading(false));
  }, [merchantId, from, to]);

  return (
    <div>
      <div className="mb-6">
        <Link href="/dashboard/group/branches" className="text-sm text-indigo-600 hover:text-indigo-800">← All Branches</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">{data?.merchant.name ?? 'Branch Detail'}</h1>
        {data?.merchant.location && <p className="text-sm text-gray-500 mt-0.5">{data.merchant.location}</p>}
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Revenue</p>
              <p className="text-3xl font-bold text-green-600 mt-1">{fmtCurrency(data.revenue)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Bookings</p>
              <p className="text-3xl font-bold text-blue-600 mt-1">{data.bookingCount}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Active Clients</p>
              <p className="text-3xl font-bold text-purple-600 mt-1">{data.activeClients}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Recent Bookings</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Date</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.recentBookings.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-3 text-gray-700">{new Date(b.startTime).toLocaleDateString('en-SG')}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        b.status === 'completed' ? 'bg-green-100 text-green-700' :
                        b.status === 'confirmed' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{b.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-700">{fmtCurrency(parseFloat(b.priceSgd))}</td>
                  </tr>
                ))}
                {data.recentBookings.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400 text-sm">No bookings in this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function BranchDetailPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-500 px-8 py-6">Loading...</div>}>
      <BranchDetailInner />
    </Suspense>
  );
}
```

- [ ] **Step 3: Typecheck and commit**

```bash
cd /Users/chrisrine/Desktop/Projects/bookingcrm/glowos
pnpm turbo typecheck
git add apps/web/app/dashboard/group/branches/
git commit -m "feat(group): add branches list and branch detail pages"
```

---

## Task 11: Clients Page

**Files:**
- Create: `glowos/apps/web/app/dashboard/group/clients/page.tsx`

- [ ] **Step 1: Create `clients/page.tsx`**

```typescript
'use client';

import { useEffect, useState, useCallback } from 'react';

interface GroupClient {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  totalSpend: number;
  branchCount: number;
  lastVisit: string | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function fmtCurrency(n: number) {
  return `$${n.toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function GroupClientsPage() {
  const [clients, setClients] = useState<GroupClient[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const limit = 20;

  const fetchClients = useCallback(() => {
    const token = localStorage.getItem('group_token');
    if (!token) return;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set('search', search);
    fetch(`${API_URL}/group/clients?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d: { clients: GroupClient[]; total: number }) => {
        setClients(d.clients);
        setTotal(d.total);
      })
      .catch(() => setError('Failed to load clients'))
      .finally(() => setLoading(false));
  }, [page, search]);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Clients <span className="text-gray-400 text-lg font-normal">({total.toLocaleString()})</span></h1>
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name or phone..."
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500 w-48"
          />
          <button type="submit" className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors">Search</button>
          {search && (
            <button type="button" onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }}
              className="px-3 py-1.5 bg-white border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors">Clear</button>
          )}
        </form>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="text-sm text-gray-500">Loading...</div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Client</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden sm:table-cell">Phone</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Total Spend</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">Branches</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 hidden lg:table-cell">Last Visit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clients.map((cl) => (
                  <tr key={cl.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{cl.name}</p>
                      {cl.email && <p className="text-xs text-gray-400">{cl.email}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{cl.phone}</td>
                    <td className="px-4 py-3 text-right font-semibold text-green-600">{fmtCurrency(cl.totalSpend)}</td>
                    <td className="px-4 py-3 text-center hidden md:table-cell">
                      {cl.branchCount > 1 ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">{cl.branchCount} branches</span>
                      ) : (
                        <span className="text-gray-400 text-xs">1</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 hidden lg:table-cell text-xs">
                      {cl.lastVisit ? new Date(cl.lastVisit).toLocaleDateString('en-SG') : '—'}
                    </td>
                  </tr>
                ))}
                {clients.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">No clients found.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-500">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors"
                >Previous</button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors"
                >Next</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
cd /Users/chrisrine/Desktop/Projects/bookingcrm/glowos
pnpm turbo typecheck
git add apps/web/app/dashboard/group/clients/page.tsx
git commit -m "feat(group): add unified clients page with search and pagination"
```

---

## Task 12: Final Typecheck + Integration Check

**Files:** All modified files

- [ ] **Step 1: Full typecheck**

```bash
cd /Users/chrisrine/Desktop/Projects/bookingcrm/glowos
pnpm turbo typecheck
```

Expected: 0 errors across all 6 packages.

- [ ] **Step 2: API smoke test — start dev server and verify routes exist**

```bash
cd /Users/chrisrine/Desktop/Projects/bookingcrm/glowos/services/api
pnpm dev
```

In another terminal:
```bash
# Should return 401 (no token)
curl -s http://localhost:3001/group/overview | jq .
# Expected: {"error":"Unauthorized","message":"Missing or invalid Authorization header"}

# Should return 401 (no token)
curl -s http://localhost:3001/group/branches | jq .
# Expected: {"error":"Unauthorized","message":"Missing or invalid Authorization header"}

# Health check still works
curl -s http://localhost:3001/health | jq .status
# Expected: "ok"
```

- [ ] **Step 3: Verify login endpoint handles unknown email the same as before**

```bash
curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"nonexistent@example.com","password":"wrong"}' | jq .
# Expected: {"error":"Unauthorized","message":"Invalid email or password"}
```

- [ ] **Step 4: Final commit**

```bash
cd /Users/chrisrine/Desktop/Projects/bookingcrm/glowos
git add -A
git status
# Verify no unexpected files staged
git commit -m "feat(group): Phase 2A group admin UI complete — all 12 tasks done"
```

---

## Seeding a Test Group Admin (Manual — post-deploy)

To test the group admin flow end-to-end, run these SQL statements in Neon console after deploy:

```sql
-- 1. Create a group
INSERT INTO groups (id, name) VALUES (gen_random_uuid(), 'GlowOS Demo Group') RETURNING id;

-- 2. Link an existing merchant to the group (replace UUIDs)
UPDATE merchants SET group_id = '<group-id-from-step-1>' WHERE id = '<your-merchant-id>';

-- 3. Create a group user (password hash = bcrypt of 'groupadmin123')
INSERT INTO group_users (group_id, email, password_hash, name, role)
VALUES (
  '<group-id-from-step-1>',
  'groupadmin@example.com',
  '$2b$10$K7L/8Y2mKpQHmPz2F3T8COL5VQ7sZl/p/jVFNxUY6s1m3K4bR6aIK',
  'Demo COO',
  'group_owner'
);
```

Then log in at `/login` with `groupadmin@example.com` / `groupadmin123` — you should land on `/dashboard/group/overview`.
