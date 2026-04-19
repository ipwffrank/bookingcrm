# Walk-in Group Booking, Packages & Editable Bookings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-service walk-in modal with a shared `BookingForm` that creates multi-service group bookings with optional package sell/redeem, and supports editing every booking status except `cancelled` — including `completed`, with a per-field audit log.

**Architecture:** Add two additive tables (`booking_groups`, `booking_edits`) plus a nullable `bookings.group_id` column. Existing `package_sessions.booking_id` is reused for package redemptions — no new redemption table. One shared `BookingForm` React modal powers both walk-in creation and booking edits for both grouped and non-grouped bookings.

**Tech Stack:** Drizzle ORM + PostgreSQL, Hono + Zod (API), Next.js 15 App Router (web), date-fns, Tailwind CSS.

**Spec:** [docs/superpowers/specs/2026-04-20-walkin-group-booking-and-edit-design.md](../specs/2026-04-20-walkin-group-booking-and-edit-design.md)

**Project testing convention:** The repo has no automated test framework. Tasks use **typecheck + manual curl + manual UI verification** instead of TDD. Every task ends with `pnpm -w typecheck` (or the package-local equivalent) before commit.

---

## File Map

### New files (backend)

- `glowos/packages/db/src/schema/booking-groups.ts` — Drizzle schema for `booking_groups` and `booking_edits`
- `glowos/services/api/src/routes/booking-groups.ts` — new router: `POST /merchant/bookings/group`, `PATCH /merchant/bookings/group/:groupId`
- `glowos/services/api/src/lib/booking-edits.ts` — audit-log diff helpers (build `booking_edits` rows from old vs. new values)
- `glowos/services/api/src/lib/booking-conflicts.ts` — staff double-booking check

### Modified files (backend)

- `glowos/packages/db/src/schema/bookings.ts` — add `groupId` (nullable uuid)
- `glowos/packages/db/src/schema/index.ts` — re-export the new schema module
- `glowos/services/api/src/routes/bookings.ts` — add `PATCH /merchant/bookings/:id` (single edit), `GET /merchant/bookings/:id/edit-context`, `GET /merchant/bookings/:id/edits`
- `glowos/services/api/src/index.ts` — mount the new booking-groups router

### New files (frontend)

- `glowos/apps/web/app/dashboard/bookings/BookingForm.tsx` — shared create + edit modal (new directory)
- `glowos/apps/web/app/dashboard/bookings/ServiceRow.tsx` — one row of the services list
- `glowos/apps/web/app/dashboard/bookings/EditHistoryPanel.tsx` — inline audit-trail view (edit mode only)
- `glowos/apps/web/app/dashboard/bookings/types.ts` — shared TS types for the form payload

### Modified files (frontend)

- `glowos/apps/web/app/dashboard/page.tsx` — remove inline `WalkInModal`; mount `BookingForm`; add edit button on each `BookingCard`
- `glowos/apps/web/app/dashboard/calendar/page.tsx` — open `BookingForm` in edit mode on slot double-click

---

## Milestones

- **M1 (Tasks 1–4):** Schema + migration.
- **M2 (Tasks 5–7):** `POST /merchant/bookings/group`.
- **M3 (Tasks 8–9):** `GET /merchant/bookings/:id/edit-context`.
- **M4 (Tasks 10–14):** Edit endpoints (`PATCH` group, `PATCH` single, `GET` edits, conflict + audit helpers).
- **M5 (Tasks 15–20):** `BookingForm` and supporting components.
- **M6 (Tasks 21–25):** Dashboard + calendar integration + sell-package UI.
- **M7 (Task 26):** End-to-end manual verification + CLAUDE.md note.

---

# M1: Schema + migration

## Task 1: Add `booking_groups` and `booking_edits` Drizzle schema

**Files:**
- Create: `glowos/packages/db/src/schema/booking-groups.ts`
- Modify: `glowos/packages/db/src/schema/index.ts`

- [ ] **Step 1: Create the schema file**

Write `glowos/packages/db/src/schema/booking-groups.ts`:

```ts
import {
  pgTable,
  uuid,
  varchar,
  numeric,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";
import { clients } from "./clients";
import { bookings } from "./bookings";
import { merchantUsers } from "./merchant-users";

export const bookingGroups = pgTable(
  "booking_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    totalPriceSgd: numeric("total_price_sgd", { precision: 10, scale: 2 }).notNull(),
    paymentMethod: varchar("payment_method", { length: 20 })
      .notNull()
      .$type<"cash" | "card" | "paynow" | "other">(),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(
      () => merchantUsers.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    merchantIdx: index("booking_groups_merchant_idx").on(table.merchantId),
    clientIdx: index("booking_groups_client_idx").on(table.clientId),
  })
);

export const bookingEdits = pgTable(
  "booking_edits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "cascade",
    }),
    bookingGroupId: uuid("booking_group_id").references(() => bookingGroups.id, {
      onDelete: "cascade",
    }),
    editedByUserId: uuid("edited_by_user_id")
      .notNull()
      .references(() => merchantUsers.id, { onDelete: "restrict" }),
    editedByRole: varchar("edited_by_role", { length: 20 })
      .notNull()
      .$type<"owner" | "manager" | "staff">(),
    fieldName: text("field_name").notNull(),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bookingIdx: index("booking_edits_booking_idx").on(table.bookingId),
    groupIdx: index("booking_edits_group_idx").on(table.bookingGroupId),
  })
);
```

- [ ] **Step 2: Re-export from the schema barrel**

Edit `glowos/packages/db/src/schema/index.ts` — add the new export **after** the existing `packages.js` line:

```ts
export * from "./booking-groups.js";
```

- [ ] **Step 3: Typecheck**

Run: `cd glowos && pnpm -F @glowos/db typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add glowos/packages/db/src/schema/booking-groups.ts glowos/packages/db/src/schema/index.ts
git commit -m "feat(db): add booking_groups and booking_edits schema"
```

---

## Task 2: Add `bookings.group_id` column

**Files:**
- Modify: `glowos/packages/db/src/schema/bookings.ts`

- [ ] **Step 1: Add the column and import**

Add to the top of `glowos/packages/db/src/schema/bookings.ts` **after** the existing `import { staff } from "./staff"` line:

```ts
import { bookingGroups } from "./booking-groups";
```

Wait — this introduces a circular import (`booking-groups.ts` imports `bookings` for the `booking_edits` FK). To avoid the cycle, do **not** import `bookingGroups` here. Instead, add the column using `uuid("group_id")` with the FK declared via SQL in the migration only (Drizzle supports FK-free column declarations; the DB layer enforces the FK). Add this field inside the `pgTable("bookings", { ... })` column block, right after the `staffId` field:

```ts
groupId: uuid("group_id"),
```

And add an index after the existing `staffStartTimeIdx`:

```ts
groupIdx: index("bookings_group_idx").on(table.groupId),
```

- [ ] **Step 2: Typecheck**

Run: `cd glowos && pnpm -F @glowos/db typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add glowos/packages/db/src/schema/bookings.ts
git commit -m "feat(db): add nullable bookings.group_id column"
```

---

## Task 3: Generate and hand-edit the migration

**Files:**
- Create: `glowos/packages/db/src/migrations/0008_<name>.sql` (generated by drizzle-kit)

- [ ] **Step 1: Generate the migration**

Run: `cd glowos/packages/db && pnpm drizzle-kit generate`
Expected: a new file `src/migrations/0008_*.sql` is created plus an update to `src/migrations/meta/_journal.json`.

- [ ] **Step 2: Inspect and hand-edit to add the missing FK**

Open the new migration file. Find the `ALTER TABLE "bookings" ADD COLUMN "group_id"` line. After the `ALTER TABLE` block that creates indexes, append:

```sql
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_group_id_booking_groups_id_fk"
   FOREIGN KEY ("group_id") REFERENCES "booking_groups"("id")
   ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
```

- [ ] **Step 3: Apply the migration to local dev DB**

Run: `cd glowos/packages/db && pnpm drizzle-kit migrate`
Expected: migration applied, no errors.

- [ ] **Step 4: Verify tables exist**

Run: `cd glowos/packages/db && psql "$DATABASE_URL" -c "\d booking_groups" -c "\d booking_edits" -c "\d bookings" | grep -E "group_id|booking_groups|booking_edits"`
Expected: `group_id` column appears on `bookings`; `booking_groups` and `booking_edits` tables exist with the columns from Task 1.

- [ ] **Step 5: Commit**

```bash
git add glowos/packages/db/src/migrations/
git commit -m "feat(db): migration 0008 — booking groups, edits, group_id"
```

---

## Task 4: Verify existing bookings behavior is unchanged

**Purpose:** Sanity check that adding a nullable column didn't break existing reads or inserts.

- [ ] **Step 1: Start the API and web dev servers**

Run in two terminals:
```bash
cd glowos/services/api && pnpm dev
cd glowos/apps/web && pnpm dev
```

- [ ] **Step 2: Create a pre-feature walk-in via the current modal**

Open `http://localhost:3000/dashboard`, log in, click "Add Walk-in", fill the form, save.
Expected: booking appears on the dashboard, just like before. `group_id` in the DB is `NULL`.

- [ ] **Step 3: Verify with SQL**

Run: `psql "$DATABASE_URL" -c "SELECT id, group_id, status FROM bookings ORDER BY created_at DESC LIMIT 3;"`
Expected: newest row has `group_id = NULL`.

No commit needed for this task — it's a verification checkpoint.

---

# M2: `POST /merchant/bookings/group`

## Task 5: Add the group-create route skeleton

**Files:**
- Create: `glowos/services/api/src/routes/booking-groups.ts`
- Modify: `glowos/services/api/src/index.ts`

- [ ] **Step 1: Write the router skeleton with Zod schema**

Create `glowos/services/api/src/routes/booking-groups.ts`:

```ts
import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { addMinutes, parseISO } from "date-fns";
import {
  db,
  bookings,
  bookingGroups,
  bookingEdits,
  services,
  staff,
  clients,
  clientProfiles,
  clientPackages,
  packageSessions,
  servicePackages,
} from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import { invalidateAvailabilityCacheByMerchantId } from "../lib/availability.js";
import { normalizePhone } from "../lib/normalize.js";
import type { AppVariables } from "../lib/types.js";

export const bookingGroupsRouter = new Hono<{ Variables: AppVariables }>();

const serviceItemSchema = z.object({
  booking_id: z.string().uuid().optional(), // only used by edit
  service_id: z.string().uuid(),
  staff_id: z.string().uuid(),
  start_time: z.string().datetime().optional(),
  price_sgd: z.number().nonnegative().optional(),
  use_package: z
    .object({
      client_package_id: z.string().uuid(),
      session_id: z.string().uuid(),
    })
    .optional(),
});

const createGroupSchema = z.object({
  client_name: z.string().min(1),
  client_phone: z.string().min(1),
  payment_method: z.enum(["cash", "card", "paynow", "other"]),
  notes: z.string().optional(),
  services: z.array(serviceItemSchema).min(1),
  sell_package: z
    .object({
      package_id: z.string().uuid(),
      price_sgd: z.number().nonnegative().optional(),
    })
    .optional(),
});

// Stub — filled in Task 6
bookingGroupsRouter.post(
  "/",
  requireMerchant,
  zValidator(createGroupSchema),
  async (c) => {
    return c.json({ error: "Not Implemented" }, 501);
  }
);
```

- [ ] **Step 2: Mount the router in the API entry point**

Edit `glowos/services/api/src/index.ts`. Find where `merchantBookingsRouter` is mounted (search for `/merchant/bookings`), and add below it:

```ts
import { bookingGroupsRouter } from "./routes/booking-groups.js";
app.route("/merchant/bookings/group", bookingGroupsRouter);
```

- [ ] **Step 3: Typecheck**

Run: `cd glowos/services/api && pnpm typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add glowos/services/api/src/routes/booking-groups.ts glowos/services/api/src/index.ts
git commit -m "feat(api): scaffold booking-groups router"
```

---

## Task 6: Implement `POST /merchant/bookings/group`

**Files:**
- Modify: `glowos/services/api/src/routes/booking-groups.ts`

- [ ] **Step 1: Add a shared helper: `findOrCreateClient`**

Copy the existing `findOrCreateClient` helper from `glowos/services/api/src/routes/bookings.ts` (lines 91–127). If it's already exported from a shared lib, import it; otherwise, add a local copy (DRY note: if you see this helper repeated in more than two places after this task, extract it to `lib/clients.ts` in a follow-up task). For now, import it:

Add to the top of `booking-groups.ts`:

```ts
// Minimal inline port of findOrCreateClient from routes/bookings.ts
async function findOrCreateClient(rawPhone: string, name?: string) {
  const phone = normalizePhone(rawPhone, "SG");
  if (!phone) throw new Error("Invalid phone number");
  const [existing] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.phone, phone))
    .limit(1);
  if (existing) {
    if (name) await db.update(clients).set({ name }).where(eq(clients.id, existing.id));
    return existing;
  }
  const [created] = await db
    .insert(clients)
    .values({ phone, name })
    .returning({ id: clients.id });
  if (!created) throw new Error("Failed to create client");
  return created;
}
```

- [ ] **Step 2: Replace the stub handler with the full implementation**

Replace the handler body (`return c.json({ error: "Not Implemented" }, 501);`) with:

```ts
const merchantId = c.get("merchantId")!;
const userId = c.get("userId")!;
const body = c.get("body") as z.infer<typeof createGroupSchema>;

// Find/create client
let client: { id: string };
try {
  client = await findOrCreateClient(body.client_phone, body.client_name);
} catch {
  return c.json({ error: "Bad Request", message: "Invalid phone number" }, 400);
}

// Ensure client_profile exists for this merchant (required for analytics)
const [profileExisting] = await db
  .select({ id: clientProfiles.id })
  .from(clientProfiles)
  .where(and(eq(clientProfiles.merchantId, merchantId), eq(clientProfiles.clientId, client.id)))
  .limit(1);
if (!profileExisting) {
  await db.insert(clientProfiles).values({ merchantId, clientId: client.id });
}

// Load all service rows referenced
const serviceIds = Array.from(new Set(body.services.map((s) => s.service_id)));
const serviceRows = await db
  .select({
    id: services.id,
    priceSgd: services.priceSgd,
    durationMinutes: services.durationMinutes,
    bufferMinutes: services.bufferMinutes,
  })
  .from(services)
  .where(and(inArray(services.id, serviceIds), eq(services.merchantId, merchantId)));
if (serviceRows.length !== serviceIds.length) {
  return c.json({ error: "Not Found", message: "One or more services not found" }, 404);
}
const svcMap = new Map(serviceRows.map((s) => [s.id, s]));

// Verify staff ownership
const staffIds = Array.from(new Set(body.services.map((s) => s.staff_id)));
const staffRows = await db
  .select({ id: staff.id })
  .from(staff)
  .where(and(inArray(staff.id, staffIds), eq(staff.merchantId, merchantId)));
if (staffRows.length !== staffIds.length) {
  return c.json({ error: "Not Found", message: "One or more staff not found" }, 404);
}

// Compute back-to-back start times when not supplied
const now = new Date();
let cursor = body.services[0].start_time ? parseISO(body.services[0].start_time) : now;
type Plan = {
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  priceSgd: string;
  usePackage?: { clientPackageId: string; sessionId: string };
  serviceId: string;
  staffId: string;
};
const plan: Plan[] = [];
for (let i = 0; i < body.services.length; i++) {
  const row = body.services[i];
  const svc = svcMap.get(row.service_id)!;
  const start = row.start_time ? parseISO(row.start_time) : cursor;
  const totalDuration = svc.durationMinutes + svc.bufferMinutes;
  const end = addMinutes(start, totalDuration);
  cursor = end;
  const listPrice = row.price_sgd !== undefined ? row.price_sgd.toFixed(2) : svc.priceSgd;
  const effectivePrice = row.use_package ? "0.00" : listPrice;
  plan.push({
    startTime: start,
    endTime: end,
    durationMinutes: svc.durationMinutes,
    priceSgd: effectivePrice,
    usePackage: row.use_package
      ? { clientPackageId: row.use_package.client_package_id, sessionId: row.use_package.session_id }
      : undefined,
    serviceId: row.service_id,
    staffId: row.staff_id,
  });
}

// Validate package sessions (must be pending, belong to this client)
for (const p of plan) {
  if (!p.usePackage) continue;
  const [sess] = await db
    .select({
      id: packageSessions.id,
      status: packageSessions.status,
      clientPackageId: packageSessions.clientPackageId,
    })
    .from(packageSessions)
    .where(eq(packageSessions.id, p.usePackage.sessionId))
    .limit(1);
  if (!sess || sess.clientPackageId !== p.usePackage.clientPackageId) {
    return c.json({ error: "Not Found", message: "Package session not found" }, 404);
  }
  if (sess.status !== "pending") {
    return c.json(
      { error: "Conflict", message: "Package session is no longer available" },
      409
    );
  }
}

const totalPrice = plan.reduce((s, p) => s + Number(p.priceSgd), 0).toFixed(2);

// Transactional write
const result = await db.transaction(async (tx) => {
  const [group] = await tx
    .insert(bookingGroups)
    .values({
      merchantId,
      clientId: client.id,
      totalPriceSgd: totalPrice,
      paymentMethod: body.payment_method,
      notes: body.notes ?? null,
      createdByUserId: userId,
    })
    .returning();

  const inserted = [];
  for (const p of plan) {
    const [b] = await tx
      .insert(bookings)
      .values({
        merchantId,
        clientId: client.id,
        serviceId: p.serviceId,
        staffId: p.staffId,
        startTime: p.startTime,
        endTime: p.endTime,
        durationMinutes: p.durationMinutes,
        status: "confirmed",
        priceSgd: p.priceSgd,
        paymentMethod: body.payment_method,
        bookingSource: "walkin_manual",
        commissionRate: "0",
        commissionSgd: "0",
        groupId: group.id,
      })
      .returning();
    inserted.push(b);

    if (p.usePackage) {
      await tx
        .update(packageSessions)
        .set({
          status: "completed",
          completedAt: new Date(),
          bookingId: b.id,
          staffId: p.staffId,
        })
        .where(eq(packageSessions.id, p.usePackage.sessionId));
      await tx
        .update(clientPackages)
        .set({ sessionsUsed: sql`${clientPackages.sessionsUsed} + 1` })
        .where(eq(clientPackages.id, p.usePackage.clientPackageId));
    }
  }

  // Optional: sell a new package in the same transaction
  let soldPackage = null;
  if (body.sell_package) {
    const [pkg] = await tx
      .select()
      .from(servicePackages)
      .where(
        and(
          eq(servicePackages.id, body.sell_package.package_id),
          eq(servicePackages.merchantId, merchantId)
        )
      )
      .limit(1);
    if (!pkg) {
      throw new Error("sell_package_not_found");
    }
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + pkg.validityDays);
    const pricePaid =
      body.sell_package.price_sgd !== undefined
        ? body.sell_package.price_sgd.toFixed(2)
        : pkg.priceSgd;
    const [clientPkg] = await tx
      .insert(clientPackages)
      .values({
        merchantId,
        clientId: client.id,
        packageId: pkg.id,
        packageName: pkg.name,
        sessionsTotal: pkg.totalSessions,
        pricePaidSgd: pricePaid,
        expiresAt,
      })
      .returning();
    const sessionValues: Array<{
      clientPackageId: string;
      sessionNumber: number;
      serviceId: string;
    }> = [];
    for (const s of pkg.includedServices) {
      for (let i = 0; i < s.quantity; i++) {
        sessionValues.push({
          clientPackageId: clientPkg.id,
          sessionNumber: sessionValues.length + 1,
          serviceId: s.serviceId,
        });
      }
    }
    if (sessionValues.length > 0) {
      await tx.insert(packageSessions).values(sessionValues);
    }
    soldPackage = clientPkg;
  }

  return { group, bookings: inserted, soldPackage };
});

await invalidateAvailabilityCacheByMerchantId(merchantId);
return c.json(result, 201);
```

- [ ] **Step 3: Handle the `sell_package_not_found` error**

The transaction above throws `new Error("sell_package_not_found")` when the package is missing. Wrap the `await db.transaction(...)` call in a `try/catch` and translate this to a 404:

```ts
let result;
try {
  result = await db.transaction(async (tx) => { /* ... body from Step 2 ... */ });
} catch (err) {
  if (err instanceof Error && err.message === "sell_package_not_found") {
    return c.json({ error: "Not Found", message: "Package template not found" }, 404);
  }
  throw err;
}
```

- [ ] **Step 4: Typecheck**

Run: `cd glowos/services/api && pnpm typecheck`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add glowos/services/api/src/routes/booking-groups.ts
git commit -m "feat(api): POST /merchant/bookings/group creates group walk-ins"
```

---

## Task 7: Manually verify `POST /merchant/bookings/group`

- [ ] **Step 1: Start API and get a merchant JWT**

Run `cd glowos/services/api && pnpm dev`. In another terminal, log in via the web app to obtain an `access_token` from localStorage, or call `POST /auth/login` directly. Export it: `export TOKEN=<your-token>`.

- [ ] **Step 2: Verify single-service create**

Pull a real `service_id` and `staff_id` from your DB first:
```bash
psql "$DATABASE_URL" -c "SELECT id FROM services WHERE is_active = true LIMIT 1;"
psql "$DATABASE_URL" -c "SELECT id FROM staff LIMIT 1;"
```
Then:
```bash
curl -sS -X POST http://localhost:3001/merchant/bookings/group \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Plan Test",
    "client_phone": "+6591111111",
    "payment_method": "cash",
    "services": [
      { "service_id": "<SERVICE_UUID>", "staff_id": "<STAFF_UUID>" }
    ]
  }' | jq
```
Expected: 201 with `group`, `bookings[0]` populated, `bookings[0].groupId` matches `group.id`.

- [ ] **Step 3: Verify multi-service back-to-back packing**

Call the same endpoint with two services, no `start_time`:
```bash
curl -sS -X POST http://localhost:3001/merchant/bookings/group \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Plan Test 2",
    "client_phone": "+6592222222",
    "payment_method": "card",
    "services": [
      { "service_id": "<SERVICE_UUID_1>", "staff_id": "<STAFF_UUID>" },
      { "service_id": "<SERVICE_UUID_2>", "staff_id": "<STAFF_UUID>" }
    ]
  }' | jq '.bookings | map({ startTime, endTime })'
```
Expected: `bookings[1].startTime === bookings[0].endTime`.

- [ ] **Step 4: Verify dashboard reflects the new bookings**

Refresh `http://localhost:3000/dashboard`. Both services from Step 3 should appear as separate cards.

No commit — verification only.

---

# M3: `GET /merchant/bookings/:id/edit-context`

## Task 8: Implement the edit-context endpoint

**Files:**
- Modify: `glowos/services/api/src/routes/bookings.ts`

- [ ] **Step 1: Add the route**

Inside `merchantBookingsRouter` in `glowos/services/api/src/routes/bookings.ts`, add **after** the existing `GET /merchant/bookings/:id` route (around line 562) and **before** `POST /merchant/bookings` (around line 565):

```ts
// ─── Protected: GET /merchant/bookings/:id/edit-context ───────────────────────

merchantBookingsRouter.get("/:id/edit-context", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const bookingId = c.req.param("id")!;

  const [row] = await db
    .select({
      booking: bookings,
      group: bookingGroups,
    })
    .from(bookings)
    .leftJoin(bookingGroups, eq(bookings.groupId, bookingGroups.id))
    .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
    .limit(1);

  if (!row) {
    return c.json({ error: "Not Found", message: "Booking not found" }, 404);
  }

  const siblingBookings = row.group
    ? await db
        .select({ booking: bookings, service: services, staff })
        .from(bookings)
        .innerJoin(services, eq(bookings.serviceId, services.id))
        .innerJoin(staff, eq(bookings.staffId, staff.id))
        .where(eq(bookings.groupId, row.group.id))
    : [{ booking: row.booking }];

  // Active packages for this client
  const activePackages = await db
    .select({
      id: clientPackages.id,
      packageName: clientPackages.packageName,
      sessionsTotal: clientPackages.sessionsTotal,
      sessionsUsed: clientPackages.sessionsUsed,
      expiresAt: clientPackages.expiresAt,
    })
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.clientId, row.booking.clientId),
        eq(clientPackages.merchantId, merchantId),
        eq(clientPackages.status, "active")
      )
    );

  const pkgIds = activePackages.map((p) => p.id);
  const pendingSessions = pkgIds.length
    ? await db
        .select({
          id: packageSessions.id,
          clientPackageId: packageSessions.clientPackageId,
          serviceId: packageSessions.serviceId,
          sessionNumber: packageSessions.sessionNumber,
        })
        .from(packageSessions)
        .where(
          and(
            inArray(packageSessions.clientPackageId, pkgIds),
            eq(packageSessions.status, "pending")
          )
        )
    : [];

  const allServices = await db
    .select({ id: services.id, name: services.name, priceSgd: services.priceSgd, durationMinutes: services.durationMinutes, bufferMinutes: services.bufferMinutes })
    .from(services)
    .where(and(eq(services.merchantId, merchantId), eq(services.isActive, true)));

  const allStaff = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(eq(staff.merchantId, merchantId));

  // Last edit + full client info
  const [lastEdit] = await db
    .select()
    .from(bookingEdits)
    .where(
      row.group
        ? eq(bookingEdits.bookingGroupId, row.group.id)
        : eq(bookingEdits.bookingId, bookingId)
    )
    .orderBy(sql`${bookingEdits.createdAt} DESC`)
    .limit(1);

  const [clientRow] = await db
    .select({ id: clients.id, name: clients.name, phone: clients.phone })
    .from(clients)
    .where(eq(clients.id, row.booking.clientId))
    .limit(1);

  return c.json({
    booking: row.booking,
    group: row.group,
    client: clientRow,
    siblingBookings,
    activePackages: activePackages.map((p) => ({
      ...p,
      pendingSessions: pendingSessions.filter((s) => s.clientPackageId === p.id),
    })),
    services: allServices,
    staff: allStaff,
    lastEdit: lastEdit ?? null,
  });
});
```

- [ ] **Step 2: Update imports at the top of the file**

In `glowos/services/api/src/routes/bookings.ts`, extend the existing import from `@glowos/db`:

```ts
import {
  db,
  merchants,
  services,
  staff,
  staffServices,
  bookings,
  slotLeases,
  clients,
  clientProfiles,
  bookingGroups,
  bookingEdits,
  clientPackages,
  packageSessions,
} from "@glowos/db";
```

And add `sql, inArray` to the drizzle-orm import:

```ts
import { and, eq, gte, lte, inArray, sql } from "drizzle-orm";
```

- [ ] **Step 3: Typecheck**

Run: `cd glowos/services/api && pnpm typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add glowos/services/api/src/routes/bookings.ts
git commit -m "feat(api): GET /merchant/bookings/:id/edit-context"
```

---

## Task 9: Manually verify edit-context

- [ ] **Step 1: Pull a booking id**

Run: `psql "$DATABASE_URL" -c "SELECT id FROM bookings ORDER BY created_at DESC LIMIT 1;"`

- [ ] **Step 2: Call the endpoint**

```bash
curl -sS "http://localhost:3001/merchant/bookings/<BOOKING_ID>/edit-context" \
  -H "Authorization: Bearer $TOKEN" | jq
```
Expected JSON keys: `booking`, `group` (null for old bookings, object for new ones), `client`, `siblingBookings`, `activePackages`, `services`, `staff`, `lastEdit`.

No commit — verification only.

---

# M4: Edit endpoints

## Task 10: Add conflict and audit helpers

**Files:**
- Create: `glowos/services/api/src/lib/booking-conflicts.ts`
- Create: `glowos/services/api/src/lib/booking-edits.ts`

- [ ] **Step 1: Write the conflict helper**

Create `glowos/services/api/src/lib/booking-conflicts.ts`:

```ts
import { and, eq, ne, or, lt, gt, inArray } from "drizzle-orm";
import { db, bookings } from "@glowos/db";

export type Conflict = {
  conflictingBookingId: string;
  staffId: string;
  startTime: Date;
  endTime: Date;
};

/**
 * Returns the first conflicting booking if the proposed (staffId, start, end)
 * overlaps any confirmed/in_progress booking on the same staff, excluding
 * bookings whose ids are in `excludeBookingIds`.
 */
export async function findStaffConflict(params: {
  merchantId: string;
  staffId: string;
  startTime: Date;
  endTime: Date;
  excludeBookingIds: string[];
}): Promise<Conflict | null> {
  const conds = [
    eq(bookings.merchantId, params.merchantId),
    eq(bookings.staffId, params.staffId),
    inArray(bookings.status, ["confirmed", "in_progress"] as const),
    lt(bookings.startTime, params.endTime),
    gt(bookings.endTime, params.startTime),
  ];
  if (params.excludeBookingIds.length > 0) {
    // drizzle: NOT IN
    conds.push(
      or(
        ...params.excludeBookingIds.map((id) => ne(bookings.id, id))
      )!
    );
  }
  const [hit] = await db
    .select({
      id: bookings.id,
      staffId: bookings.staffId,
      startTime: bookings.startTime,
      endTime: bookings.endTime,
    })
    .from(bookings)
    .where(and(...conds))
    .limit(1);
  if (!hit) return null;
  return {
    conflictingBookingId: hit.id,
    staffId: hit.staffId,
    startTime: hit.startTime,
    endTime: hit.endTime,
  };
}
```

- [ ] **Step 2: Write the audit-log diff helper**

Create `glowos/services/api/src/lib/booking-edits.ts`:

```ts
import { db, bookingEdits } from "@glowos/db";

export type AuditContext = {
  userId: string;
  userRole: "owner" | "manager" | "staff";
  bookingId?: string;
  bookingGroupId?: string;
};

/**
 * Compares `before` and `after` objects and writes one booking_edits row per
 * changed field. Values are compared by JSON equality. Dates are serialized
 * to ISO strings before comparison.
 */
export async function writeAuditDiff(
  ctx: AuditContext,
  before: Record<string, unknown>,
  after: Record<string, unknown>
) {
  const rows: Array<{
    bookingId: string | null;
    bookingGroupId: string | null;
    editedByUserId: string;
    editedByRole: "owner" | "manager" | "staff";
    fieldName: string;
    oldValue: unknown;
    newValue: unknown;
  }> = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const a = normalize(before[k]);
    const b = normalize(after[k]);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    rows.push({
      bookingId: ctx.bookingId ?? null,
      bookingGroupId: ctx.bookingGroupId ?? null,
      editedByUserId: ctx.userId,
      editedByRole: ctx.userRole,
      fieldName: k,
      oldValue: a ?? null,
      newValue: b ?? null,
    });
  }
  if (rows.length > 0) {
    await db.insert(bookingEdits).values(rows);
  }
  return rows.length;
}

function normalize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  return v;
}
```

- [ ] **Step 3: Typecheck**

Run: `cd glowos/services/api && pnpm typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add glowos/services/api/src/lib/booking-conflicts.ts glowos/services/api/src/lib/booking-edits.ts
git commit -m "feat(api): add booking-conflict and booking-edit audit helpers"
```

---

## Task 11: Implement `PATCH /merchant/bookings/group/:groupId`

**Files:**
- Modify: `glowos/services/api/src/routes/booking-groups.ts`

- [ ] **Step 1: Reuse `serviceItemSchema` + a patch schema**

At the top of the file near `createGroupSchema`, add:

```ts
const patchGroupSchema = z.object({
  payment_method: z.enum(["cash", "card", "paynow", "other"]).optional(),
  notes: z.string().nullable().optional(),
  services: z.array(serviceItemSchema).min(1),
});
```

- [ ] **Step 2: Add imports**

At the top of the file add:

```ts
import { findStaffConflict } from "../lib/booking-conflicts.js";
import { writeAuditDiff } from "../lib/booking-edits.js";
```

And extend drizzle-orm: `import { and, eq, inArray, sql, ne } from "drizzle-orm";`

- [ ] **Step 3: Implement the handler**

Append to `booking-groups.ts`:

```ts
bookingGroupsRouter.patch(
  "/:groupId",
  requireMerchant,
  zValidator(patchGroupSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const userId = c.get("userId")!;
    const userRole = c.get("userRole") as "owner" | "manager" | "staff";
    const groupId = c.req.param("groupId")!;
    const body = c.get("body") as z.infer<typeof patchGroupSchema>;

    // Load group
    const [group] = await db
      .select()
      .from(bookingGroups)
      .where(and(eq(bookingGroups.id, groupId), eq(bookingGroups.merchantId, merchantId)))
      .limit(1);
    if (!group) {
      return c.json({ error: "Not Found", message: "Booking group not found" }, 404);
    }

    // Load current child bookings
    const currentBookings = await db
      .select()
      .from(bookings)
      .where(eq(bookings.groupId, groupId));

    // Disallow if ANY child is cancelled
    if (currentBookings.some((b) => b.status === "cancelled")) {
      return c.json(
        { error: "Conflict", message: "Cannot edit a cancelled booking" },
        409
      );
    }

    // Load service rows
    const serviceIds = Array.from(new Set(body.services.map((s) => s.service_id)));
    const serviceRows = await db
      .select({
        id: services.id,
        priceSgd: services.priceSgd,
        durationMinutes: services.durationMinutes,
        bufferMinutes: services.bufferMinutes,
      })
      .from(services)
      .where(and(inArray(services.id, serviceIds), eq(services.merchantId, merchantId)));
    const svcMap = new Map(serviceRows.map((s) => [s.id, s]));
    if (svcMap.size !== serviceIds.length) {
      return c.json({ error: "Not Found", message: "One or more services not found" }, 404);
    }

    // Classify submitted rows
    const currentMap = new Map(currentBookings.map((b) => [b.id, b]));
    const submittedIds = new Set(
      body.services.map((s) => s.booking_id).filter(Boolean) as string[]
    );
    const toDelete = currentBookings.filter((b) => !submittedIds.has(b.id));
    const toKeep = body.services.filter((s) => s.booking_id && currentMap.has(s.booking_id));
    const toInsert = body.services.filter((s) => !s.booking_id);

    // Conflict checks for kept + new
    const excludeIds = currentBookings.map((b) => b.id);
    for (const s of [...toKeep, ...toInsert]) {
      const svc = svcMap.get(s.service_id)!;
      const start = s.start_time ? parseISO(s.start_time) : new Date();
      const end = addMinutes(start, svc.durationMinutes + svc.bufferMinutes);
      const conflict = await findStaffConflict({
        merchantId,
        staffId: s.staff_id,
        startTime: start,
        endTime: end,
        excludeBookingIds: excludeIds,
      });
      if (conflict) {
        return c.json(
          { error: "Conflict", message: "Staff double-booked", ...conflict },
          409
        );
      }
    }

    // Commission fields (`commissionRate`, `commissionSgd`) are intentionally
    // never touched in this handler — per spec, commission is locked at the
    // time the booking was originally completed.

    // Run transactional edit
    await db.transaction(async (tx) => {
      // DELETE removed rows + re-credit any consumed package sessions
      for (const b of toDelete) {
        const [sess] = await tx
          .select()
          .from(packageSessions)
          .where(eq(packageSessions.bookingId, b.id))
          .limit(1);
        if (sess) {
          await tx
            .update(packageSessions)
            .set({
              status: "pending",
              completedAt: null,
              bookingId: null,
              staffId: null,
              staffName: null,
            })
            .where(eq(packageSessions.id, sess.id));
          await tx
            .update(clientPackages)
            .set({
              sessionsUsed: sql`${clientPackages.sessionsUsed} - 1`,
              status: "active",
            })
            .where(eq(clientPackages.id, sess.clientPackageId));
        }
        await writeAuditDiff(
          { userId, userRole, bookingId: b.id, bookingGroupId: groupId },
          { deleted: false },
          { deleted: true }
        );
        await tx.delete(bookings).where(eq(bookings.id, b.id));
      }

      // UPDATE kept rows
      for (const s of toKeep) {
        const existing = currentMap.get(s.booking_id!)!;
        const svc = svcMap.get(s.service_id)!;
        const start = s.start_time ? parseISO(s.start_time) : existing.startTime;
        const end = addMinutes(start, svc.durationMinutes + svc.bufferMinutes);
        const listPrice = s.price_sgd !== undefined ? s.price_sgd.toFixed(2) : svc.priceSgd;
        const effectivePrice = s.use_package ? "0.00" : listPrice;

        const newValues = {
          serviceId: s.service_id,
          staffId: s.staff_id,
          startTime: start,
          endTime: end,
          durationMinutes: svc.durationMinutes,
          priceSgd: effectivePrice,
        };

        await writeAuditDiff(
          { userId, userRole, bookingId: existing.id, bookingGroupId: groupId },
          {
            serviceId: existing.serviceId,
            staffId: existing.staffId,
            startTime: existing.startTime,
            endTime: existing.endTime,
            priceSgd: existing.priceSgd,
          },
          newValues
        );

        await tx
          .update(bookings)
          .set({ ...newValues, updatedAt: new Date() })
          .where(eq(bookings.id, existing.id));

        // Package redemption change: if this row now uses a package but didn't before, consume session
        const [sessCurrent] = await tx
          .select()
          .from(packageSessions)
          .where(eq(packageSessions.bookingId, existing.id))
          .limit(1);
        const wantsPkg = Boolean(s.use_package);
        if (sessCurrent && !wantsPkg) {
          // Re-credit
          await tx
            .update(packageSessions)
            .set({
              status: "pending",
              completedAt: null,
              bookingId: null,
              staffId: null,
              staffName: null,
            })
            .where(eq(packageSessions.id, sessCurrent.id));
          await tx
            .update(clientPackages)
            .set({
              sessionsUsed: sql`${clientPackages.sessionsUsed} - 1`,
              status: "active",
            })
            .where(eq(clientPackages.id, sessCurrent.clientPackageId));
        } else if (!sessCurrent && wantsPkg && s.use_package) {
          // Debit new session
          await tx
            .update(packageSessions)
            .set({
              status: "completed",
              completedAt: new Date(),
              bookingId: existing.id,
              staffId: s.staff_id,
            })
            .where(eq(packageSessions.id, s.use_package.session_id));
          await tx
            .update(clientPackages)
            .set({ sessionsUsed: sql`${clientPackages.sessionsUsed} + 1` })
            .where(eq(clientPackages.id, s.use_package.client_package_id));
        }
      }

      // INSERT new rows
      for (const s of toInsert) {
        const svc = svcMap.get(s.service_id)!;
        const start = s.start_time ? parseISO(s.start_time) : new Date();
        const end = addMinutes(start, svc.durationMinutes + svc.bufferMinutes);
        const listPrice = s.price_sgd !== undefined ? s.price_sgd.toFixed(2) : svc.priceSgd;
        const effectivePrice = s.use_package ? "0.00" : listPrice;
        const [b] = await tx
          .insert(bookings)
          .values({
            merchantId,
            clientId: group.clientId,
            serviceId: s.service_id,
            staffId: s.staff_id,
            startTime: start,
            endTime: end,
            durationMinutes: svc.durationMinutes,
            status: "confirmed",
            priceSgd: effectivePrice,
            paymentMethod: body.payment_method ?? group.paymentMethod,
            bookingSource: "walkin_manual",
            commissionRate: "0",
            commissionSgd: "0",
            groupId: groupId,
          })
          .returning();
        await writeAuditDiff(
          { userId, userRole, bookingId: b.id, bookingGroupId: groupId },
          { exists: false },
          { exists: true, serviceId: s.service_id, staffId: s.staff_id }
        );
        if (s.use_package) {
          await tx
            .update(packageSessions)
            .set({
              status: "completed",
              completedAt: new Date(),
              bookingId: b.id,
              staffId: s.staff_id,
            })
            .where(eq(packageSessions.id, s.use_package.session_id));
          await tx
            .update(clientPackages)
            .set({ sessionsUsed: sql`${clientPackages.sessionsUsed} + 1` })
            .where(eq(clientPackages.id, s.use_package.client_package_id));
        }
      }

      // Recompute group total + audit group-level fields
      const remaining = await tx
        .select({ price: bookings.priceSgd })
        .from(bookings)
        .where(eq(bookings.groupId, groupId));
      const newTotal = remaining.reduce((s, r) => s + Number(r.price), 0).toFixed(2);

      await writeAuditDiff(
        { userId, userRole, bookingGroupId: groupId },
        {
          paymentMethod: group.paymentMethod,
          notes: group.notes,
          totalPriceSgd: group.totalPriceSgd,
        },
        {
          paymentMethod: body.payment_method ?? group.paymentMethod,
          notes: body.notes ?? group.notes,
          totalPriceSgd: newTotal,
        }
      );

      await tx
        .update(bookingGroups)
        .set({
          paymentMethod: body.payment_method ?? group.paymentMethod,
          notes: body.notes === undefined ? group.notes : body.notes,
          totalPriceSgd: newTotal,
          updatedAt: new Date(),
        })
        .where(eq(bookingGroups.id, groupId));

      // Also propagate paymentMethod down to child bookings (denormalized field)
      if (body.payment_method && body.payment_method !== group.paymentMethod) {
        await tx
          .update(bookings)
          .set({ paymentMethod: body.payment_method, updatedAt: new Date() })
          .where(eq(bookings.groupId, groupId));
      }
    });

    await invalidateAvailabilityCacheByMerchantId(merchantId);
    return c.json({ success: true });
  }
);
```

- [ ] **Step 4: Typecheck**

Run: `cd glowos/services/api && pnpm typecheck`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add glowos/services/api/src/routes/booking-groups.ts
git commit -m "feat(api): PATCH /merchant/bookings/group/:groupId full edit"
```

---

## Task 12: Implement `PATCH /merchant/bookings/:id` for non-grouped bookings

**Files:**
- Modify: `glowos/services/api/src/routes/bookings.ts`

- [ ] **Step 1: Add the patch schema and handler**

In `glowos/services/api/src/routes/bookings.ts`, add near the top schemas block:

```ts
const patchBookingSchema = z.object({
  service_id: z.string().uuid().optional(),
  staff_id: z.string().uuid().optional(),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
  payment_method: z.string().optional(),
  price_sgd: z.number().nonnegative().optional(),
  client_notes: z.string().nullable().optional(),
});
```

Then inside `merchantBookingsRouter`, add **after** the reschedule route (around line 815):

```ts
// ─── Protected: PATCH /merchant/bookings/:id (general edit) ────────────────────

merchantBookingsRouter.patch(
  "/:id",
  requireMerchant,
  zValidator(patchBookingSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const userId = c.get("userId")!;
    const userRole = c.get("userRole") as "owner" | "manager" | "staff";
    const bookingId = c.req.param("id")!;
    const body = c.get("body") as z.infer<typeof patchBookingSchema>;

    const [existing] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
      .limit(1);
    if (!existing) {
      return c.json({ error: "Not Found", message: "Booking not found" }, 404);
    }
    if (existing.status === "cancelled") {
      return c.json(
        { error: "Conflict", message: "Cannot edit a cancelled booking" },
        409
      );
    }

    // Resolve service (for duration) if service_id is changing
    let durationMinutes = existing.durationMinutes;
    let newEndTime = existing.endTime;
    let effectivePrice = existing.priceSgd;
    if (body.service_id && body.service_id !== existing.serviceId) {
      const [svc] = await db
        .select({
          priceSgd: services.priceSgd,
          durationMinutes: services.durationMinutes,
          bufferMinutes: services.bufferMinutes,
        })
        .from(services)
        .where(and(eq(services.id, body.service_id), eq(services.merchantId, merchantId)))
        .limit(1);
      if (!svc) {
        return c.json({ error: "Not Found", message: "Service not found" }, 404);
      }
      durationMinutes = svc.durationMinutes;
      const baseStart = body.start_time ? parseISO(body.start_time) : existing.startTime;
      newEndTime = addMinutes(baseStart, svc.durationMinutes + svc.bufferMinutes);
      effectivePrice = svc.priceSgd; // default to list price
    }
    // Explicit price override wins
    if (body.price_sgd !== undefined) effectivePrice = body.price_sgd.toFixed(2);

    const newStart = body.start_time ? parseISO(body.start_time) : existing.startTime;
    if (body.end_time) newEndTime = parseISO(body.end_time);
    const newStaffId = body.staff_id ?? existing.staffId;

    // Conflict check if staff/time changed
    const staffOrTimeChanged =
      newStaffId !== existing.staffId ||
      newStart.getTime() !== existing.startTime.getTime() ||
      newEndTime.getTime() !== existing.endTime.getTime();
    if (staffOrTimeChanged) {
      const conflict = await findStaffConflict({
        merchantId,
        staffId: newStaffId,
        startTime: newStart,
        endTime: newEndTime,
        excludeBookingIds: [bookingId],
      });
      if (conflict) {
        return c.json(
          { error: "Conflict", message: "Staff double-booked", ...conflict },
          409
        );
      }
    }

    // Commission fields are intentionally left untouched (locked at completion
    // per spec). No review-request or no-show job is queued here either —
    // those fire once at completion, not on subsequent edits.
    await db.transaction(async (tx) => {
      const newValues = {
        serviceId: body.service_id ?? existing.serviceId,
        staffId: newStaffId,
        startTime: newStart,
        endTime: newEndTime,
        durationMinutes,
        priceSgd: effectivePrice,
        paymentMethod: body.payment_method ?? existing.paymentMethod,
        clientNotes: body.client_notes === undefined ? existing.clientNotes : body.client_notes,
      };

      await writeAuditDiff(
        { userId, userRole, bookingId },
        {
          serviceId: existing.serviceId,
          staffId: existing.staffId,
          startTime: existing.startTime,
          endTime: existing.endTime,
          priceSgd: existing.priceSgd,
          paymentMethod: existing.paymentMethod,
          clientNotes: existing.clientNotes,
        },
        newValues
      );

      await tx
        .update(bookings)
        .set({ ...newValues, updatedAt: new Date() })
        .where(eq(bookings.id, bookingId));
    });

    await invalidateAvailabilityCacheByMerchantId(merchantId);
    return c.json({ success: true });
  }
);
```

- [ ] **Step 2: Update imports**

At the top of `bookings.ts`, add:

```ts
import { findStaffConflict } from "../lib/booking-conflicts.js";
import { writeAuditDiff } from "../lib/booking-edits.js";
```

- [ ] **Step 3: Typecheck**

Run: `cd glowos/services/api && pnpm typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add glowos/services/api/src/routes/bookings.ts
git commit -m "feat(api): PATCH /merchant/bookings/:id single-booking edit"
```

---

## Task 13: Implement `GET /merchant/bookings/:id/edits`

**Files:**
- Modify: `glowos/services/api/src/routes/bookings.ts`

- [ ] **Step 1: Add the route**

Append inside `merchantBookingsRouter` after the PATCH route from Task 12:

```ts
// ─── Protected: GET /merchant/bookings/:id/edits (audit trail) ────────────────

merchantBookingsRouter.get("/:id/edits", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const bookingId = c.req.param("id")!;

  const [existing] = await db
    .select({ id: bookings.id, groupId: bookings.groupId })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
    .limit(1);
  if (!existing) {
    return c.json({ error: "Not Found", message: "Booking not found" }, 404);
  }

  const rows = await db
    .select()
    .from(bookingEdits)
    .where(
      existing.groupId
        ? or(
            eq(bookingEdits.bookingId, bookingId),
            eq(bookingEdits.bookingGroupId, existing.groupId)
          )!
        : eq(bookingEdits.bookingId, bookingId)
    )
    .orderBy(sql`${bookingEdits.createdAt} DESC`);

  return c.json({ edits: rows });
});
```

- [ ] **Step 2: Add `or` to drizzle imports**

Update the drizzle-orm import in `bookings.ts`:

```ts
import { and, eq, gte, lte, inArray, sql, or } from "drizzle-orm";
```

- [ ] **Step 3: Typecheck**

Run: `cd glowos/services/api && pnpm typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add glowos/services/api/src/routes/bookings.ts
git commit -m "feat(api): GET /merchant/bookings/:id/edits audit trail"
```

---

## Task 14: Manually verify all edit endpoints

- [ ] **Step 1: Edit a grouped booking — change service**

Using a `group_id` from a booking created in Task 7:

```bash
curl -sS -X PATCH "http://localhost:3001/merchant/bookings/group/<GROUP_ID>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "payment_method": "card",
    "services": [
      { "booking_id": "<EXISTING_BOOKING_ID>", "service_id": "<DIFFERENT_SERVICE_ID>", "staff_id": "<STAFF_ID>" }
    ]
  }' | jq
```
Expected: `{ "success": true }`. Verify: `SELECT price_sgd, service_id FROM bookings WHERE id = '<EXISTING_BOOKING_ID>';` reflects the new service's list price.

- [ ] **Step 2: Edit a grouped booking — remove a service**

Call PATCH with only one of the two existing `booking_id`s in the `services` array. Expected: the other one is deleted; `SELECT count(*) FROM bookings WHERE group_id = '<GROUP_ID>';` returns 1.

- [ ] **Step 3: Edit a completed booking**

Manually mark a booking completed (check-in then complete). Then PATCH it. Expected: succeeds, audit rows written, no new review-request job enqueued (check Redis/BullMQ dashboard or `SELECT count(*) FROM notifications WHERE booking_id = '<BOOKING_ID>';` does not grow).

- [ ] **Step 4: Edit a cancelled booking → 409**

Manually cancel a booking. Then try to PATCH it. Expected: HTTP 409 with `"Cannot edit a cancelled booking"`.

- [ ] **Step 5: Staff double-booking → 409**

Create two groups at the same time for the same staff. Expected: second returns HTTP 409 with `conflictingBookingId`, `staffId`, `startTime`, `endTime`.

- [ ] **Step 6: Package session credit/debit**

Assign a package to a client. Create a walk-in with `use_package`. Verify: `SELECT status, booking_id FROM package_sessions WHERE id = '<SESSION_ID>';` shows `completed` + the new booking id. Then PATCH the group to remove that service. Verify: session is `pending`, `booking_id` is NULL, `sessions_used` decremented.

- [ ] **Step 7: Audit trail returns rows**

```bash
curl -sS "http://localhost:3001/merchant/bookings/<BOOKING_ID>/edits" \
  -H "Authorization: Bearer $TOKEN" | jq
```
Expected: array of `booking_edits` rows, most recent first.

No commit — verification checkpoint.

---

# M5: `BookingForm` and supporting components

## Task 15: Scaffold the BookingForm directory

**Files:**
- Create: `glowos/apps/web/app/dashboard/bookings/types.ts`
- Create: `glowos/apps/web/app/dashboard/bookings/BookingForm.tsx` (skeleton)

- [ ] **Step 1: Write shared types**

Create `glowos/apps/web/app/dashboard/bookings/types.ts`:

```ts
export type BookingStatus =
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export type PaymentMethod = "cash" | "card" | "paynow" | "other";

export interface ServiceOption {
  id: string;
  name: string;
  priceSgd: string;
  durationMinutes: number;
  bufferMinutes: number;
}

export interface StaffOption {
  id: string;
  name: string;
}

export interface PendingPackageSession {
  id: string;
  clientPackageId: string;
  serviceId: string;
  sessionNumber: number;
}

export interface ActivePackage {
  id: string;
  packageName: string;
  sessionsTotal: number;
  sessionsUsed: number;
  expiresAt: string;
  pendingSessions: PendingPackageSession[];
}

export interface ServiceRowState {
  /** UUID from the backend; absent for new rows added during edit */
  bookingId?: string;
  serviceId: string;
  staffId: string;
  startTime: string; // ISO
  priceSgd: string;
  priceTouched: boolean; // true if user edited the price directly
  usePackage?: { clientPackageId: string; sessionId: string };
}

export interface EditContextResponse {
  booking: {
    id: string;
    status: BookingStatus;
    groupId: string | null;
    clientId: string;
    serviceId: string;
    staffId: string;
    startTime: string;
    endTime: string;
    priceSgd: string;
    clientNotes: string | null;
    paymentMethod: string | null;
  };
  group: {
    id: string;
    paymentMethod: PaymentMethod;
    notes: string | null;
    totalPriceSgd: string;
  } | null;
  client: { id: string; name: string | null; phone: string };
  siblingBookings: Array<{
    booking: EditContextResponse["booking"];
    service?: { id: string; name: string };
    staff?: { id: string; name: string };
  }>;
  activePackages: ActivePackage[];
  services: ServiceOption[];
  staff: StaffOption[];
  lastEdit: {
    createdAt: string;
    editedByUserId: string;
    fieldName: string;
  } | null;
}
```

- [ ] **Step 2: Scaffold BookingForm**

Create `glowos/apps/web/app/dashboard/bookings/BookingForm.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';
import type {
  ServiceOption,
  StaffOption,
  PaymentMethod,
  ServiceRowState,
  ActivePackage,
  EditContextResponse,
} from './types';

export interface BookingFormProps {
  mode: 'create' | 'edit';
  bookingId?: string;
  groupId?: string;
  services?: ServiceOption[]; // create mode: supplied by parent
  staffList?: StaffOption[];  // create mode: supplied by parent
  onClose: () => void;
  onSave: () => void;
}

export function BookingForm(props: BookingFormProps) {
  const { mode, onClose, onSave } = props;
  const router = useRouter();

  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');
  const [services, setServices] = useState<ServiceOption[]>(props.services ?? []);
  const [staffList, setStaffList] = useState<StaffOption[]>(props.staffList ?? []);
  const [activePackages, setActivePackages] = useState<ActivePackage[]>([]);
  const [rows, setRows] = useState<ServiceRowState[]>([]);
  const [completedBanner, setCompletedBanner] = useState(false);
  const [lastEditLabel, setLastEditLabel] = useState<string | null>(null);

  // Load edit context or reset create defaults
  useEffect(() => {
    if (mode !== 'edit' || !props.bookingId) {
      // Create-mode default row
      if (services[0] && staffList[0]) {
        setRows([defaultRow(services[0], staffList[0])]);
      }
      return;
    }
    const token = localStorage.getItem('access_token');
    apiFetch(`/merchant/bookings/${props.bookingId}/edit-context`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((data) => {
        const ctx = data as EditContextResponse;
        setServices(ctx.services);
        setStaffList(ctx.staff);
        setActivePackages(ctx.activePackages);
        setClientName(ctx.client.name ?? '');
        setClientPhone(ctx.client.phone);
        setPaymentMethod((ctx.group?.paymentMethod ?? 'cash') as PaymentMethod);
        setNotes(ctx.group?.notes ?? ctx.booking.clientNotes ?? '');
        setCompletedBanner(ctx.booking.status === 'completed');
        if (ctx.lastEdit) {
          setLastEditLabel(
            `Last edited ${new Date(ctx.lastEdit.createdAt).toLocaleString('en-SG')}`
          );
        }
        const list = ctx.siblingBookings.length > 0 ? ctx.siblingBookings : [{ booking: ctx.booking }];
        setRows(
          list.map((sib) => ({
            bookingId: sib.booking.id,
            serviceId: sib.booking.serviceId,
            staffId: sib.booking.staffId,
            startTime: sib.booking.startTime,
            priceSgd: sib.booking.priceSgd,
            priceTouched: false,
          }))
        );
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.push('/login');
        else setApiError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => setLoading(false));
  }, [mode, props.bookingId, router, services, staffList]);

  function defaultRow(svc: ServiceOption, st: StaffOption): ServiceRowState {
    const now = new Date();
    return {
      serviceId: svc.id,
      staffId: st.id,
      startTime: now.toISOString(),
      priceSgd: svc.priceSgd,
      priceTouched: false,
    };
  }

  // Submit is wired in Task 19 — placeholder for now
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="fixed inset-0 bg-black/40" onClick={onClose} />
        <div className="relative bg-white rounded-2xl p-6 z-10">Loading…</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 z-10 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-gray-900 mb-1">
          {mode === 'create' ? 'Add Walk-in Booking' : 'Edit Booking'}
        </h2>
        {lastEditLabel && <p className="text-xs text-gray-500 mb-3">{lastEditLabel}</p>}
        {completedBanner && (
          <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-xs text-amber-800">
            This booking is completed. Edits will not re-send review requests or recalculate commissions.
          </div>
        )}
        {apiError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
            {apiError}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Client, sell-package, services, payment, notes, footer — wired in later tasks */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : mode === 'create' ? 'Create Booking' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd glowos/apps/web && pnpm typecheck`
Expected: passes (there will be unused-variable warnings for `setRows`, `setServices`, etc — that's fine; they're wired in Tasks 16–19).

- [ ] **Step 4: Commit**

```bash
git add glowos/apps/web/app/dashboard/bookings/
git commit -m "feat(web): scaffold BookingForm modal"
```

---

## Task 16: Implement `ServiceRow` component

**Files:**
- Create: `glowos/apps/web/app/dashboard/bookings/ServiceRow.tsx`

- [ ] **Step 1: Write the component**

Create `glowos/apps/web/app/dashboard/bookings/ServiceRow.tsx`:

```tsx
'use client';

import type { ServiceOption, StaffOption, ServiceRowState, ActivePackage } from './types';

export interface ServiceRowProps {
  row: ServiceRowState;
  services: ServiceOption[];
  staff: StaffOption[];
  activePackages: ActivePackage[];
  canRemove: boolean;
  onChange: (patch: Partial<ServiceRowState>) => void;
  onRemove: () => void;
  error?: string;
}

export function ServiceRow({
  row,
  services,
  staff,
  activePackages,
  canRemove,
  onChange,
  onRemove,
  error,
}: ServiceRowProps) {
  // A package redemption candidate is one whose pendingSessions includes this serviceId
  const eligiblePackages = activePackages.flatMap((pkg) =>
    pkg.pendingSessions
      .filter((s) => s.serviceId === row.serviceId)
      .map((s) => ({ pkg, session: s }))
  );

  function handleServiceChange(newServiceId: string) {
    const svc = services.find((s) => s.id === newServiceId);
    const patch: Partial<ServiceRowState> = { serviceId: newServiceId };
    if (svc && !row.priceTouched) patch.priceSgd = svc.priceSgd;
    // Drop usePackage if the new service isn't covered by the same session
    if (row.usePackage) {
      const stillValid = activePackages.some((pkg) =>
        pkg.pendingSessions.some(
          (s) =>
            s.id === row.usePackage!.sessionId && s.serviceId === newServiceId
        )
      );
      if (!stillValid) patch.usePackage = undefined;
    }
    onChange(patch);
  }

  function togglePackage() {
    if (row.usePackage) {
      onChange({ usePackage: undefined, priceTouched: false });
      return;
    }
    if (eligiblePackages.length === 0) return;
    const pick = eligiblePackages[0]; // first eligible; a multi-package picker is YAGNI for now
    onChange({
      usePackage: { clientPackageId: pick.pkg.id, sessionId: pick.session.id },
      priceSgd: '0.00',
      priceTouched: false,
    });
  }

  return (
    <div className="rounded-xl border border-gray-200 p-3 space-y-2 bg-gray-50">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select
          value={row.serviceId}
          onChange={(e) => handleServiceChange(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Select service...</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select
          value={row.staffId}
          onChange={(e) => onChange({ staffId: e.target.value })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Select staff...</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="datetime-local"
          value={toLocalInput(row.startTime)}
          onChange={(e) => onChange({ startTime: new Date(e.target.value).toISOString() })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <input
          type="number"
          step="0.01"
          min="0"
          value={row.priceSgd}
          onChange={(e) => onChange({ priceSgd: e.target.value, priceTouched: true })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="flex items-center justify-between">
        {eligiblePackages.length > 0 ? (
          <button
            type="button"
            onClick={togglePackage}
            className={`px-2 py-1 rounded-full text-xs font-medium border ${
              row.usePackage
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50'
            }`}
          >
            {row.usePackage ? '✓ Using package' : 'Use package'}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="text-sm text-red-600 disabled:opacity-30"
          aria-label="Remove service"
        >
          ×
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd glowos/apps/web && pnpm typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add glowos/apps/web/app/dashboard/bookings/ServiceRow.tsx
git commit -m "feat(web): add ServiceRow component"
```

---

## Task 17: Wire BookingForm UI (client row, services list, totals)

**Files:**
- Modify: `glowos/apps/web/app/dashboard/bookings/BookingForm.tsx`

- [ ] **Step 1: Replace the form body**

In `BookingForm.tsx`, replace the `<form ...>` inner markup (leaving the `handleSubmit` intact for now — it'll be wired in Task 19) with:

```tsx
<form onSubmit={handleSubmit} className="space-y-4">
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Client Name</label>
      <input
        type="text"
        value={clientName}
        onChange={(e) => setClientName(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        placeholder="Jane Doe"
        disabled={mode === 'edit'}
      />
    </div>
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
      <input
        type="tel"
        value={clientPhone}
        onChange={(e) => setClientPhone(e.target.value)}
        onBlur={() => void maybeLookupClient()}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        placeholder="+65 9123 4567"
        disabled={mode === 'edit'}
      />
    </div>
  </div>

  <div>
    <label className="block text-sm font-medium text-gray-700 mb-2">Services</label>
    <div className="space-y-2">
      {rows.map((row, i) => (
        <ServiceRow
          key={row.bookingId ?? `new-${i}`}
          row={row}
          services={services}
          staff={staffList}
          activePackages={activePackages}
          canRemove={rows.length > 1}
          onChange={(patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))}
          onRemove={() => setRows(rows.filter((_, j) => j !== i))}
        />
      ))}
    </div>
    <button
      type="button"
      onClick={addServiceRow}
      className="mt-2 text-sm font-medium text-indigo-600 hover:text-indigo-700"
    >
      + Add service
    </button>
  </div>

  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
      <select
        value={paymentMethod}
        onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      >
        <option value="cash">Cash</option>
        <option value="card">Card</option>
        <option value="paynow">PayNow</option>
        <option value="other">Other</option>
      </select>
    </div>
    <div className="flex items-end">
      <div className="w-full rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm">
        <span className="text-gray-500">Total: </span>
        <span className="font-semibold text-gray-900">S${totalPrice.toFixed(2)}</span>
      </div>
    </div>
  </div>

  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
    <textarea
      value={notes}
      onChange={(e) => setNotes(e.target.value)}
      rows={2}
      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
      placeholder="Any special requests..."
    />
  </div>

  <div className="flex gap-3 pt-2">
    <button
      type="button"
      onClick={onClose}
      className="flex-1 rounded-xl border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
    >
      Cancel
    </button>
    <button
      type="submit"
      disabled={saving}
      className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
    >
      {saving ? 'Saving…' : mode === 'create' ? 'Create Booking' : 'Save changes'}
    </button>
  </div>
</form>
```

- [ ] **Step 2: Add the `addServiceRow`, `maybeLookupClient`, and `totalPrice` helpers**

Inside the `BookingForm` component body, **before** `handleSubmit`:

```ts
const totalPrice = rows.reduce((s, r) => s + Number(r.priceSgd || 0), 0);

function addServiceRow() {
  const prev = rows[rows.length - 1];
  const defaultSvc = services[0];
  const defaultStaff = staffList[0];
  if (!defaultSvc || !defaultStaff) return;
  const anchor = prev
    ? new Date(
        new Date(prev.startTime).getTime() +
          (services.find((s) => s.id === prev.serviceId)?.durationMinutes ?? 30) *
            60_000
      ).toISOString()
    : new Date().toISOString();
  setRows([
    ...rows,
    {
      serviceId: defaultSvc.id,
      staffId: defaultStaff.id,
      startTime: anchor,
      priceSgd: defaultSvc.priceSgd,
      priceTouched: false,
    },
  ]);
}

async function maybeLookupClient() {
  // Minimal lookup: only when phone has ≥ 6 chars and we're in create mode
  if (mode !== 'create' || clientPhone.trim().length < 6) return;
  const token = localStorage.getItem('access_token');
  try {
    const res = (await apiFetch(
      `/merchant/clients/lookup?phone=${encodeURIComponent(clientPhone)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )) as {
      client: { id: string; name: string | null } | null;
      activePackages: ActivePackage[];
    };
    if (res.client && !clientName) setClientName(res.client.name ?? '');
    setActivePackages(res.activePackages ?? []);
  } catch {
    // silent — lookup is opportunistic
  }
}
```

- [ ] **Step 3: Add `ServiceRow` import**

At the top:

```ts
import { ServiceRow } from './ServiceRow';
```

- [ ] **Step 4: Typecheck**

Run: `cd glowos/apps/web && pnpm typecheck`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add glowos/apps/web/app/dashboard/bookings/BookingForm.tsx
git commit -m "feat(web): wire BookingForm layout (client, services, payment, total)"
```

---

## Task 18: Add backend `GET /merchant/clients/lookup` endpoint

**Files:**
- Modify: `glowos/services/api/src/routes/clients.ts`

The frontend calls `/merchant/clients/lookup?phone=...` in Task 17; this endpoint does not exist yet. Add it.

- [ ] **Step 1: Inspect existing `clients.ts`**

Open `glowos/services/api/src/routes/clients.ts` and locate the `clientsRouter`. Add the new handler near the top with the other GETs.

- [ ] **Step 2: Implement the handler**

```ts
clientsRouter.get("/lookup", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const rawPhone = c.req.query("phone") ?? "";
  const phone = normalizePhone(rawPhone, "SG");
  if (!phone) return c.json({ client: null, activePackages: [] });

  const [client] = await db
    .select({ id: clients.id, name: clients.name, phone: clients.phone })
    .from(clients)
    .where(eq(clients.phone, phone))
    .limit(1);
  if (!client) return c.json({ client: null, activePackages: [] });

  const active = await db
    .select()
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.clientId, client.id),
        eq(clientPackages.merchantId, merchantId),
        eq(clientPackages.status, "active")
      )
    );
  const pkgIds = active.map((p) => p.id);
  const sessions = pkgIds.length
    ? await db
        .select({
          id: packageSessions.id,
          clientPackageId: packageSessions.clientPackageId,
          serviceId: packageSessions.serviceId,
          sessionNumber: packageSessions.sessionNumber,
        })
        .from(packageSessions)
        .where(
          and(
            inArray(packageSessions.clientPackageId, pkgIds),
            eq(packageSessions.status, "pending")
          )
        )
    : [];

  return c.json({
    client,
    activePackages: active.map((p) => ({
      id: p.id,
      packageName: p.packageName,
      sessionsTotal: p.sessionsTotal,
      sessionsUsed: p.sessionsUsed,
      expiresAt: p.expiresAt,
      pendingSessions: sessions.filter((s) => s.clientPackageId === p.id),
    })),
  });
});
```

Make sure `normalizePhone`, `clientPackages`, `packageSessions`, and `inArray` are imported at the top. If not, add them:

```ts
import { normalizePhone } from "../lib/normalize.js";
import { clientPackages, packageSessions } from "@glowos/db";
import { inArray } from "drizzle-orm";
```

- [ ] **Step 3: Typecheck**

Run: `cd glowos/services/api && pnpm typecheck`
Expected: passes.

- [ ] **Step 4: Manually verify**

```bash
curl -sS "http://localhost:3001/merchant/clients/lookup?phone=+6591111111" \
  -H "Authorization: Bearer $TOKEN" | jq
```
Expected: `{ "client": { ... } | null, "activePackages": [...] }`.

- [ ] **Step 5: Commit**

```bash
git add glowos/services/api/src/routes/clients.ts
git commit -m "feat(api): GET /merchant/clients/lookup for walk-in phone match"
```

---

## Task 19: Wire the BookingForm submit (create + edit)

**Files:**
- Modify: `glowos/apps/web/app/dashboard/bookings/BookingForm.tsx`

- [ ] **Step 1: Flesh out `handleSubmit`**

Replace the existing stub `handleSubmit`:

```tsx
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  setApiError('');
  if (!clientName.trim() || !clientPhone.trim()) {
    setApiError('Client name and phone are required');
    return;
  }
  if (rows.length === 0) {
    setApiError('At least one service is required');
    return;
  }
  if (rows.some((r) => !r.serviceId || !r.staffId || !r.startTime)) {
    setApiError('Each service needs a service, staff, and start time');
    return;
  }

  const token = localStorage.getItem('access_token');
  setSaving(true);
  try {
    if (mode === 'create') {
      await apiFetch('/merchant/bookings/group', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          client_name: clientName,
          client_phone: clientPhone,
          payment_method: paymentMethod,
          notes: notes || undefined,
          services: rows.map((r) => ({
            service_id: r.serviceId,
            staff_id: r.staffId,
            start_time: r.startTime,
            price_sgd: r.priceTouched ? Number(r.priceSgd) : undefined,
            use_package: r.usePackage
              ? { client_package_id: r.usePackage.clientPackageId, session_id: r.usePackage.sessionId }
              : undefined,
          })),
        }),
      });
    } else if (props.groupId) {
      await apiFetch(`/merchant/bookings/group/${props.groupId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          payment_method: paymentMethod,
          notes: notes || null,
          services: rows.map((r) => ({
            booking_id: r.bookingId,
            service_id: r.serviceId,
            staff_id: r.staffId,
            start_time: r.startTime,
            price_sgd: Number(r.priceSgd),
            use_package: r.usePackage
              ? { client_package_id: r.usePackage.clientPackageId, session_id: r.usePackage.sessionId }
              : undefined,
          })),
        }),
      });
    } else if (props.bookingId) {
      // Single non-grouped booking
      const r = rows[0];
      await apiFetch(`/merchant/bookings/${props.bookingId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          service_id: r.serviceId,
          staff_id: r.staffId,
          start_time: r.startTime,
          price_sgd: Number(r.priceSgd),
          payment_method: paymentMethod,
          client_notes: notes || null,
        }),
      });
    }
    onSave();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) router.push('/login');
    else setApiError(err instanceof Error ? err.message : 'Save failed');
  } finally {
    setSaving(false);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd glowos/apps/web && pnpm typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add glowos/apps/web/app/dashboard/bookings/BookingForm.tsx
git commit -m "feat(web): wire BookingForm create + edit submit paths"
```

---

## Task 20: Add inline edit-history view

**Files:**
- Create: `glowos/apps/web/app/dashboard/bookings/EditHistoryPanel.tsx`
- Modify: `glowos/apps/web/app/dashboard/bookings/BookingForm.tsx`

- [ ] **Step 1: Write the panel**

Create `glowos/apps/web/app/dashboard/bookings/EditHistoryPanel.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';

export function EditHistoryPanel({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Array<{
    id: string;
    createdAt: string;
    fieldName: string;
    oldValue: unknown;
    newValue: unknown;
    editedByRole: string;
  }> | null>(null);

  async function toggle() {
    if (open) { setOpen(false); return; }
    if (!rows) {
      const token = localStorage.getItem('access_token');
      const res = (await apiFetch(`/merchant/bookings/${bookingId}/edits`, {
        headers: { Authorization: `Bearer ${token}` },
      })) as { edits: typeof rows };
      setRows(res.edits ?? []);
    }
    setOpen(true);
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={toggle}
        className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
      >
        {open ? 'Hide history' : 'View history'}
      </button>
      {open && rows && (
        <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs space-y-1">
          {rows.length === 0 ? (
            <p className="text-gray-500">No edits yet.</p>
          ) : (
            rows.map((e) => (
              <div key={e.id} className="flex items-baseline gap-2">
                <span className="text-gray-400">
                  {new Date(e.createdAt).toLocaleString('en-SG')}
                </span>
                <span className="font-medium">{e.editedByRole}</span>
                <span>changed <code>{e.fieldName}</code></span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount it in BookingForm (edit mode only)**

In `BookingForm.tsx`, import it:

```ts
import { EditHistoryPanel } from './EditHistoryPanel';
```

And render it after the `lastEditLabel` paragraph in the modal header:

```tsx
{mode === 'edit' && props.bookingId && <EditHistoryPanel bookingId={props.bookingId} />}
```

- [ ] **Step 3: Typecheck**

Run: `cd glowos/apps/web && pnpm typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add glowos/apps/web/app/dashboard/bookings/EditHistoryPanel.tsx glowos/apps/web/app/dashboard/bookings/BookingForm.tsx
git commit -m "feat(web): inline edit-history panel in BookingForm"
```

---

# M6: Dashboard + calendar integration

## Task 21: Swap `WalkInModal` for `BookingForm` in dashboard page

**Files:**
- Modify: `glowos/apps/web/app/dashboard/page.tsx`

- [ ] **Step 1: Replace the import and remove old modal**

Delete the entire `WalkInModal` function (lines ~111–309) and its companion `WalkInForm` interface (lines ~37–45). Add at the top:

```ts
import { BookingForm } from './bookings/BookingForm';
```

- [ ] **Step 2: Update the state + JSX to use BookingForm**

Change the existing `{showWalkIn && (...)}` JSX at the bottom to:

```tsx
{showWalkIn && (
  <BookingForm
    mode="create"
    services={services as unknown as import('./bookings/types').ServiceOption[]}
    staffList={staffList}
    onClose={() => setShowWalkIn(false)}
    onSave={() => {
      setShowWalkIn(false);
      void fetchBookings();
    }}
  />
)}
```

Because `BookingForm` expects richer `ServiceOption` fields (price, duration, buffer), replace the local type imports at the top of `page.tsx`:

```ts
import type { ServiceOption, StaffOption } from './bookings/types';
```

Delete the local `ServiceOption` and `StaffOption` interface declarations inside `page.tsx`. **No API change is needed** — `GET /merchant/services` already does `.select()` without projection, so the existing response already carries `priceSgd`, `durationMinutes`, `bufferMinutes`. Only the TypeScript assertion on the `apiFetch('/merchant/services', ...)` call needs to resolve to the new richer `ServiceOption` from `./bookings/types`.

- [ ] **Step 3: Typecheck**

Run: `cd glowos/apps/web && pnpm typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add glowos/apps/web/app/dashboard/page.tsx
git commit -m "feat(web): dashboard uses BookingForm for walk-in create"
```

---

## Task 22: Add Edit button to booking cards

**Files:**
- Modify: `glowos/apps/web/app/dashboard/page.tsx`

- [ ] **Step 1: Add state + handler**

Inside `DashboardPage`, add:

```ts
const [editTarget, setEditTarget] = useState<{ bookingId: string; groupId: string | null } | null>(null);
```

- [ ] **Step 2: Add the Edit button in `BookingCard`**

Update the `BookingCard` props to accept an `onEdit` callback. The existing `page.tsx` has a `{(canCheckIn || canComplete || canNoShow) && ( ... )}` conditional wrapping the action-buttons div. Replace that conditional with an always-on wrapper that includes the Edit button alongside the existing ones:

```tsx
{booking.status !== 'cancelled' && (
  <div className="flex gap-1.5 flex-shrink-0">
    <button
      onClick={() => onEdit(booking.id)}
      className="px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200"
      aria-label="Edit booking"
    >
      Edit
    </button>
    {canCheckIn && (
      <button
        onClick={() => handleAction('check-in')}
        disabled={acting !== null}
        className="px-2.5 py-1 rounded-lg text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50 transition-colors border border-green-200"
      >
        {acting === 'check-in' ? '...' : 'Check In'}
      </button>
    )}
    {canComplete && (
      <button
        onClick={() => handleAction('complete')}
        disabled={acting !== null}
        className="px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors border border-blue-200"
      >
        {acting === 'complete' ? '...' : 'Complete'}
      </button>
    )}
    {canNoShow && (
      <button
        onClick={() => handleAction('no-show')}
        disabled={acting !== null}
        className="px-2.5 py-1 rounded-lg text-xs font-medium bg-orange-50 text-orange-700 hover:bg-orange-100 disabled:opacity-50 transition-colors border border-orange-200"
      >
        {acting === 'no-show' ? '...' : 'No-Show'}
      </button>
    )}
  </div>
)}
```

And in the parent list rendering, wire the callback:

```tsx
<BookingCard
  key={row.booking.id}
  row={row}
  onAction={handleAction}
  onEdit={(bookingId) => setEditTarget({ bookingId, groupId: null /* will be refined on load */ })}
/>
```

Extend `BookingCard` props with `onEdit: (bookingId: string) => void;`.

- [ ] **Step 3: Mount a second BookingForm instance for edit**

Append to the JSX alongside the existing walk-in modal:

```tsx
{editTarget && (
  <BookingForm
    mode="edit"
    bookingId={editTarget.bookingId}
    onClose={() => setEditTarget(null)}
    onSave={() => {
      setEditTarget(null);
      void fetchBookings();
    }}
  />
)}
```

Note: `BookingForm` reads the booking's `groupId` from the edit-context response; the parent does not need to know it up front. That's why `groupId` in `editTarget` is left `null` here — the form resolves the right PATCH endpoint internally.

- [ ] **Step 4: Pass groupId to PATCH inside BookingForm**

Currently `BookingForm.handleSubmit` checks `props.groupId` to decide between group-PATCH vs single-PATCH. Since `page.tsx` no longer supplies it, `BookingForm` must derive it from the loaded context. Update the edit-context loader in `BookingForm.tsx`:

```ts
// In the useEffect loader, after setServices/setStaffList:
if (ctx.group) {
  // Stash the group id on local state
  setResolvedGroupId(ctx.group.id);
} else {
  setResolvedGroupId(null);
}
```

Add the state:

```ts
const [resolvedGroupId, setResolvedGroupId] = useState<string | null>(props.groupId ?? null);
```

And update `handleSubmit` to use `resolvedGroupId` instead of `props.groupId`.

- [ ] **Step 5: Typecheck**

Run: `cd glowos/apps/web && pnpm typecheck`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add glowos/apps/web/app/dashboard/page.tsx glowos/apps/web/app/dashboard/bookings/BookingForm.tsx
git commit -m "feat(web): edit button on booking cards opens BookingForm"
```

---

## Task 23: Wire double-click edit on the calendar page

**Files:**
- Modify: `glowos/apps/web/app/dashboard/calendar/page.tsx`

- [ ] **Step 1: Inspect the calendar page to find the booking-slot render**

Open the file and grep for the element that renders a single booking slot (likely inside a `.map((booking) => ...)` block). Note its `onClick` or related handler.

- [ ] **Step 2: Add double-click handler + BookingForm mount**

At the top of the component, add:

```ts
import { BookingForm } from '../bookings/BookingForm';
const [editBookingId, setEditBookingId] = useState<string | null>(null);
```

On the existing booking-slot JSX element, add:

```tsx
onDoubleClick={() => setEditBookingId(booking.id)}
```

And at the bottom of the component JSX:

```tsx
{editBookingId && (
  <BookingForm
    mode="edit"
    bookingId={editBookingId}
    onClose={() => setEditBookingId(null)}
    onSave={() => {
      setEditBookingId(null);
      // If the calendar page has a refetch fn, call it here.
      // Otherwise, reload:
      window.location.reload();
    }}
  />
)}
```

If the calendar page already has a refetch function, use it in place of `window.location.reload()`.

- [ ] **Step 3: Typecheck**

Run: `cd glowos/apps/web && pnpm typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add glowos/apps/web/app/dashboard/calendar/page.tsx
git commit -m "feat(web): double-click calendar slot opens BookingForm in edit mode"
```

---

## Task 24: Add "Sell a package" disclosure to BookingForm (create mode)

**Files:**
- Modify: `glowos/apps/web/app/dashboard/bookings/BookingForm.tsx`

The API already supports `sell_package` in the create body (Task 6). This task wires the UI.

- [ ] **Step 1: Load package templates on mount (create mode)**

Inside `BookingForm`, add state + fetch:

```ts
const [packageTemplates, setPackageTemplates] = useState<Array<{ id: string; name: string; priceSgd: string }>>([]);
const [sellPackageId, setSellPackageId] = useState<string>('');
const [sellOpen, setSellOpen] = useState(false);
```

Extend the existing `useEffect` loader — in the **create-mode branch** (where `mode !== 'edit'`), fetch templates once:

```ts
const token = localStorage.getItem('access_token');
apiFetch('/merchant/packages', { headers: { Authorization: `Bearer ${token}` } })
  .then((data) => {
    const res = data as { packages: Array<{ id: string; name: string; priceSgd: string; isActive: boolean }> };
    setPackageTemplates(res.packages.filter((p) => p.isActive));
  })
  .catch(() => {}); // silent; feature is optional
```

- [ ] **Step 2: Render the disclosure in the form**

Insert **between** the "Services" block and the "Payment Method" block in the JSX (create mode only):

```tsx
{mode === 'create' && packageTemplates.length > 0 && (
  <div className="rounded-lg border border-dashed border-gray-300 px-3 py-2">
    <button
      type="button"
      onClick={() => setSellOpen(!sellOpen)}
      className="text-sm font-medium text-indigo-600"
    >
      {sellOpen ? '− Don\'t sell a package' : '+ Also sell a package'}
    </button>
    {sellOpen && (
      <div className="mt-2">
        <select
          value={sellPackageId}
          onChange={(e) => setSellPackageId(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Select package to sell...</option>
          {packageTemplates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} (S${p.priceSgd})
            </option>
          ))}
        </select>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 3: Include `sell_package` in the create POST body**

In `handleSubmit`, in the `mode === 'create'` branch, add `sell_package` to the body:

```ts
body: JSON.stringify({
  client_name: clientName,
  client_phone: clientPhone,
  payment_method: paymentMethod,
  notes: notes || undefined,
  services: /* ... unchanged ... */,
  sell_package: sellPackageId ? { package_id: sellPackageId } : undefined,
}),
```

- [ ] **Step 4: Typecheck**

Run: `cd glowos/apps/web && pnpm typecheck`
Expected: passes.

- [ ] **Step 5: Manually verify**

Create a walk-in; expand "Also sell a package"; pick one; save.
Check: `SELECT id, package_name FROM client_packages WHERE client_id = '<CLIENT_ID>' ORDER BY created_at DESC LIMIT 1;` shows the new package.

- [ ] **Step 6: Commit**

```bash
git add glowos/apps/web/app/dashboard/bookings/BookingForm.tsx
git commit -m "feat(web): 'Also sell a package' disclosure in BookingForm"
```

---

## Task 25: Manual UI smoke test

- [ ] **Step 1: Walk-in create, 1 service**

Dashboard → Add Walk-in → fill → Save. Expected: booking appears on the dashboard.

- [ ] **Step 2: Walk-in create, 3 services + package redemption**

Create a client with a 3-session package via `/dashboard/clients/[id]` (or whatever existing UI). Open walk-in. Fill phone, see active-package info load. Add 3 service rows; tap "Use package" on one. Save. Expected: 3 bookings on dashboard; package has 1 session consumed.

- [ ] **Step 3: Edit a confirmed booking (change service)**

Click Edit on a confirmed booking. Change service. Save. Expected: card reflects new service + new price.

- [ ] **Step 4: Edit a completed booking**

Complete a booking, then click Edit. Expected: amber "completed" notice; saving works.

- [ ] **Step 5: Edit a grouped booking (remove one of two services)**

Click Edit on a booking that has a sibling. Remove the other one via the × button. Save. Expected: only one booking remains on the dashboard; total reflects removal.

- [ ] **Step 6: Calendar double-click**

Open `/dashboard/calendar`, double-click a booking slot. Expected: BookingForm opens in edit mode.

- [ ] **Step 7: Audit trail**

Open the edit modal, click "View history". Expected: list of edits from Steps 3–5.

No commit — verification checkpoint.

---

# M7: Polish

## Task 26: CLAUDE.md note and final commit

**Files:**
- Create or modify: `glowos/apps/web/app/dashboard/CLAUDE.md`

- [ ] **Step 1: Check if the file exists**

Run: `ls glowos/apps/web/app/dashboard/CLAUDE.md 2>/dev/null`

- [ ] **Step 2: Add or create the note**

If it exists, append the following section. If it doesn't, create it with this content:

```markdown
# Dashboard conventions

## Booking create & edit UI

`app/dashboard/bookings/BookingForm.tsx` is the single source of truth for
booking create and edit UI. Do not create new walk-in or edit modals — extend
this one. It handles:

- Multi-service walk-ins (parent: `booking_groups`; children: `bookings`)
- Package redemption via the existing `package_sessions` table
- Editing any booking status except `cancelled` (including `completed`)
- Per-field audit logging via `booking_edits`

Endpoints:
- `POST   /merchant/bookings/group` — create group walk-in
- `GET    /merchant/bookings/:id/edit-context` — load edit modal data
- `PATCH  /merchant/bookings/group/:groupId` — edit a grouped booking
- `PATCH  /merchant/bookings/:id` — edit a non-grouped booking
- `GET    /merchant/bookings/:id/edits` — audit trail
```

- [ ] **Step 3: Commit**

```bash
git add glowos/apps/web/app/dashboard/CLAUDE.md
git commit -m "docs: note BookingForm as single source of truth for booking UI"
```

---

## Done

All M1–M7 tasks complete. The feature is live and backward compatible with pre-existing bookings.
