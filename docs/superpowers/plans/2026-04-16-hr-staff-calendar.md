# HR & Staff Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a staff HR module with duty block scheduling (drag-and-drop), unified bookings calendar, staff logins, and a staff-facing dashboard.

**Architecture:** Extends existing auth (`merchant_users` + JWT) with a `staff` role that includes a `staffId` claim. New `staff_duties` table stores duty blocks. FullCalendar React handles all calendar/drag-and-drop UI. Staff dashboard is a separate Next.js layout at `/staff/*`.

**Tech Stack:** Drizzle ORM + Neon PostgreSQL, Hono API, Next.js 15 App Router, FullCalendar React (`@fullcalendar/react`, `@fullcalendar/timegrid`, `@fullcalendar/interaction`), TypeScript ESM

---

## File Map

### New files:
- `glowos/packages/db/src/schema/staff-duties.ts` — `staffDuties` table schema
- `glowos/services/api/src/routes/duties.ts` — CRUD for duty blocks
- `glowos/services/api/src/routes/staff-auth.ts` — staff login management (create/reset)
- `glowos/services/api/src/routes/staff-portal.ts` — staff-scoped routes (`/staff/me`, `/staff/bookings`, `/staff/my-bookings`)
- `glowos/apps/web/app/dashboard/roster/page.tsx` — admin roster calendar
- `glowos/apps/web/app/dashboard/calendar/page.tsx` — admin unified bookings calendar
- `glowos/apps/web/app/staff/layout.tsx` — staff dashboard layout
- `glowos/apps/web/app/staff/dashboard/page.tsx` — staff My Schedule
- `glowos/apps/web/app/staff/bookings/page.tsx` — staff All Bookings
- `glowos/apps/web/app/staff/my-bookings/page.tsx` — staff My Bookings

### Modified files:
- `glowos/packages/db/src/schema/merchant-users.ts` — add nullable `staffId` column
- `glowos/packages/db/src/schema/index.ts` — export `staff-duties`
- `glowos/services/api/src/lib/jwt.ts` — add `staffId` to `AccessTokenPayload`
- `glowos/services/api/src/lib/types.ts` — add `staffId` to `AppVariables`
- `glowos/services/api/src/middleware/auth.ts` — add `requireAdmin` middleware
- `glowos/services/api/src/routes/auth.ts` — set `staffId` in token on login
- `glowos/services/api/src/index.ts` — mount duties, staff-auth, staff-portal routers
- `glowos/apps/web/app/login/page.tsx` — redirect staff role to `/staff/dashboard`
- `glowos/apps/web/app/dashboard/layout.tsx` — add Roster + Calendar nav items
- `glowos/apps/web/app/dashboard/staff/page.tsx` — add "Create Login" button per staff

---

## Task 1: Schema — `staff_duties` table + `staffId` on `merchant_users`

**Files:**
- Create: `glowos/packages/db/src/schema/staff-duties.ts`
- Modify: `glowos/packages/db/src/schema/merchant-users.ts`
- Modify: `glowos/packages/db/src/schema/index.ts`

- [ ] **Step 1: Create `staff-duties.ts` schema**

Create `glowos/packages/db/src/schema/staff-duties.ts`:

```typescript
import { pgTable, uuid, text, date, time, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { staff } from "./staff";

export const dutyTypeEnum = pgEnum("duty_type", ["floor", "treatment", "break", "other"]);

export const staffDuties = pgTable("staff_duties", {
  id: uuid("id").primaryKey().defaultRandom(),
  staffId: uuid("staff_id")
    .notNull()
    .references(() => staff.id, { onDelete: "cascade" }),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  dutyType: dutyTypeEnum("duty_type").notNull().default("floor"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Add `staffId` to `merchant_users`**

In `glowos/packages/db/src/schema/merchant-users.ts`, add after `createdAt`:

```typescript
import { staff } from "./staff";

// Add to the pgTable columns:
  staffId: uuid("staff_id").references(() => staff.id, { onDelete: "set null" }),
```

Full updated file:

```typescript
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { staff } from "./staff";

export const merchantUsers = pgTable("merchant_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  staffId: uuid("staff_id").references(() => staff.id, { onDelete: "set null" }),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  phone: varchar("phone", { length: 20 }),
  passwordHash: text("password_hash").notNull(),
  role: varchar("role", { length: 20 })
    .notNull()
    .$type<"owner" | "manager" | "staff">(),
  photoUrl: text("photo_url"),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Export from index**

In `glowos/packages/db/src/schema/index.ts`, add:

```typescript
export * from "./staff-duties.js";
```

- [ ] **Step 4: Generate and push migration**

```bash
cd glowos/packages/db
npx drizzle-kit generate
npx drizzle-kit push
```

Expected: new migration file created, `staff_duties` table and `duty_type` enum appear in Neon, `staff_id` column added to `merchant_users`.

- [ ] **Step 5: Commit**

```bash
git add glowos/packages/db/src/schema/staff-duties.ts glowos/packages/db/src/schema/merchant-users.ts glowos/packages/db/src/schema/index.ts glowos/packages/db/src/migrations/
git commit -m "feat: add staff_duties table and staffId to merchant_users"
```

---

## Task 2: JWT + Auth Middleware — Staff Role with `staffId` Claim

**Files:**
- Modify: `glowos/services/api/src/lib/jwt.ts`
- Modify: `glowos/services/api/src/lib/types.ts`
- Modify: `glowos/services/api/src/middleware/auth.ts`

- [ ] **Step 1: Add `staffId` to `AccessTokenPayload`**

In `glowos/services/api/src/lib/jwt.ts`, update `AccessTokenPayload`:

```typescript
export interface AccessTokenPayload {
  userId: string;
  merchantId: string;
  role: string;
  staffId?: string;  // set when role === 'staff'
}
```

- [ ] **Step 2: Add `staffId` to `AppVariables`**

In `glowos/services/api/src/lib/types.ts`:

```typescript
export type AppVariables = {
  userId: string;
  merchantId?: string;
  userRole: string;
  groupId?: string;
  staffId?: string;  // set for staff role tokens
  body: unknown;
};
```

- [ ] **Step 3: Set `staffId` in `requireMerchant` middleware**

In `glowos/services/api/src/middleware/auth.ts`, update the select and set call:

```typescript
import type { Context, Next } from "hono";
import { eq } from "drizzle-orm";
import { db } from "@glowos/db";
import { merchantUsers } from "@glowos/db";
import { verifyAccessToken } from "../lib/jwt.js";
import type { AppVariables } from "../lib/types.js";

type AppContext = Context<{ Variables: AppVariables }>;

export async function requireMerchant(c: AppContext, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized", message: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);

  let payload: { userId: string; merchantId: string; role: string; staffId?: string };
  try {
    payload = verifyAccessToken(token);
  } catch {
    return c.json({ error: "Unauthorized", message: "Invalid or expired token" }, 401);
  }

  const [user] = await db
    .select({
      id: merchantUsers.id,
      isActive: merchantUsers.isActive,
      merchantId: merchantUsers.merchantId,
      role: merchantUsers.role,
      staffId: merchantUsers.staffId,
    })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, payload.userId))
    .limit(1);

  if (!user || !user.isActive) {
    return c.json({ error: "Unauthorized", message: "User account is inactive or not found" }, 401);
  }

  c.set("userId", user.id);
  c.set("merchantId", user.merchantId);
  c.set("userRole", user.role);
  if (user.staffId) c.set("staffId", user.staffId);

  await next();
}

export function requireRole(...roles: string[]) {
  return async function (c: AppContext, next: Next) {
    const userRole = c.get("userRole");
    if (!userRole || !roles.includes(userRole)) {
      return c.json(
        { error: "Forbidden", message: `This action requires one of the following roles: ${roles.join(", ")}` },
        403
      );
    }
    await next();
  };
}

// New: blocks staff role, allows owner + manager only
export function requireAdmin(c: AppContext, next: Next) {
  const userRole = c.get("userRole");
  if (!userRole || !["owner", "manager"].includes(userRole)) {
    return c.json({ error: "Forbidden", message: "Admin access required" }, 403);
  }
  return next();
}

export const PERMISSIONS: Record<string, string[]> = {
  owner: ["*"],
  manager: ["bookings.*", "clients.read", "clients.notes", "analytics.read"],
  staff: [
    "bookings.read_own",
    "bookings.checkin",
    "bookings.complete",
    "bookings.noshow",
    "bookings.create_walkin",
  ],
};

function hasPermission(role: string, permission: string): boolean {
  const perms = PERMISSIONS[role];
  if (!perms) return false;
  for (const p of perms) {
    if (p === "*") return true;
    if (p === permission) return true;
    if (p.endsWith(".*")) {
      const prefix = p.slice(0, -2);
      if (permission === prefix || permission.startsWith(`${prefix}.`)) return true;
    }
  }
  return false;
}

export function requirePermission(permission: string) {
  return async function (c: AppContext, next: Next) {
    const userRole = c.get("userRole");
    if (!userRole || !hasPermission(userRole, permission)) {
      return c.json({ error: "Forbidden", message: `You do not have the required permission: ${permission}` }, 403);
    }
    await next();
  };
}
```

- [ ] **Step 4: Set `staffId` in login response**

In `glowos/services/api/src/routes/auth.ts`, find the `POST /auth/login` handler. After fetching the user, update the token generation to include `staffId`:

Find this section (around line 100-130 in auth.ts):
```typescript
const accessToken = generateAccessToken({
  userId: user.id,
  merchantId: user.merchantId,
  role: user.role,
});
```

Replace with:
```typescript
const accessToken = generateAccessToken({
  userId: user.id,
  merchantId: user.merchantId,
  role: user.role,
  ...(user.staffId ? { staffId: user.staffId } : {}),
});
```

Also update the DB select in the login handler to include `staffId`:
```typescript
const [user] = await db
  .select({
    id: merchantUsers.id,
    merchantId: merchantUsers.merchantId,
    name: merchantUsers.name,
    email: merchantUsers.email,
    role: merchantUsers.role,
    passwordHash: merchantUsers.passwordHash,
    isActive: merchantUsers.isActive,
    staffId: merchantUsers.staffId,  // add this
  })
  .from(merchantUsers)
  .where(eq(merchantUsers.email, body.email))
  .limit(1);
```

Also update the login response to include `staffId` and return `userType: 'staff'` for staff role:
```typescript
// After password check and before return:
if (user.role === 'staff') {
  return c.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    userType: 'staff',
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    merchant: { id: merchant.id, name: merchant.name, slug: merchant.slug },
  });
}
```

- [ ] **Step 5: Verify typecheck passes**

```bash
cd glowos && pnpm turbo typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add glowos/services/api/src/lib/jwt.ts glowos/services/api/src/lib/types.ts glowos/services/api/src/middleware/auth.ts glowos/services/api/src/routes/auth.ts
git commit -m "feat: add staffId to JWT payload and requireAdmin middleware"
```

---

## Task 3: Duties API — CRUD for Duty Blocks

**Files:**
- Create: `glowos/services/api/src/routes/duties.ts`
- Modify: `glowos/services/api/src/index.ts`

- [ ] **Step 1: Create duties router**

Create `glowos/services/api/src/routes/duties.ts`:

```typescript
import { Hono } from "hono";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, staffDuties, staff } from "@glowos/db";
import { requireMerchant, requireAdmin } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import type { AppVariables } from "../lib/types.js";

const dutiesRouter = new Hono<{ Variables: AppVariables }>();

dutiesRouter.use("*", requireMerchant);

const createDutySchema = z.object({
  staff_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM"),
  end_time: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM"),
  duty_type: z.enum(["floor", "treatment", "break", "other"]),
  notes: z.string().optional(),
});

const updateDutySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  duty_type: z.enum(["floor", "treatment", "break", "other"]).optional(),
  notes: z.string().optional(),
});

// GET /merchant/duties?from=YYYY-MM-DD&to=YYYY-MM-DD&staff_id=uuid
dutiesRouter.get("/", async (c) => {
  const merchantId = c.get("merchantId")!;
  const userRole = c.get("userRole");
  const contextStaffId = c.get("staffId");
  const fromStr = c.req.query("from");
  const toStr = c.req.query("to");
  const filterStaffId = c.req.query("staff_id");

  if (!fromStr || !toStr) {
    return c.json({ error: "Bad Request", message: "from and to query params required (YYYY-MM-DD)" }, 400);
  }

  const conditions = [
    eq(staffDuties.merchantId, merchantId),
    gte(staffDuties.date, fromStr),
    lte(staffDuties.date, toStr),
  ];

  // Staff can only see their own duties
  if (userRole === "staff" && contextStaffId) {
    conditions.push(eq(staffDuties.staffId, contextStaffId));
  } else if (filterStaffId) {
    conditions.push(eq(staffDuties.staffId, filterStaffId));
  }

  const duties = await db
    .select()
    .from(staffDuties)
    .where(and(...conditions));

  return c.json({ duties });
});

// POST /merchant/duties — admin only
dutiesRouter.post("/", requireAdmin, zValidator(createDutySchema), async (c) => {
  const merchantId = c.get("merchantId")!;
  const body = c.get("body") as z.infer<typeof createDutySchema>;

  // Verify staff belongs to this merchant
  const [staffMember] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.id, body.staff_id), eq(staff.merchantId, merchantId)))
    .limit(1);

  if (!staffMember) {
    return c.json({ error: "Not Found", message: "Staff member not found" }, 404);
  }

  const [duty] = await db
    .insert(staffDuties)
    .values({
      staffId: body.staff_id,
      merchantId,
      date: body.date,
      startTime: body.start_time,
      endTime: body.end_time,
      dutyType: body.duty_type,
      notes: body.notes ?? null,
    })
    .returning();

  return c.json({ duty }, 201);
});

// PATCH /merchant/duties/:id — admin or own staff
dutiesRouter.patch("/:id", zValidator(updateDutySchema), async (c) => {
  const merchantId = c.get("merchantId")!;
  const userRole = c.get("userRole");
  const contextStaffId = c.get("staffId");
  const dutyId = c.req.param("id");
  const body = c.get("body") as z.infer<typeof updateDutySchema>;

  const [existing] = await db
    .select()
    .from(staffDuties)
    .where(and(eq(staffDuties.id, dutyId), eq(staffDuties.merchantId, merchantId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "Not Found", message: "Duty block not found" }, 404);
  }

  // Staff can only edit their own duty blocks
  if (userRole === "staff" && contextStaffId && existing.staffId !== contextStaffId) {
    return c.json({ error: "Forbidden", message: "You can only edit your own duty blocks" }, 403);
  }

  const updates: Partial<typeof existing> = {};
  if (body.date !== undefined) updates.date = body.date;
  if (body.start_time !== undefined) updates.startTime = body.start_time;
  if (body.end_time !== undefined) updates.endTime = body.end_time;
  if (body.duty_type !== undefined) updates.dutyType = body.duty_type;
  if (body.notes !== undefined) updates.notes = body.notes;
  updates.updatedAt = new Date();

  const [updated] = await db
    .update(staffDuties)
    .set(updates)
    .where(eq(staffDuties.id, dutyId))
    .returning();

  return c.json({ duty: updated });
});

// DELETE /merchant/duties/:id — admin only
dutiesRouter.delete("/:id", requireAdmin, async (c) => {
  const merchantId = c.get("merchantId")!;
  const dutyId = c.req.param("id");

  const [existing] = await db
    .select({ id: staffDuties.id })
    .from(staffDuties)
    .where(and(eq(staffDuties.id, dutyId), eq(staffDuties.merchantId, merchantId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "Not Found", message: "Duty block not found" }, 404);
  }

  await db.delete(staffDuties).where(eq(staffDuties.id, dutyId));

  return c.json({ success: true });
});

export { dutiesRouter };
```

- [ ] **Step 2: Mount duties router in index.ts**

In `glowos/services/api/src/index.ts`, add:

```typescript
import { dutiesRouter } from "./routes/duties.js";
// ...
app.route("/merchant/duties", dutiesRouter);
```

- [ ] **Step 3: Verify typecheck**

```bash
cd glowos && pnpm turbo typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Smoke test**

```bash
# Start API locally
cd glowos/services/api && npx tsx src/index.ts
# In another terminal, test (replace TOKEN with a valid admin token):
curl -X GET "http://localhost:3001/merchant/duties?from=2026-04-01&to=2026-04-30" \
  -H "Authorization: Bearer TOKEN"
# Expected: { "duties": [] }
```

- [ ] **Step 5: Commit**

```bash
git add glowos/services/api/src/routes/duties.ts glowos/services/api/src/index.ts
git commit -m "feat: add duties CRUD API (staff duty blocks)"
```

---

## Task 4: Staff Login Management API

**Files:**
- Create: `glowos/services/api/src/routes/staff-auth.ts`
- Modify: `glowos/services/api/src/index.ts`

- [ ] **Step 1: Create staff-auth router**

Create `glowos/services/api/src/routes/staff-auth.ts`:

```typescript
import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db, merchantUsers, staff } from "@glowos/db";
import { requireMerchant, requireAdmin } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import type { AppVariables } from "../lib/types.js";

const staffAuthRouter = new Hono<{ Variables: AppVariables }>();

staffAuthRouter.use("*", requireMerchant);
staffAuthRouter.use("*", requireAdmin);

const createLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// POST /merchant/staff/:id/create-login
staffAuthRouter.post("/:id/create-login", zValidator(createLoginSchema), async (c) => {
  const merchantId = c.get("merchantId")!;
  const staffId = c.req.param("id");
  const body = c.get("body") as z.infer<typeof createLoginSchema>;

  // Verify staff belongs to merchant
  const [staffMember] = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(and(eq(staff.id, staffId), eq(staff.merchantId, merchantId)))
    .limit(1);

  if (!staffMember) {
    return c.json({ error: "Not Found", message: "Staff member not found" }, 404);
  }

  // Check login doesn't already exist
  const [existing] = await db
    .select({ id: merchantUsers.id })
    .from(merchantUsers)
    .where(eq(merchantUsers.staffId, staffId))
    .limit(1);

  if (existing) {
    return c.json({ error: "Conflict", message: "This staff member already has a login" }, 409);
  }

  // Check email not taken
  const [emailTaken] = await db
    .select({ id: merchantUsers.id })
    .from(merchantUsers)
    .where(eq(merchantUsers.email, body.email))
    .limit(1);

  if (emailTaken) {
    return c.json({ error: "Conflict", message: "An account with this email already exists" }, 409);
  }

  const passwordHash = await bcrypt.hash(body.password, 10);

  const [user] = await db
    .insert(merchantUsers)
    .values({
      merchantId,
      staffId,
      name: staffMember.name,
      email: body.email,
      passwordHash,
      role: "staff",
      isActive: true,
    })
    .returning({ id: merchantUsers.id, email: merchantUsers.email });

  return c.json({ user }, 201);
});

// POST /merchant/staff/:id/reset-password
staffAuthRouter.post("/:id/reset-password", zValidator(resetPasswordSchema), async (c) => {
  const merchantId = c.get("merchantId")!;
  const staffId = c.req.param("id");
  const body = c.get("body") as z.infer<typeof resetPasswordSchema>;

  const [user] = await db
    .select({ id: merchantUsers.id })
    .from(merchantUsers)
    .where(and(eq(merchantUsers.staffId, staffId), eq(merchantUsers.merchantId, merchantId)))
    .limit(1);

  if (!user) {
    return c.json({ error: "Not Found", message: "No login found for this staff member" }, 404);
  }

  const passwordHash = await bcrypt.hash(body.password, 10);

  await db
    .update(merchantUsers)
    .set({ passwordHash })
    .where(eq(merchantUsers.id, user.id));

  return c.json({ success: true });
});

export { staffAuthRouter };
```

- [ ] **Step 2: Mount in index.ts**

In `glowos/services/api/src/index.ts`, add:

```typescript
import { staffAuthRouter } from "./routes/staff-auth.js";
// ...
app.route("/merchant/staff", staffAuthRouter);
```

Note: this mounts alongside the existing `staffRouter` at `/merchant/staff`. The new routes are `/:id/create-login` and `/:id/reset-password` which don't conflict with existing staff routes.

- [ ] **Step 3: Typecheck**

```bash
cd glowos && pnpm turbo typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add glowos/services/api/src/routes/staff-auth.ts glowos/services/api/src/index.ts
git commit -m "feat: add staff login management API (create/reset login)"
```

---

## Task 5: Staff Portal API Routes

**Files:**
- Create: `glowos/services/api/src/routes/staff-portal.ts`
- Modify: `glowos/services/api/src/index.ts`

- [ ] **Step 1: Create staff-portal router**

Create `glowos/services/api/src/routes/staff-portal.ts`:

```typescript
import { Hono } from "hono";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db, staff, merchants, bookings, services, clients, merchantUsers } from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import type { AppVariables } from "../lib/types.js";

const staffPortalRouter = new Hono<{ Variables: AppVariables }>();

staffPortalRouter.use("*", requireMerchant);

// GET /staff/me — own profile + merchant info
staffPortalRouter.get("/me", async (c) => {
  const merchantId = c.get("merchantId")!;
  const staffId = c.get("staffId");

  if (!staffId) {
    return c.json({ error: "Forbidden", message: "Staff access required" }, 403);
  }

  const [staffMember] = await db
    .select({
      id: staff.id,
      name: staff.name,
      title: staff.title,
      photoUrl: staff.photoUrl,
      bio: staff.bio,
    })
    .from(staff)
    .where(and(eq(staff.id, staffId), eq(staff.merchantId, merchantId)))
    .limit(1);

  const [merchant] = await db
    .select({ id: merchants.id, name: merchants.name, slug: merchants.slug })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  return c.json({ staff: staffMember, merchant });
});

// GET /staff/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD — all merchant bookings (read-only)
staffPortalRouter.get("/bookings", async (c) => {
  const merchantId = c.get("merchantId")!;
  const fromStr = c.req.query("from");
  const toStr = c.req.query("to");
  const filterStaffId = c.req.query("staff_id");

  if (!fromStr || !toStr) {
    return c.json({ error: "Bad Request", message: "from and to query params required (YYYY-MM-DD)" }, 400);
  }

  const from = new Date(fromStr);
  const to = new Date(toStr + "T23:59:59");

  const conditions = [
    eq(bookings.merchantId, merchantId),
    gte(bookings.startTime, from),
    lte(bookings.startTime, to),
  ];

  if (filterStaffId) {
    conditions.push(eq(bookings.staffId, filterStaffId));
  }

  const rows = await db
    .select({
      id: bookings.id,
      staffId: bookings.staffId,
      startTime: bookings.startTime,
      endTime: bookings.endTime,
      status: bookings.status,
      priceSgd: bookings.priceSgd,
      clientName: clients.name,
      serviceName: services.name,
      staffName: staff.name,
    })
    .from(bookings)
    .leftJoin(clients, eq(bookings.clientId, clients.id))
    .leftJoin(services, eq(bookings.serviceId, services.id))
    .leftJoin(staff, eq(bookings.staffId, staff.id))
    .where(and(...conditions))
    .orderBy(bookings.startTime);

  return c.json({ bookings: rows });
});

// GET /staff/my-bookings — bookings assigned to this staff member
staffPortalRouter.get("/my-bookings", async (c) => {
  const merchantId = c.get("merchantId")!;
  const staffId = c.get("staffId");

  if (!staffId) {
    return c.json({ error: "Forbidden", message: "Staff access required" }, 403);
  }

  const rows = await db
    .select({
      id: bookings.id,
      startTime: bookings.startTime,
      endTime: bookings.endTime,
      status: bookings.status,
      priceSgd: bookings.priceSgd,
      clientName: clients.name,
      clientPhone: clients.phone,
      serviceName: services.name,
    })
    .from(bookings)
    .leftJoin(clients, eq(bookings.clientId, clients.id))
    .leftJoin(services, eq(bookings.serviceId, services.id))
    .where(and(
      eq(bookings.merchantId, merchantId),
      eq(bookings.staffId, staffId),
      gte(bookings.startTime, new Date()),
    ))
    .orderBy(bookings.startTime)
    .limit(50);

  return c.json({ bookings: rows });
});

export { staffPortalRouter };
```

- [ ] **Step 2: Mount in index.ts**

In `glowos/services/api/src/index.ts`, add:

```typescript
import { staffPortalRouter } from "./routes/staff-portal.js";
// ...
app.route("/staff", staffPortalRouter);
```

- [ ] **Step 3: Typecheck**

```bash
cd glowos && pnpm turbo typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add glowos/services/api/src/routes/staff-portal.ts glowos/services/api/src/index.ts
git commit -m "feat: add staff portal API routes (me, bookings, my-bookings)"
```

---

## Task 6: Install FullCalendar

**Files:**
- Modify: `glowos/apps/web/package.json` (via pnpm)

- [ ] **Step 1: Install FullCalendar packages**

```bash
cd glowos && pnpm add @fullcalendar/react @fullcalendar/daygrid @fullcalendar/timegrid @fullcalendar/interaction --filter web
```

Expected: packages added to `apps/web/package.json`.

- [ ] **Step 2: Verify install**

```bash
cd glowos/apps/web && node -e "require('@fullcalendar/react')" 2>/dev/null && echo "OK" || echo "FAIL"
```

Expected: OK (or no error when building).

- [ ] **Step 3: Commit**

```bash
git add glowos/apps/web/package.json glowos/pnpm-lock.yaml
git commit -m "chore: install FullCalendar packages for staff calendar UI"
```

---

## Task 7: Admin Roster Page

**Files:**
- Create: `glowos/apps/web/app/dashboard/roster/page.tsx`
- Modify: `glowos/apps/web/app/dashboard/layout.tsx`

- [ ] **Step 1: Create roster page**

Create `glowos/apps/web/app/dashboard/roster/page.tsx`:

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventInput, EventClickArg, EventDropArg, EventResizeDoneArg } from '@fullcalendar/core';
import { apiFetch } from '../../lib/api';

interface StaffMember {
  id: string;
  name: string;
}

interface DutyBlock {
  id: string;
  staffId: string;
  date: string;
  startTime: string;
  endTime: string;
  dutyType: 'floor' | 'treatment' | 'break' | 'other';
  notes: string | null;
}

interface Booking {
  id: string;
  staffId: string;
  startTime: string;
  endTime: string;
  clientName: string | null;
  serviceName: string | null;
}

const DUTY_COLORS: Record<string, string> = {
  floor: '#4f46e5',
  treatment: '#7c3aed',
  break: '#9ca3af',
  other: '#d97706',
};

const STAFF_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function RosterPage() {
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [events, setEvents] = useState<EventInput[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editDuty, setEditDuty] = useState<DutyBlock | null>(null);
  const [form, setForm] = useState({ staffId: '', date: '', startTime: '09:00', endTime: '17:00', dutyType: 'floor' as DutyBlock['dutyType'], notes: '' });
  const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);

  useEffect(() => {
    apiFetch('/merchant/staff').then((data: { staff: StaffMember[] }) => setStaffList(data.staff ?? []));
  }, []);

  const loadEvents = useCallback(async (start: string, end: string) => {
    const from = start.slice(0, 10);
    const to = end.slice(0, 10);

    const [dutiesData, bookingsData] = await Promise.all([
      apiFetch(`/merchant/duties?from=${from}&to=${to}`),
      apiFetch(`/merchant/bookings?from=${from}&to=${to}`).catch(() => ({ bookings: [] })),
    ]);

    const dutyEvents: EventInput[] = (dutiesData.duties ?? []).map((d: DutyBlock) => ({
      id: `duty-${d.id}`,
      title: `${d.dutyType.charAt(0).toUpperCase() + d.dutyType.slice(1)}${d.notes ? ` — ${d.notes}` : ''}`,
      start: `${d.date}T${d.startTime}`,
      end: `${d.date}T${d.endTime}`,
      backgroundColor: DUTY_COLORS[d.dutyType],
      borderColor: DUTY_COLORS[d.dutyType],
      extendedProps: { type: 'duty', duty: d },
      editable: true,
    }));

    const bookingEvents: EventInput[] = (bookingsData.bookings ?? []).map((b: Booking, i: number) => {
      const staffIdx = staffList.findIndex(s => s.id === b.staffId);
      const color = STAFF_COLORS[staffIdx % STAFF_COLORS.length] ?? '#64748b';
      return {
        id: `booking-${b.id}`,
        title: `📅 ${b.clientName ?? 'Client'} — ${b.serviceName ?? 'Service'}`,
        start: b.startTime,
        end: b.endTime,
        backgroundColor: color,
        borderColor: color,
        extendedProps: { type: 'booking' },
        editable: false,
      };
    });

    setEvents([...dutyEvents, ...bookingEvents]);
  }, [staffList]);

  async function handleEventDrop(info: EventDropArg) {
    if (info.event.extendedProps.type !== 'duty') { info.revert(); return; }
    const dutyId = info.event.id.replace('duty-', '');
    const start = info.event.start!;
    const end = info.event.end!;
    const date = start.toISOString().slice(0, 10);
    const startTime = start.toTimeString().slice(0, 5);
    const endTime = end.toTimeString().slice(0, 5);
    try {
      await apiFetch(`/merchant/duties/${dutyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ date, start_time: startTime, end_time: endTime }),
      });
    } catch {
      info.revert();
    }
  }

  async function handleEventResize(info: EventResizeDoneArg) {
    if (info.event.extendedProps.type !== 'duty') { info.revert(); return; }
    const dutyId = info.event.id.replace('duty-', '');
    const end = info.event.end!;
    const endTime = end.toTimeString().slice(0, 5);
    try {
      await apiFetch(`/merchant/duties/${dutyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ end_time: endTime }),
      });
    } catch {
      info.revert();
    }
  }

  function handleEventClick(info: EventClickArg) {
    if (info.event.extendedProps.type !== 'duty') return;
    const duty = info.event.extendedProps.duty as DutyBlock;
    setEditDuty(duty);
    setForm({
      staffId: duty.staffId,
      date: duty.date,
      startTime: duty.startTime,
      endTime: duty.endTime,
      dutyType: duty.dutyType,
      notes: duty.notes ?? '',
    });
    setShowModal(true);
  }

  function handleDateClick(info: { dateStr: string }) {
    setEditDuty(null);
    setForm({ staffId: staffList[0]?.id ?? '', date: info.dateStr.slice(0, 10), startTime: '09:00', endTime: '17:00', dutyType: 'floor', notes: '' });
    setShowModal(true);
  }

  async function handleSave() {
    if (editDuty) {
      await apiFetch(`/merchant/duties/${editDuty.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ date: form.date, start_time: form.startTime, end_time: form.endTime, duty_type: form.dutyType, notes: form.notes }),
      });
    } else {
      await apiFetch('/merchant/duties', {
        method: 'POST',
        body: JSON.stringify({ staff_id: form.staffId, date: form.date, start_time: form.startTime, end_time: form.endTime, duty_type: form.dutyType, notes: form.notes }),
      });
    }
    setShowModal(false);
    if (dateRange) loadEvents(dateRange.start, dateRange.end);
  }

  async function handleDelete() {
    if (!editDuty) return;
    await apiFetch(`/merchant/duties/${editDuty.id}`, { method: 'DELETE' });
    setShowModal(false);
    if (dateRange) loadEvents(dateRange.start, dateRange.end);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Staff Roster</h1>
        <button
          onClick={() => { setEditDuty(null); setForm({ staffId: staffList[0]?.id ?? '', date: new Date().toISOString().slice(0, 10), startTime: '09:00', endTime: '17:00', dutyType: 'floor', notes: '' }); setShowModal(true); }}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + Add Duty Block
        </button>
      </div>

      <div className="flex gap-3 text-xs">
        {Object.entries(DUTY_COLORS).map(([type, color]) => (
          <span key={type} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: color }} />
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </span>
        ))}
        <span className="flex items-center gap-1 ml-2 text-gray-400">📅 = booking (read-only)</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <FullCalendar
          plugins={[timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'timeGridWeek,timeGridDay' }}
          events={events}
          editable={true}
          selectable={true}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          datesSet={(info) => {
            setDateRange({ start: info.startStr, end: info.endStr });
            loadEvents(info.startStr, info.endStr);
          }}
          height="auto"
          slotMinTime="07:00:00"
          slotMaxTime="22:00:00"
        />
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-semibold">{editDuty ? 'Edit Duty Block' : 'Add Duty Block'}</h2>

            {!editDuty && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Staff Member</label>
                <select value={form.staffId} onChange={e => setForm(f => ({ ...f, staffId: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Start Time</label>
                <input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">End Time</label>
                <input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Duty Type</label>
              <select value={form.dutyType} onChange={e => setForm(f => ({ ...f, dutyType: e.target.value as DutyBlock['dutyType'] }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="floor">Floor</option>
                <option value="treatment">Treatment</option>
                <option value="break">Break</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
              <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Front desk coverage" />
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={handleSave} className="flex-1 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700">Save</button>
              {editDuty && <button onClick={handleDelete} className="py-2 px-4 bg-red-50 text-red-600 text-sm font-semibold rounded-lg hover:bg-red-100">Delete</button>}
              <button onClick={() => setShowModal(false)} className="py-2 px-4 bg-gray-100 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-200">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add Roster + Calendar nav items to dashboard layout**

In `glowos/apps/web/app/dashboard/layout.tsx`, find `NAV_ITEMS` and add after the Staff item:

```typescript
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: CalendarIcon },
  { href: '/dashboard/analytics', label: 'Analytics', icon: ChartBarIcon },
  { href: '/dashboard/services', label: 'Services', icon: ScissorsIcon },
  { href: '/dashboard/staff', label: 'Staff', icon: UsersIcon },
  { href: '/dashboard/roster', label: 'Roster', icon: RosterIcon },
  { href: '/dashboard/calendar', label: 'Calendar', icon: CalendarGridIcon },
  { href: '/dashboard/clients', label: 'Clients', icon: HeartIcon },
  { href: '/dashboard/import', label: 'Import Clients', icon: ImportIcon },
  { href: '/dashboard/walkins', label: 'Walk-ins', icon: WalkInIcon },
  { href: '/dashboard/campaigns', label: 'Campaigns', icon: MegaphoneIcon },
];
```

Add these two icon components to the layout file (after the existing icon functions):

```typescript
function RosterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
    </svg>
  );
}

function CalendarGridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z" />
    </svg>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
cd glowos && pnpm turbo typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add glowos/apps/web/app/dashboard/roster/ glowos/apps/web/app/dashboard/layout.tsx
git commit -m "feat: add admin roster page with FullCalendar drag-and-drop"
```

---

## Task 8: Admin Unified Bookings Calendar

**Files:**
- Create: `glowos/apps/web/app/dashboard/calendar/page.tsx`

- [ ] **Step 1: Create calendar page**

Create `glowos/apps/web/app/dashboard/calendar/page.tsx`:

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import type { EventInput, EventClickArg } from '@fullcalendar/core';
import { apiFetch } from '../../lib/api';

interface Booking {
  id: string;
  staffId: string | null;
  startTime: string;
  endTime: string;
  status: string;
  clientName: string | null;
  serviceName: string | null;
  staffName: string | null;
}

interface StaffMember {
  id: string;
  name: string;
}

const STAFF_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show',
  in_progress: 'In Progress',
};

export default function CalendarPage() {
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [events, setEvents] = useState<EventInput[]>([]);
  const [filterStaffId, setFilterStaffId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [selected, setSelected] = useState<Booking | null>(null);
  const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);

  useEffect(() => {
    apiFetch('/merchant/staff').then((data: { staff: StaffMember[] }) => setStaffList(data.staff ?? []));
  }, []);

  const loadBookings = useCallback(async (start: string, end: string) => {
    const from = start.slice(0, 10);
    const to = end.slice(0, 10);
    let url = `/merchant/bookings?from=${from}&to=${to}`;
    if (filterStaffId) url += `&staff_id=${filterStaffId}`;
    if (filterStatus) url += `&status=${filterStatus}`;

    const data = await apiFetch(url).catch(() => ({ bookings: [] }));
    const bookings: Booking[] = data.bookings ?? [];

    const staffColorMap: Record<string, string> = {};
    staffList.forEach((s, i) => { staffColorMap[s.id] = STAFF_COLORS[i % STAFF_COLORS.length]; });

    setEvents(bookings.map(b => ({
      id: b.id,
      title: `${b.clientName ?? 'Client'} — ${b.serviceName ?? 'Service'}`,
      start: b.startTime,
      end: b.endTime,
      backgroundColor: b.staffId ? (staffColorMap[b.staffId] ?? '#64748b') : '#64748b',
      borderColor: 'transparent',
      extendedProps: { booking: b },
      editable: false,
    })));
  }, [filterStaffId, filterStatus, staffList]);

  useEffect(() => {
    if (dateRange) loadBookings(dateRange.start, dateRange.end);
  }, [filterStaffId, filterStatus, dateRange, loadBookings]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">All Bookings</h1>
      </div>

      <div className="flex gap-3 flex-wrap">
        <select value={filterStaffId} onChange={e => setFilterStaffId(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
          <option value="">All Staff</option>
          {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
          <option value="">All Statuses</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div className="flex gap-2 flex-wrap text-xs">
        {staffList.slice(0, 7).map((s, i) => (
          <span key={s.id} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: STAFF_COLORS[i % STAFF_COLORS.length] }} />
            {s.name}
          </span>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <FullCalendar
          plugins={[timeGridPlugin, dayGridPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
          events={events}
          editable={false}
          eventClick={(info: EventClickArg) => setSelected(info.event.extendedProps.booking as Booking)}
          datesSet={(info) => {
            setDateRange({ start: info.startStr, end: info.endStr });
            loadBookings(info.startStr, info.endStr);
          }}
          height="auto"
          slotMinTime="07:00:00"
          slotMaxTime="22:00:00"
        />
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-3">
            <h2 className="text-lg font-semibold">Booking Details</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Client</span><span className="font-medium">{selected.clientName ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Service</span><span className="font-medium">{selected.serviceName ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Staff</span><span className="font-medium">{selected.staffName ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Status</span><span className="font-medium">{STATUS_LABELS[selected.status] ?? selected.status}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Start</span><span className="font-medium">{new Date(selected.startTime).toLocaleString()}</span></div>
            </div>
            <button onClick={() => setSelected(null)} className="w-full py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-200">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd glowos && pnpm turbo typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add glowos/apps/web/app/dashboard/calendar/
git commit -m "feat: add admin unified bookings calendar page"
```

---

## Task 9: Staff Login Management UI

**Files:**
- Modify: `glowos/apps/web/app/dashboard/staff/page.tsx`

- [ ] **Step 1: Add staff login state and fetch to the staff page**

In `glowos/apps/web/app/dashboard/staff/page.tsx`, add a `staffLogins` state that maps `staffId → email`:

After the existing `staffList` state, add:

```typescript
const [staffLogins, setStaffLogins] = useState<Record<string, string>>({});
const [loginModal, setLoginModal] = useState<{ staffId: string; name: string } | null>(null);
const [loginForm, setLoginForm] = useState({ email: '', password: '' });
const [loginError, setLoginError] = useState('');
```

Add a fetch for staff logins after the staff list loads. In the `useEffect` that fetches staff, after `setStaffList(data.staff)`, add:

```typescript
// Fetch which staff have logins
apiFetch('/merchant/staff/logins').then((d: { logins: Array<{ staffId: string; email: string }> }) => {
  const map: Record<string, string> = {};
  (d.logins ?? []).forEach(l => { map[l.staffId] = l.email; });
  setStaffLogins(map);
}).catch(() => {});
```

Note: We need to add `GET /merchant/staff/logins` to the API (add to `staff-auth.ts` in Step 2).

- [ ] **Step 2: Add GET /merchant/staff/logins endpoint**

In `glowos/services/api/src/routes/staff-auth.ts`, add before the export:

```typescript
// GET /merchant/staff/logins — list which staff have logins
staffAuthRouter.get("/logins", async (c) => {
  const merchantId = c.get("merchantId")!;
  const logins = await db
    .select({ staffId: merchantUsers.staffId, email: merchantUsers.email })
    .from(merchantUsers)
    .where(and(eq(merchantUsers.merchantId, merchantId), eq(merchantUsers.role, "staff")));
  return c.json({ logins: logins.filter(l => l.staffId !== null) });
});
```

Note: This route is at `GET /merchant/staff/logins` — mount order matters. In `index.ts`, ensure `staffAuthRouter` is mounted at `/merchant/staff` alongside `staffRouter`. Since both mount at the same base path, Hono will check both — the GET `/logins` route in `staffAuthRouter` won't conflict with existing staff routes.

- [ ] **Step 3: Add "Create Login" button to each staff card**

In `glowos/apps/web/app/dashboard/staff/page.tsx`, find where each staff card is rendered. Add after the staff name/title display:

```tsx
{/* Login badge / Create Login button */}
{staffLogins[member.id] ? (
  <div className="flex items-center gap-2 mt-1">
    <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
      Login: {staffLogins[member.id]}
    </span>
    <button
      onClick={() => { setLoginModal({ staffId: member.id, name: member.name }); setLoginForm({ email: staffLogins[member.id], password: '' }); setLoginError(''); }}
      className="text-xs text-gray-500 hover:text-gray-700 underline"
    >
      Reset Password
    </button>
  </div>
) : (
  <button
    onClick={() => { setLoginModal({ staffId: member.id, name: member.name }); setLoginForm({ email: '', password: '' }); setLoginError(''); }}
    className="mt-1 text-xs text-indigo-600 hover:text-indigo-700 underline"
  >
    + Create Login
  </button>
)}
```

- [ ] **Step 4: Add login modal to staff page**

At the bottom of the staff page JSX (before the closing tag), add:

```tsx
{loginModal && (
  <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
    <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
      <h2 className="text-lg font-semibold">
        {staffLogins[loginModal.staffId] ? 'Reset Password' : 'Create Login'} — {loginModal.name}
      </h2>
      {!staffLogins[loginModal.staffId] && (
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            value={loginForm.email}
            onChange={e => setLoginForm(f => ({ ...f, email: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder="staff@example.com"
          />
        </div>
      )}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          {staffLogins[loginModal.staffId] ? 'New Password' : 'Temporary Password'}
        </label>
        <input
          type="password"
          value={loginForm.password}
          onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          placeholder="Minimum 8 characters"
        />
      </div>
      {loginError && <p className="text-xs text-red-600">{loginError}</p>}
      <div className="flex gap-2">
        <button
          onClick={async () => {
            setLoginError('');
            try {
              if (staffLogins[loginModal.staffId]) {
                await apiFetch(`/merchant/staff/${loginModal.staffId}/reset-password`, {
                  method: 'POST',
                  body: JSON.stringify({ password: loginForm.password }),
                });
              } else {
                await apiFetch(`/merchant/staff/${loginModal.staffId}/create-login`, {
                  method: 'POST',
                  body: JSON.stringify({ email: loginForm.email, password: loginForm.password }),
                });
                setStaffLogins(prev => ({ ...prev, [loginModal.staffId]: loginForm.email }));
              }
              setLoginModal(null);
            } catch (err) {
              setLoginError(err instanceof Error ? err.message : 'Failed');
            }
          }}
          className="flex-1 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700"
        >
          Save
        </button>
        <button onClick={() => setLoginModal(null)} className="py-2 px-4 bg-gray-100 text-gray-700 text-sm font-semibold rounded-lg">Cancel</button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 5: Typecheck**

```bash
cd glowos && pnpm turbo typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add glowos/apps/web/app/dashboard/staff/page.tsx glowos/services/api/src/routes/staff-auth.ts
git commit -m "feat: add staff login management UI (create login, reset password)"
```

---

## Task 10: Staff Dashboard Layout + Login Redirect

**Files:**
- Create: `glowos/apps/web/app/staff/layout.tsx`
- Modify: `glowos/apps/web/app/login/page.tsx`

- [ ] **Step 1: Create staff layout**

Create `glowos/apps/web/app/staff/layout.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';

interface StaffInfo {
  name: string;
  merchantName: string;
}

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [info, setInfo] = useState<StaffInfo | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }
    const user = JSON.parse(localStorage.getItem('user') ?? '{}');
    if (user.role !== 'staff') { router.push('/dashboard'); return; }

    apiFetch('/staff/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((data: { staff: { name: string }; merchant: { name: string } }) => {
        setInfo({ name: data.staff?.name ?? user.name, merchantName: data.merchant?.name ?? '' });
      })
      .catch(() => router.push('/login'));
  }, [router]);

  function handleLogout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    localStorage.removeItem('merchant');
    router.push('/login');
  }

  const NAV = [
    { href: '/staff/dashboard', label: 'My Schedule' },
    { href: '/staff/bookings', label: 'All Bookings' },
    { href: '/staff/my-bookings', label: 'My Bookings' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="hidden lg:flex flex-col w-56 bg-white border-r border-gray-200 fixed inset-y-0 left-0 z-30">
        <div className="px-5 py-5 border-b border-gray-100">
          <Link href="/" className="text-xl font-bold text-indigo-600">GlowOS</Link>
          {info && (
            <>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{info.merchantName}</p>
              <p className="text-xs font-medium text-gray-700 mt-0.5 truncate">{info.name}</p>
            </>
          )}
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                pathname === item.href ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-gray-100">
          <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-2.5 w-full rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
            </svg>
            Logout
          </button>
        </div>
      </aside>
      <div className="flex-1 lg:ml-56 p-6">
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update login page to redirect staff to `/staff/dashboard`**

In `glowos/apps/web/app/login/page.tsx`, in `handleSubmit`, after the group_admin branch and before the else (merchant) branch, add:

```typescript
} else if (data.userType === 'staff') {
  localStorage.setItem('access_token', data.access_token);
  localStorage.setItem('refresh_token', data.refresh_token);
  localStorage.setItem('user', JSON.stringify(data.user));
  localStorage.setItem('merchant', JSON.stringify(data.merchant));
  router.push('/staff/dashboard');
} else {
  // existing merchant admin path
```

- [ ] **Step 3: Typecheck**

```bash
cd glowos && pnpm turbo typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add glowos/apps/web/app/staff/layout.tsx glowos/apps/web/app/login/page.tsx
git commit -m "feat: add staff dashboard layout and login redirect for staff role"
```

---

## Task 11: Staff My Schedule Page

**Files:**
- Create: `glowos/apps/web/app/staff/dashboard/page.tsx`

- [ ] **Step 1: Create My Schedule page**

Create `glowos/apps/web/app/staff/dashboard/page.tsx`:

```tsx
'use client';

import { useCallback, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventInput, EventDropArg, EventResizeDoneArg, EventClickArg } from '@fullcalendar/core';
import { apiFetch } from '../../lib/api';

interface DutyBlock {
  id: string;
  staffId: string;
  date: string;
  startTime: string;
  endTime: string;
  dutyType: 'floor' | 'treatment' | 'break' | 'other';
  notes: string | null;
}

interface Booking {
  id: string;
  startTime: string;
  endTime: string;
  clientName: string | null;
  serviceName: string | null;
  status: string;
}

const DUTY_COLORS: Record<string, string> = {
  floor: '#4f46e5',
  treatment: '#7c3aed',
  break: '#9ca3af',
  other: '#d97706',
};

export default function StaffSchedulePage() {
  const [events, setEvents] = useState<EventInput[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editDuty, setEditDuty] = useState<DutyBlock | null>(null);
  const [form, setForm] = useState({ date: '', startTime: '09:00', endTime: '17:00', dutyType: 'floor' as DutyBlock['dutyType'], notes: '' });
  const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);

  const loadEvents = useCallback(async (start: string, end: string) => {
    const from = start.slice(0, 10);
    const to = end.slice(0, 10);

    const [dutiesData, bookingsData] = await Promise.all([
      apiFetch(`/merchant/duties?from=${from}&to=${to}`),
      apiFetch(`/staff/my-bookings`).catch(() => ({ bookings: [] })),
    ]);

    const dutyEvents: EventInput[] = (dutiesData.duties ?? []).map((d: DutyBlock) => ({
      id: `duty-${d.id}`,
      title: `${d.dutyType.charAt(0).toUpperCase() + d.dutyType.slice(1)}${d.notes ? ` — ${d.notes}` : ''}`,
      start: `${d.date}T${d.startTime}`,
      end: `${d.date}T${d.endTime}`,
      backgroundColor: DUTY_COLORS[d.dutyType],
      borderColor: DUTY_COLORS[d.dutyType],
      extendedProps: { type: 'duty', duty: d },
      editable: true,
    }));

    const bookingEvents: EventInput[] = (bookingsData.bookings ?? []).map((b: Booking) => ({
      id: `booking-${b.id}`,
      title: `📅 ${b.clientName ?? 'Client'} — ${b.serviceName ?? ''}`,
      start: b.startTime,
      end: b.endTime,
      backgroundColor: '#0ea5e9',
      borderColor: 'transparent',
      extendedProps: { type: 'booking' },
      editable: false,
    }));

    setEvents([...dutyEvents, ...bookingEvents]);
  }, []);

  async function handleEventDrop(info: EventDropArg) {
    if (info.event.extendedProps.type !== 'duty') { info.revert(); return; }
    const dutyId = info.event.id.replace('duty-', '');
    const start = info.event.start!;
    const end = info.event.end!;
    try {
      await apiFetch(`/merchant/duties/${dutyId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          date: start.toISOString().slice(0, 10),
          start_time: start.toTimeString().slice(0, 5),
          end_time: end.toTimeString().slice(0, 5),
        }),
      });
    } catch { info.revert(); }
  }

  async function handleEventResize(info: EventResizeDoneArg) {
    if (info.event.extendedProps.type !== 'duty') { info.revert(); return; }
    const dutyId = info.event.id.replace('duty-', '');
    try {
      await apiFetch(`/merchant/duties/${dutyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ end_time: info.event.end!.toTimeString().slice(0, 5) }),
      });
    } catch { info.revert(); }
  }

  function handleEventClick(info: EventClickArg) {
    if (info.event.extendedProps.type !== 'duty') return;
    const duty = info.event.extendedProps.duty as DutyBlock;
    setEditDuty(duty);
    setForm({ date: duty.date, startTime: duty.startTime, endTime: duty.endTime, dutyType: duty.dutyType, notes: duty.notes ?? '' });
    setShowModal(true);
  }

  function handleDateClick(info: { dateStr: string }) {
    setEditDuty(null);
    setForm({ date: info.dateStr.slice(0, 10), startTime: '09:00', endTime: '17:00', dutyType: 'floor', notes: '' });
    setShowModal(true);
  }

  async function handleSave() {
    if (editDuty) {
      await apiFetch(`/merchant/duties/${editDuty.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ date: form.date, start_time: form.startTime, end_time: form.endTime, duty_type: form.dutyType, notes: form.notes }),
      });
    } else {
      // Staff creating their own duty block — staffId is derived server-side from token
      await apiFetch('/merchant/duties/my', {
        method: 'POST',
        body: JSON.stringify({ date: form.date, start_time: form.startTime, end_time: form.endTime, duty_type: form.dutyType, notes: form.notes }),
      });
    }
    setShowModal(false);
    if (dateRange) loadEvents(dateRange.start, dateRange.end);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">My Schedule</h1>
        <button
          onClick={() => { setEditDuty(null); setForm({ date: new Date().toISOString().slice(0, 10), startTime: '09:00', endTime: '17:00', dutyType: 'floor', notes: '' }); setShowModal(true); }}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700"
        >
          + Add Block
        </button>
      </div>

      <div className="flex gap-3 text-xs">
        {Object.entries(DUTY_COLORS).map(([type, color]) => (
          <span key={type} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </span>
        ))}
        <span className="text-gray-400 ml-2">📅 = booking</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <FullCalendar
          plugins={[timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'timeGridWeek,timeGridDay' }}
          events={events}
          editable={true}
          selectable={true}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          datesSet={(info) => { setDateRange({ start: info.startStr, end: info.endStr }); loadEvents(info.startStr, info.endStr); }}
          height="auto"
          slotMinTime="07:00:00"
          slotMaxTime="22:00:00"
        />
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-semibold">{editDuty ? 'Edit Block' : 'Add Block'}</h2>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Start</label>
                <input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">End</label>
                <input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
              <select value={form.dutyType} onChange={e => setForm(f => ({ ...f, dutyType: e.target.value as DutyBlock['dutyType'] }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="floor">Floor</option>
                <option value="treatment">Treatment</option>
                <option value="break">Break</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
              <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-2">
              <button onClick={handleSave} className="flex-1 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700">Save</button>
              <button onClick={() => setShowModal(false)} className="py-2 px-4 bg-gray-100 text-gray-700 text-sm font-semibold rounded-lg">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

Note: Staff creating their own duty block uses `POST /merchant/duties/my` — add this endpoint to `duties.ts`:

```typescript
// POST /merchant/duties/my — staff creates their own duty block
dutiesRouter.post("/my", async (c) => {
  const merchantId = c.get("merchantId")!;
  const staffId = c.get("staffId");
  if (!staffId) return c.json({ error: "Forbidden", message: "Staff access required" }, 403);

  const body = c.req.json ? await c.req.json() : {};
  const parsed = createDutySchema.omit({ staff_id: true }).safeParse(body);
  if (!parsed.success) return c.json({ error: "Bad Request", message: parsed.error.issues[0].message }, 400);

  const [duty] = await db
    .insert(staffDuties)
    .values({
      staffId,
      merchantId,
      date: parsed.data.date,
      startTime: parsed.data.start_time,
      endTime: parsed.data.end_time,
      dutyType: parsed.data.duty_type,
      notes: parsed.data.notes ?? null,
    })
    .returning();

  return c.json({ duty }, 201);
});
```

- [ ] **Step 2: Commit**

```bash
git add glowos/apps/web/app/staff/dashboard/ glowos/services/api/src/routes/duties.ts
git commit -m "feat: add staff My Schedule page with drag-and-drop calendar"
```

---

## Task 12: Staff All Bookings + My Bookings Pages

**Files:**
- Create: `glowos/apps/web/app/staff/bookings/page.tsx`
- Create: `glowos/apps/web/app/staff/my-bookings/page.tsx`

- [ ] **Step 1: Create All Bookings page**

Create `glowos/apps/web/app/staff/bookings/page.tsx`:

```tsx
'use client';

import { useCallback, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import type { EventInput, EventClickArg } from '@fullcalendar/core';
import { apiFetch } from '../../lib/api';

interface Booking {
  id: string;
  staffId: string | null;
  startTime: string;
  endTime: string;
  status: string;
  clientName: string | null;
  serviceName: string | null;
  staffName: string | null;
}

const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function StaffAllBookingsPage() {
  const [events, setEvents] = useState<EventInput[]>([]);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [staffColorMap] = useState<Record<string, string>>({});

  const loadBookings = useCallback(async (start: string, end: string) => {
    const from = start.slice(0, 10);
    const to = end.slice(0, 10);
    const data = await apiFetch(`/staff/bookings?from=${from}&to=${to}`).catch(() => ({ bookings: [] }));
    const bookings: Booking[] = data.bookings ?? [];

    let colorIdx = 0;
    setEvents(bookings.map(b => {
      if (b.staffId && !staffColorMap[b.staffId]) {
        staffColorMap[b.staffId] = COLORS[colorIdx++ % COLORS.length];
      }
      return {
        id: b.id,
        title: `${b.clientName ?? 'Client'} — ${b.serviceName ?? ''}`,
        start: b.startTime,
        end: b.endTime,
        backgroundColor: b.staffId ? (staffColorMap[b.staffId] ?? '#64748b') : '#64748b',
        borderColor: 'transparent',
        extendedProps: { booking: b },
        editable: false,
      };
    }));
  }, [staffColorMap]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">All Bookings</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <FullCalendar
          plugins={[timeGridPlugin, dayGridPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
          events={events}
          editable={false}
          eventClick={(info: EventClickArg) => setSelected(info.event.extendedProps.booking as Booking)}
          datesSet={(info) => loadBookings(info.startStr, info.endStr)}
          height="auto"
          slotMinTime="07:00:00"
          slotMaxTime="22:00:00"
        />
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-3">
            <h2 className="text-lg font-semibold">Booking Details</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Client</span><span>{selected.clientName ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Service</span><span>{selected.serviceName ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Staff</span><span>{selected.staffName ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Time</span><span>{new Date(selected.startTime).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Status</span><span className="capitalize">{selected.status}</span></div>
            </div>
            <button onClick={() => setSelected(null)} className="w-full py-2 bg-gray-100 text-sm font-semibold rounded-lg">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create My Bookings page**

Create `glowos/apps/web/app/staff/my-bookings/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

interface Booking {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  clientName: string | null;
  clientPhone: string | null;
  serviceName: string | null;
  priceSgd: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-blue-50 text-blue-700',
  completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-600',
  no_show: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-amber-50 text-amber-700',
};

export default function StaffMyBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/staff/my-bookings')
      .then((data: { bookings: Booking[] }) => setBookings(data.bookings ?? []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">My Bookings</h1>
      {bookings.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-sm">No upcoming bookings assigned to you.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map(b => (
            <div key={b.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{b.clientName ?? 'Unknown Client'}</p>
                  <p className="text-sm text-gray-600">{b.serviceName}</p>
                  {b.clientPhone && <p className="text-xs text-gray-400 mt-0.5">{b.clientPhone}</p>}
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full capitalize ${STATUS_COLORS[b.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {b.status.replace('_', ' ')}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                <span>{new Date(b.startTime).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                <span>{new Date(b.startTime).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })} — {new Date(b.endTime).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })}</span>
                {b.priceSgd && <span>S${parseFloat(b.priceSgd).toFixed(2)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
cd glowos && pnpm turbo typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Final typecheck + build check**

```bash
cd glowos && pnpm turbo typecheck && pnpm turbo build 2>&1 | tail -20
```

Expected: 0 typecheck errors, build completes successfully.

- [ ] **Step 5: Commit**

```bash
git add glowos/apps/web/app/staff/
git commit -m "feat: add staff All Bookings and My Bookings pages"
```

- [ ] **Step 6: Push to production**

```bash
git push origin main
```

Expected: Railway auto-deploys API, Vercel auto-deploys frontend.
