# Atomic Package Sell + Redeem and Activity Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let merchants sell a package and redeem session(s) from it in a single walk-in transaction, correctly account for the collected revenue on the booking group, and surface a package activity view on the client detail page.

**Architecture:** Additive. One new column on `booking_groups` (`package_price_sgd`). Reorder the existing POST group transaction so the sold package's sessions are created before the booking-insert loop, then consumed from an in-memory pool for rows flagged `use_new_package`. Frontend `BookingForm` gets a per-row pill for new-package redemption, a capacity header, and a Services/Package/Total breakdown. Client detail page adds an activity timeline plus an expandable per-package session list.

**Tech Stack:** Drizzle ORM + PostgreSQL, Hono + Zod (API), Next.js 15 App Router (web), date-fns, Tailwind CSS.

**Spec:** [docs/superpowers/specs/2026-04-20-atomic-package-sell-redeem-and-tracking-design.md](../specs/2026-04-20-atomic-package-sell-redeem-and-tracking-design.md)

**Project testing convention:** The repo has no automated test framework (see walk-in-group plan, Session 13). Tasks use **typecheck + manual curl + manual UI verification**. Every task ends with `pnpm -w typecheck` (or the package-local equivalent) before commit.

---

## File Map

### Modified files (backend)

- `glowos/packages/db/src/schema/booking-groups.ts` — add `packagePriceSgd` column
- `glowos/packages/db/src/migrations/0011_booking_groups_package_price.sql` — new migration
- `glowos/services/api/src/routes/booking-groups.ts` — extend POST schema, reorder transaction, add `use_new_package` support, update PATCH recompute
- `glowos/services/api/src/routes/packages.ts` — join `services` for session `serviceName`

### Modified files (frontend)

- `glowos/apps/web/app/dashboard/bookings/types.ts` — extend `ServiceRowState`, add sold-package template shape
- `glowos/apps/web/app/dashboard/bookings/ServiceRow.tsx` — new "Redeem from new package" pill with capacity disable
- `glowos/apps/web/app/dashboard/bookings/BookingForm.tsx` — capacity header, total breakdown, wire submission, pass sold-package template down
- `glowos/apps/web/app/dashboard/clients/[id]/page.tsx` — activity timeline + expandable sessions table

### Docs

- `progress.md` — Session 14 summary

---

## Milestones

- **M1 (Tasks 1–3):** Schema + migration for `package_price_sgd`.
- **M2 (Tasks 4–10):** POST group — atomic buy+redeem.
- **M3 (Task 11):** PATCH group — correct `totalPriceSgd` recompute.
- **M4 (Task 12):** Service name in packages client endpoint.
- **M5 (Tasks 13–18):** BookingForm + ServiceRow UI.
- **M6 (Tasks 19–20):** Client detail activity view.
- **M7 (Tasks 21–22):** End-to-end verification + progress.md.

---

# M1: Schema + migration

### Task 1: Add `packagePriceSgd` column to Drizzle schema

**Files:**
- Modify: `glowos/packages/db/src/schema/booking-groups.ts:26`

- [ ] **Step 1: Edit the schema**

Add `packagePriceSgd` right after `totalPriceSgd`:

```ts
totalPriceSgd: numeric("total_price_sgd", { precision: 10, scale: 2 }).notNull(),
packagePriceSgd: numeric("package_price_sgd", { precision: 10, scale: 2 })
  .notNull()
  .default("0"),
paymentMethod: varchar("payment_method", { length: 20 })
  .notNull()
  .$type<"cash" | "card" | "paynow" | "other">(),
```

- [ ] **Step 2: Typecheck**

Run: `cd glowos/packages/db && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add glowos/packages/db/src/schema/booking-groups.ts
git commit -m "feat(db): add booking_groups.package_price_sgd column"
```

### Task 2: Write SQL migration 0011

**Files:**
- Create: `glowos/packages/db/src/migrations/0011_booking_groups_package_price.sql`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE "booking_groups"
  ADD COLUMN "package_price_sgd" numeric(10, 2) NOT NULL DEFAULT '0';
```

- [ ] **Step 2: Commit**

```bash
git add glowos/packages/db/src/migrations/0011_booking_groups_package_price.sql
git commit -m "feat(db): migration 0011 for package_price_sgd"
```

### Task 3: Apply migration on Neon

**Files:** none — DB only.

- [ ] **Step 1: Apply via direct pg script (Session 13 pattern)**

Per [progress.md Session 13 note](../../progress.md): `drizzle.__drizzle_migrations` tracking table is empty. Apply manually.

Run from repo root:
```bash
cd glowos/packages/db && \
  node -e "const { Client } = require('pg'); (async () => { \
    const c = new Client({ connectionString: process.env.DATABASE_URL }); \
    await c.connect(); \
    const sql = require('fs').readFileSync('src/migrations/0011_booking_groups_package_price.sql', 'utf8'); \
    await c.query(sql); \
    console.log('0011 applied'); \
    await c.end(); \
  })();"
```

Expected output: `0011 applied`

- [ ] **Step 2: Verify the column exists**

```bash
cd glowos/packages/db && \
  node -e "const { Client } = require('pg'); (async () => { \
    const c = new Client({ connectionString: process.env.DATABASE_URL }); \
    await c.connect(); \
    const r = await c.query(\"SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='booking_groups' AND column_name='package_price_sgd'\"); \
    console.log(r.rows); \
    await c.end(); \
  })();"
```

Expected: one row with `data_type=numeric`, `is_nullable=NO`, `column_default=0`.

- [ ] **Step 3: Confirm existing rows got the default**

```bash
cd glowos/packages/db && \
  node -e "const { Client } = require('pg'); (async () => { \
    const c = new Client({ connectionString: process.env.DATABASE_URL }); \
    await c.connect(); \
    const r = await c.query('SELECT COUNT(*) FROM booking_groups WHERE package_price_sgd IS NULL'); \
    console.log('null count:', r.rows[0].count); \
    await c.end(); \
  })();"
```

Expected: `null count: 0`.

---

# M2: POST `/merchant/bookings/group` — atomic buy+redeem

### Task 4: Extend `serviceItemSchema` with `use_new_package`

**Files:**
- Modify: `glowos/services/api/src/routes/booking-groups.ts:30-42`

- [ ] **Step 1: Replace the schema**

Replace the existing `serviceItemSchema` definition with:

```ts
const serviceItemSchema = z
  .object({
    booking_id: z.string().uuid().optional(),
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
    use_new_package: z.boolean().optional(),
  })
  .refine((v) => !(v.use_package && v.use_new_package), {
    message: "cannot combine use_package and use_new_package on one row",
  });
```

- [ ] **Step 2: Typecheck**

Run: `cd glowos/services/api && pnpm tsc --noEmit`
Expected: no errors (the field is optional; the handler still compiles).

- [ ] **Step 3: Commit**

```bash
git add glowos/services/api/src/routes/booking-groups.ts
git commit -m "feat(api): add use_new_package flag to serviceItemSchema"
```

### Task 5: Add pre-tx validation for `use_new_package` rows

**Files:**
- Modify: `glowos/services/api/src/routes/booking-groups.ts:140-163` (region right before the transaction)

- [ ] **Step 1: Add validation block**

Immediately BEFORE the `// Validate package sessions (must be pending...)` block (around line 142), insert:

```ts
    // Validate use_new_package rows: require sell_package in same request,
    // and require the row's service to be included in the sold package.
    if (body.services.some((s) => s.use_new_package)) {
      if (!body.sell_package) {
        return c.json(
          { error: "Bad Request", message: "use_new_package requires sell_package in same request" },
          400
        );
      }
      // Load the package template once to validate includedServices
      const [soldTemplate] = await db
        .select({ includedServices: servicePackages.includedServices })
        .from(servicePackages)
        .where(
          and(
            eq(servicePackages.id, body.sell_package.package_id),
            eq(servicePackages.merchantId, merchantId)
          )
        )
        .limit(1);
      if (!soldTemplate) {
        return c.json({ error: "Not Found", message: "Package template not found" }, 404);
      }
      const includedServiceIds = new Set(
        soldTemplate.includedServices.map((s) => s.serviceId)
      );
      for (const s of body.services) {
        if (s.use_new_package && !includedServiceIds.has(s.service_id)) {
          return c.json(
            {
              error: "Bad Request",
              message: `Service ${s.service_id} is not included in the sold package`,
            },
            400
          );
        }
      }
    }
```

- [ ] **Step 2: Typecheck**

Run: `cd glowos/services/api && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add glowos/services/api/src/routes/booking-groups.ts
git commit -m "feat(api): pre-tx validation for use_new_package rows"
```

### Task 6: Reorder transaction — move `sell_package` insert BEFORE bookings loop

**Files:**
- Modify: `glowos/services/api/src/routes/booking-groups.ts:170-284` (the transaction body)

- [ ] **Step 1: Extract the sell-package block into a helper run at top of tx**

Replace the transaction body starting at `result = await db.transaction(async (tx) => {` and ending at `return { group, bookings: inserted, soldPackage };` with the reordered version. The key change: the whole `sell_package` block (today at lines 230–281) moves up to just after the `client_profiles` ensure, and produces both `soldPackage` and a `soldPool: Map<serviceId, sessionId[]>`.

Replace the transaction body (approximately lines 170-284) with:

```ts
      result = await db.transaction(async (tx) => {
        const [group] = await tx
          .insert(bookingGroups)
          .values({
            merchantId,
            clientId: client.id,
            // Preliminary — we'll UPDATE this at the end of the tx.
            totalPriceSgd: "0",
            packagePriceSgd: "0",
            paymentMethod: body.payment_method,
            notes: body.notes ?? null,
            createdByUserId: userId,
          })
          .returning();

        // Ensure client_profile exists for this merchant
        const [profileExisting] = await tx
          .select({ id: clientProfiles.id })
          .from(clientProfiles)
          .where(and(eq(clientProfiles.merchantId, merchantId), eq(clientProfiles.clientId, client.id)))
          .limit(1);
        if (!profileExisting) {
          await tx.insert(clientProfiles).values({ merchantId, clientId: client.id });
        }

        // Sell package FIRST (before bookings) so new-package redemptions can
        // reference the sessions. Empty pool if no package is being sold.
        let soldPackage: typeof clientPackages.$inferSelect | null = null;
        let soldPackagePrice = 0;
        const soldPool = new Map<string, string[]>(); // serviceId -> [sessionId, ...]
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
          soldPackagePrice = Number(pricePaid);
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
          let insertedSessions: Array<{ id: string; serviceId: string }> = [];
          if (sessionValues.length > 0) {
            insertedSessions = await tx
              .insert(packageSessions)
              .values(sessionValues)
              .returning({ id: packageSessions.id, serviceId: packageSessions.serviceId });
          }
          for (const s of insertedSessions) {
            if (!soldPool.has(s.serviceId)) soldPool.set(s.serviceId, []);
            soldPool.get(s.serviceId)!.push(s.id);
          }
          soldPackage = clientPkg;
        }

        const inserted = [];
        for (let i = 0; i < plan.length; i++) {
          const p = plan[i];
          const row = body.services[i]; // same length, same order as `plan`
          let redeemSessionId: string | undefined;
          let redeemClientPackageId: string | undefined;
          if (row.use_new_package) {
            const pool = soldPool.get(row.service_id);
            if (!pool || pool.length === 0) {
              throw new Error("new_package_capacity_exceeded");
            }
            redeemSessionId = pool.shift()!;
            redeemClientPackageId = soldPackage!.id;
          } else if (row.use_package) {
            redeemSessionId = row.use_package.session_id;
            redeemClientPackageId = row.use_package.client_package_id;
          }

          const effectivePrice = redeemSessionId ? "0.00" : p.priceSgd;

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
              priceSgd: effectivePrice,
              paymentMethod: body.payment_method,
              bookingSource: "walkin_manual",
              commissionRate: "0",
              commissionSgd: "0",
              groupId: group.id,
            })
            .returning();
          inserted.push(b);

          if (redeemSessionId && redeemClientPackageId) {
            await tx
              .update(packageSessions)
              .set({
                status: "completed",
                completedAt: new Date(),
                bookingId: b.id,
                staffId: p.staffId,
              })
              .where(eq(packageSessions.id, redeemSessionId));
            await incrementPackageSessionsUsed(tx, redeemClientPackageId);
          }
        }

        // Compute and persist correct totals
        const bookingsTotal = inserted.reduce((s, b) => s + Number(b.priceSgd), 0);
        const grandTotal = (bookingsTotal + soldPackagePrice).toFixed(2);
        const packageTotal = soldPackagePrice.toFixed(2);
        await tx
          .update(bookingGroups)
          .set({ totalPriceSgd: grandTotal, packagePriceSgd: packageTotal })
          .where(eq(bookingGroups.id, group.id));

        // Re-fetch sold-package sessions so the response reflects final statuses
        let soldPackageResp: unknown = null;
        if (soldPackage) {
          const sessions = await tx
            .select({
              id: packageSessions.id,
              serviceId: packageSessions.serviceId,
              sessionNumber: packageSessions.sessionNumber,
              status: packageSessions.status,
              bookingId: packageSessions.bookingId,
            })
            .from(packageSessions)
            .where(eq(packageSessions.clientPackageId, soldPackage.id))
            .orderBy(packageSessions.sessionNumber);
          soldPackageResp = { ...soldPackage, sessions };
        }

        return {
          group: { ...group, totalPriceSgd: grandTotal, packagePriceSgd: packageTotal },
          bookings: inserted,
          soldPackage: soldPackageResp,
        };
      });
```

Note: the existing `plan` array is still built (the block at lines 107-140) and the package-session validation at lines 143-163 still runs — both unchanged. Only the transaction body is replaced.

- [ ] **Step 2: Typecheck**

Run: `cd glowos/services/api && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add glowos/services/api/src/routes/booking-groups.ts
git commit -m "feat(api): reorder POST group tx to support atomic sell+redeem"
```

### Task 7: Add error handler for `new_package_capacity_exceeded`

**Files:**
- Modify: `glowos/services/api/src/routes/booking-groups.ts:285-290` (the `catch` block after the transaction)

- [ ] **Step 1: Extend the catch block**

Replace the existing `catch` block:

```ts
    } catch (err) {
      if (err instanceof Error && err.message === "sell_package_not_found") {
        return c.json({ error: "Not Found", message: "Package template not found" }, 404);
      }
      if (err instanceof Error && err.message === "new_package_capacity_exceeded") {
        return c.json(
          { error: "Bad Request", message: "More rows flagged use_new_package than the package allows for that service" },
          400
        );
      }
      throw err;
    }
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd glowos/services/api && pnpm tsc --noEmit
git add glowos/services/api/src/routes/booking-groups.ts
git commit -m "feat(api): 400 when use_new_package exceeds package capacity"
```

### Task 8: Sanity-check by running the API locally

**Files:** none — runtime check.

- [ ] **Step 1: Boot the API in dev mode**

```bash
cd glowos/services/api && pnpm dev
```

Keep it running in another terminal. Verify the server comes up without schema/type errors.

- [ ] **Step 2: Stop the server**

Ctrl-C. This is a smoke test only — manual curl happens in Task 10.

### Task 9: (intentionally merged with Task 6; skip — kept for numbering continuity)

Skip. The response shape was updated as part of Task 6.

### Task 10: Manual curl verification — buy+redeem flow

**Files:** none — API verification.

- [ ] **Step 1: Boot API**

```bash
cd glowos/services/api && pnpm dev
```

- [ ] **Step 2: Export the merchant token and IDs needed**

Get a merchant token via the existing login flow or reuse one from your session. Then:

```bash
export TOKEN="<merchant access token>"
export API="http://localhost:8787"
# Pick a service_id included in your test package, a staff_id, and a package_id to sell
export SERVICE_ID="..."
export STAFF_ID="..."
export PACKAGE_ID="..."
```

- [ ] **Step 3: Scenario A — sell-only, no redemption**

```bash
curl -s -X POST "$API/merchant/bookings/group" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @- <<EOF | jq
{
  "client_name": "Test A",
  "client_phone": "+6590000001",
  "payment_method": "cash",
  "services": [
    { "service_id": "$SERVICE_ID", "staff_id": "$STAFF_ID" }
  ],
  "sell_package": { "package_id": "$PACKAGE_ID" }
}
EOF
```

Expected: 201 with `group.totalPriceSgd = <service price + package price>`, `group.packagePriceSgd = <package price>`, `soldPackage.sessions` all pending.

- [ ] **Step 4: Scenario B — sell + redeem one session today**

```bash
curl -s -X POST "$API/merchant/bookings/group" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @- <<EOF | jq
{
  "client_name": "Test B",
  "client_phone": "+6590000002",
  "payment_method": "cash",
  "services": [
    { "service_id": "$SERVICE_ID", "staff_id": "$STAFF_ID", "use_new_package": true }
  ],
  "sell_package": { "package_id": "$PACKAGE_ID" }
}
EOF
```

Expected: 201, `bookings[0].priceSgd = "0.00"`, `soldPackage.sessions` has one `completed` (with `bookingId` set) and the rest `pending`, `group.totalPriceSgd = <package price>`.

- [ ] **Step 5: Scenario C — rejection when use_new_package without sell_package**

```bash
curl -s -X POST "$API/merchant/bookings/group" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "client_name": "Test C",
  "client_phone": "+6590000003",
  "payment_method": "cash",
  "services": [
    { "service_id": "$SERVICE_ID", "staff_id": "$STAFF_ID", "use_new_package": true }
  ]
}
EOF
```

Expected: 400 `"use_new_package requires sell_package in same request"`.

- [ ] **Step 6: Scenario D — rejection when row service not in sold package**

Pick a `SERVICE_ID_NOT_IN_PACKAGE` — any service the merchant has that is NOT in `includedServices` of `PACKAGE_ID`.

```bash
curl -s -X POST "$API/merchant/bookings/group" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "client_name": "Test D",
  "client_phone": "+6590000004",
  "payment_method": "cash",
  "services": [
    { "service_id": "$SERVICE_ID_NOT_IN_PACKAGE", "staff_id": "$STAFF_ID", "use_new_package": true }
  ],
  "sell_package": { "package_id": "$PACKAGE_ID" }
}
EOF
```

Expected: 400 `"Service ... is not included in the sold package"`.

- [ ] **Step 7: Scenario E — rejection when combining use_package and use_new_package**

Send both flags on one row. Expected: 400 with the refine message `"cannot combine use_package and use_new_package on one row"`.

- [ ] **Step 8: Stop API, commit if any fixups needed**

If Scenarios A–E all pass, no commit needed (implementation is good). If any scenario fails, make the minimal fix and commit `fix(api): <describe>` then re-run.

---

# M3: PATCH group — totalPriceSgd recompute fix

### Task 11: Include `packagePriceSgd` when PATCH recomputes the group total

**Files:**
- Modify: `glowos/services/api/src/routes/booking-groups.ts:582-612` (the PATCH group tx section that recomputes `newTotal`)

- [ ] **Step 1: Replace the newTotal computation**

Find the section:

```ts
      const remaining = await tx
        .select({ price: bookings.priceSgd })
        .from(bookings)
        .where(eq(bookings.groupId, groupId));
      const newTotal = remaining.reduce((s, r) => s + Number(r.price), 0).toFixed(2);
```

Replace with:

```ts
      const remaining = await tx
        .select({ price: bookings.priceSgd })
        .from(bookings)
        .where(eq(bookings.groupId, groupId));
      const bookingsSum = remaining.reduce((s, r) => s + Number(r.price), 0);
      // Use the already-stored packagePriceSgd — PATCH never modifies it.
      const newTotal = (bookingsSum + Number(group.packagePriceSgd)).toFixed(2);
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd glowos/services/api && pnpm tsc --noEmit
git add glowos/services/api/src/routes/booking-groups.ts
git commit -m "fix(api): PATCH group total includes stored packagePriceSgd"
```

- [ ] **Step 3: Quick verification**

Using the booking group from Scenario B (Task 10, Step 4), PATCH its services (e.g., send the same services back). The returned group's `totalPriceSgd` should still equal `<package price> + 0` (same as before the edit). Before this fix, the returned total would have dropped to `$0`.

```bash
export GROUP_ID="<group id from Scenario B>"
curl -s -X PATCH "$API/merchant/bookings/group/$GROUP_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @- <<EOF | jq
{
  "payment_method": "cash",
  "services": [ { "booking_id": "<child booking id>", "service_id": "$SERVICE_ID", "staff_id": "$STAFF_ID" } ]
}
EOF
```

Then verify `SELECT total_price_sgd, package_price_sgd FROM booking_groups WHERE id=$GROUP_ID`. Expected: `total_price_sgd = <package price>`, `package_price_sgd = <package price>`.

---

# M4: GET `/merchant/packages/client/:clientId` — include service names

### Task 12: Join `services` for each session so the UI gets `serviceName`

**Files:**
- Modify: `glowos/services/api/src/routes/packages.ts:137-165`

- [ ] **Step 1: Replace the handler body**

Replace the existing handler (lines 138-165) with a version that joins `services` on session:

```ts
packagesRouter.get("/client/:clientId", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const clientId = c.req.param("clientId")!;

  const pkgs = await db
    .select()
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.merchantId, merchantId),
        eq(clientPackages.clientId, clientId)
      )
    )
    .orderBy(desc(clientPackages.purchasedAt));

  const result = [];
  for (const pkg of pkgs) {
    const sessions = await db
      .select({
        id: packageSessions.id,
        sessionNumber: packageSessions.sessionNumber,
        serviceId: packageSessions.serviceId,
        serviceName: services.name,
        status: packageSessions.status,
        bookingId: packageSessions.bookingId,
        staffId: packageSessions.staffId,
        staffName: packageSessions.staffName,
        completedAt: packageSessions.completedAt,
      })
      .from(packageSessions)
      .leftJoin(services, eq(packageSessions.serviceId, services.id))
      .where(eq(packageSessions.clientPackageId, pkg.id))
      .orderBy(packageSessions.sessionNumber);
    result.push({ ...pkg, sessions });
  }

  return c.json({ packages: result });
});
```

Ensure `services` is imported in the file (check existing imports; add if missing).

- [ ] **Step 2: Typecheck + commit**

```bash
cd glowos/services/api && pnpm tsc --noEmit
git add glowos/services/api/src/routes/packages.ts
git commit -m "feat(api): return serviceName on package session response"
```

- [ ] **Step 3: Spot-check**

Boot API, fetch packages for a known client:

```bash
curl -s "$API/merchant/packages/client/<client_id>" \
  -H "Authorization: Bearer $TOKEN" | jq '.packages[0].sessions[0]'
```

Expected: the session object includes `serviceName` (string or null).

---

# M5: Frontend — BookingForm + ServiceRow

### Task 13: Add `useNewPackage` to `ServiceRowState` + new types

**Files:**
- Modify: `glowos/apps/web/app/dashboard/bookings/types.ts`

- [ ] **Step 1: Edit the types file**

Add two items — extend `ServiceRowState` and add `SoldPackageTemplate`:

```ts
export interface ServiceRowState {
  bookingId?: string;
  serviceId: string;
  staffId: string;
  startTime: string;
  priceSgd: string;
  priceTouched: boolean;
  usePackage?: { clientPackageId: string; sessionId: string };
  useNewPackage?: boolean;
}

export interface SoldPackageTemplate {
  id: string;
  name: string;
  priceSgd: string;
  includedServices: Array<{ serviceId: string; serviceName: string; quantity: number }>;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd glowos/apps/web && pnpm tsc --noEmit`
Expected: no errors yet (consumers of `ServiceRowState` treat `useNewPackage` as optional).

- [ ] **Step 3: Commit**

```bash
git add glowos/apps/web/app/dashboard/bookings/types.ts
git commit -m "feat(web): ServiceRowState.useNewPackage + SoldPackageTemplate"
```

### Task 14: Load full package template details in BookingForm

**Files:**
- Modify: `glowos/apps/web/app/dashboard/bookings/BookingForm.tsx:45-60` (around `packageTemplates` state)

- [ ] **Step 1: Enrich the fetched package templates**

The existing fetch sets `setPackageTemplates(res.packages.filter((p) => p.isActive))`. Change the shape to include `includedServices`. Replace the type + setter:

```ts
const [packageTemplates, setPackageTemplates] = useState<
  Array<{
    id: string;
    name: string;
    priceSgd: string;
    isActive: boolean;
    includedServices: Array<{ serviceId: string; serviceName: string; quantity: number }>;
  }>
>([]);
```

The `/merchant/packages` endpoint already returns `includedServices` on each package (confirmed in `packages.ts`). Cast the response type accordingly:

```ts
apiFetch('/merchant/packages', { headers: { Authorization: `Bearer ${token}` } })
  .then((data) => {
    const res = data as {
      packages: Array<{
        id: string;
        name: string;
        priceSgd: string;
        isActive: boolean;
        includedServices: Array<{ serviceId: string; serviceName: string; quantity: number }>;
      }>;
    };
    setPackageTemplates(res.packages.filter((p) => p.isActive));
  })
  .catch(() => {});
```

- [ ] **Step 2: Derive the selected template**

Add below the existing state (near line 114):

```ts
const sellPackageTemplate = sellPackageId
  ? packageTemplates.find((p) => p.id === sellPackageId) ?? null
  : null;
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd glowos/apps/web && pnpm tsc --noEmit
git add glowos/apps/web/app/dashboard/bookings/BookingForm.tsx
git commit -m "feat(web): load full package template incl. includedServices"
```

### Task 15: Add "Redeem from new package" pill in `ServiceRow`

**Files:**
- Modify: `glowos/apps/web/app/dashboard/bookings/ServiceRow.tsx`

- [ ] **Step 1: Extend `ServiceRowProps`**

Add two new props:

```ts
export interface ServiceRowProps {
  row: ServiceRowState;
  services: ServiceOption[];
  staff: StaffOption[];
  activePackages: ActivePackage[];
  dayBookings: DayBooking[];
  ownBookingIds: Set<string>;
  canRemove: boolean;
  sellPackageTemplate: SoldPackageTemplate | null;
  newPackageUsedForService: number; // rows.filter(r => r.useNewPackage && r.serviceId === this.serviceId).length (excluding this row)
  onChange: (patch: Partial<ServiceRowState>) => void;
  onRemove: () => void;
  error?: string;
}
```

Import `SoldPackageTemplate` from `./types`.

- [ ] **Step 2: Compute availability inside the component**

Right after `const svc = services.find(...)` (or wherever is convenient):

```ts
const soldQuantityForService = sellPackageTemplate
  ? sellPackageTemplate.includedServices
      .filter((s) => s.serviceId === row.serviceId)
      .reduce((sum, s) => sum + s.quantity, 0)
  : 0;
const rowCountsTowardCapacity = row.useNewPackage ? 1 : 0;
const otherRowsUsingSame = newPackageUsedForService; // already excludes this row
const remainingCapacity =
  soldQuantityForService - otherRowsUsingSame - rowCountsTowardCapacity;
const canToggleNewPackage =
  sellPackageTemplate !== null &&
  soldQuantityForService > 0 &&
  (row.useNewPackage || remainingCapacity >= 0);
```

- [ ] **Step 3: Render the pill next to the existing "Use package" pill**

Inside the existing `<div className="flex items-center justify-between">` block, add a second pill (mutually exclusive with "Use package"). Replace the left-hand `eligiblePackages.length > 0 ? (<button>...) : (<span />)` with:

```tsx
<div className="flex items-center gap-1">
  {eligiblePackages.length > 0 && (
    <button
      type="button"
      onClick={togglePackage}
      disabled={Boolean(row.useNewPackage)}
      className={`px-2 py-1 rounded-full text-xs font-medium border disabled:opacity-40 ${
        row.usePackage
          ? 'bg-indigo-600 text-white border-indigo-600'
          : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50'
      }`}
    >
      {row.usePackage ? '✓ Using package' : 'Use package'}
    </button>
  )}
  {sellPackageTemplate && soldQuantityForService > 0 && (
    <button
      type="button"
      onClick={() => {
        if (row.useNewPackage) {
          onChange({
            useNewPackage: false,
            priceSgd: svc?.priceSgd ?? row.priceSgd,
            priceTouched: false,
          });
        } else {
          onChange({
            useNewPackage: true,
            usePackage: undefined,
            priceSgd: '0.00',
            priceTouched: false,
          });
        }
      }}
      disabled={!canToggleNewPackage}
      className={`px-2 py-1 rounded-full text-xs font-medium border disabled:opacity-40 ${
        row.useNewPackage
          ? 'bg-emerald-600 text-white border-emerald-600'
          : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50'
      }`}
    >
      {row.useNewPackage
        ? '✓ Redeem from new package'
        : remainingCapacity < 0
        ? '⚠ exceeds package quantity'
        : 'Redeem from new package'}
    </button>
  )}
</div>
```

(Leave the trailing × remove button in the same div — the existing structure places it on the right.)

- [ ] **Step 4: Typecheck + commit**

```bash
cd glowos/apps/web && pnpm tsc --noEmit
git add glowos/apps/web/app/dashboard/bookings/ServiceRow.tsx
git commit -m "feat(web): 'Redeem from new package' pill in ServiceRow"
```

### Task 16: Wire `ServiceRow` props from `BookingForm`

**Files:**
- Modify: `glowos/apps/web/app/dashboard/bookings/BookingForm.tsx:297-308` (the `rows.map(...)` render)

- [ ] **Step 1: Compute per-service used-count and pass down**

Just above the `.map` (inside the render body):

```ts
function newPackageUsedFor(serviceId: string, excludeIndex: number): number {
  return rows.reduce(
    (count, r, j) =>
      count + (j !== excludeIndex && r.useNewPackage && r.serviceId === serviceId ? 1 : 0),
    0
  );
}
```

Update the `.map` to pass the new props:

```tsx
{rows.map((row, i) => (
  <ServiceRow
    key={row.bookingId ?? `new-${i}`}
    row={row}
    services={services}
    staff={staffList}
    activePackages={activePackages}
    dayBookings={dayBookings}
    ownBookingIds={ownBookingIds}
    canRemove={rows.length > 1}
    sellPackageTemplate={mode === 'create' ? sellPackageTemplate : null}
    newPackageUsedForService={newPackageUsedFor(row.serviceId, i)}
    onChange={(patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))}
    onRemove={() => setRows(rows.filter((_, j) => j !== i))}
  />
))}
```

(Hidden in edit mode per spec Section 3 — pass `null` when `mode === 'edit'`.)

- [ ] **Step 2: Typecheck + commit**

```bash
cd glowos/apps/web && pnpm tsc --noEmit
git add glowos/apps/web/app/dashboard/bookings/BookingForm.tsx
git commit -m "feat(web): wire sellPackageTemplate + capacity counts to ServiceRow"
```

### Task 17: Capacity header above services list

**Files:**
- Modify: `glowos/apps/web/app/dashboard/bookings/BookingForm.tsx` — immediately above the `{rows.map(...)` section (around line 297, inside the `<div>` that wraps the services label)

- [ ] **Step 1: Insert capacity header render**

Below the `<label>Services</label>` but above the `<div className="space-y-2">`:

```tsx
{sellPackageTemplate && (
  <div className="mb-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900">
    <p className="font-semibold mb-1">
      Selling {sellPackageTemplate.name} (S${sellPackageTemplate.priceSgd}):
    </p>
    <ul className="space-y-0.5">
      {sellPackageTemplate.includedServices.map((s) => {
        const used = rows.filter(
          (r) => r.useNewPackage && r.serviceId === s.serviceId
        ).length;
        const remaining = s.quantity - used;
        return (
          <li key={s.serviceId}>
            · {s.serviceName} — {used} of {s.quantity} to redeem today, {remaining} remaining
          </li>
        );
      })}
    </ul>
  </div>
)}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd glowos/apps/web && pnpm tsc --noEmit
git add glowos/apps/web/app/dashboard/bookings/BookingForm.tsx
git commit -m "feat(web): per-service capacity header when selling a package"
```

### Task 18: Total breakdown card + wire submission

**Files:**
- Modify: `glowos/apps/web/app/dashboard/bookings/BookingForm.tsx` — two places: (a) the total pill near `<span>Total: </span>` (line ~363), (b) the `handleSubmit` services payload mapping (line ~184 and ~203)

- [ ] **Step 1: Total breakdown render**

Replace the existing total pill:

```tsx
<div className="w-full rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm">
  <span className="text-gray-500">Total: </span>
  <span className="font-semibold text-gray-900">S${totalPrice.toFixed(2)}</span>
</div>
```

With a breakdown that only renders two lines when a package is being sold:

```tsx
<div className="w-full rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm">
  {sellPackageTemplate ? (
    <>
      <div className="flex justify-between text-xs text-gray-600">
        <span>Services:</span>
        <span>S${totalPrice.toFixed(2)}</span>
      </div>
      <div className="flex justify-between text-xs text-gray-600">
        <span>Package:</span>
        <span>S${Number(sellPackageTemplate.priceSgd).toFixed(2)}</span>
      </div>
      <div className="flex justify-between font-semibold text-gray-900 border-t border-gray-200 mt-1 pt-1">
        <span>Total:</span>
        <span>S${(totalPrice + Number(sellPackageTemplate.priceSgd)).toFixed(2)}</span>
      </div>
    </>
  ) : (
    <>
      <span className="text-gray-500">Total: </span>
      <span className="font-semibold text-gray-900">S${totalPrice.toFixed(2)}</span>
    </>
  )}
</div>
```

- [ ] **Step 2: Send `use_new_package` in the POST body**

In the `handleSubmit` handler, find the `mode === 'create'` branch's `services` mapping and add the field:

```ts
services: rows.map((r) => ({
  service_id: r.serviceId,
  staff_id: r.staffId,
  start_time: r.startTime,
  price_sgd: r.priceTouched ? Number(r.priceSgd) : undefined,
  use_package: r.usePackage
    ? { client_package_id: r.usePackage.clientPackageId, session_id: r.usePackage.sessionId }
    : undefined,
  use_new_package: r.useNewPackage ? true : undefined,
})),
```

(PATCH branch is unchanged — edit mode does not expose `useNewPackage`.)

- [ ] **Step 3: Typecheck + commit**

```bash
cd glowos/apps/web && pnpm tsc --noEmit
git add glowos/apps/web/app/dashboard/bookings/BookingForm.tsx
git commit -m "feat(web): total breakdown + send use_new_package on submit"
```

---

# M6: Frontend — Client detail activity view

### Task 19: Package activity timeline component

**Files:**
- Modify: `glowos/apps/web/app/dashboard/clients/[id]/page.tsx` — add new render block above the existing Packages section (around line 406)

- [ ] **Step 1: Build the events list**

Above the existing `{/* ── Package Progress ── */}` section, insert a new section. First compute events (inside the component, just before the JSX):

```tsx
type ActivityEvent =
  | { type: 'purchase'; when: string; packageName: string; pricePaid: string }
  | {
      type: 'redemption';
      when: string;
      serviceName: string | null;
      staffName: string | null;
      bookingId: string | null;
    };

const activityEvents: ActivityEvent[] = useMemo(() => {
  const events: ActivityEvent[] = [];
  for (const pkg of clientPackagesData) {
    events.push({
      type: 'purchase',
      when: pkg.purchasedAt,
      packageName: pkg.packageName,
      pricePaid: pkg.pricePaidSgd,
    });
    for (const s of pkg.sessions ?? []) {
      if (s.status === 'completed' && s.completedAt) {
        events.push({
          type: 'redemption',
          when: s.completedAt,
          serviceName: s.serviceName ?? null,
          staffName: s.staffName ?? null,
          bookingId: s.bookingId ?? null,
        });
      }
    }
  }
  return events.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
}, [clientPackagesData]);
```

Import `useMemo` at the top of the file if it isn't already.

- [ ] **Step 2: Render the activity section**

Add above `{/* ── Package Progress ── */}`:

```tsx
{activityEvents.length > 0 && (
  <section className="bg-white border border-gray-200 rounded-lg p-4">
    <h2 className="text-sm font-semibold text-gray-900 mb-3">Package Activity</h2>
    <ul className="space-y-1.5">
      {activityEvents.map((e, i) => (
        <li key={i} className="text-xs text-gray-700 flex items-start gap-2">
          <span>{e.type === 'purchase' ? '📦' : '✅'}</span>
          <span className="flex-1">
            {new Date(e.when).toLocaleDateString('en-SG', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}{' '}
            —{' '}
            {e.type === 'purchase'
              ? `Bought ${e.packageName} · S$${e.pricePaid}`
              : `Redeemed session${e.serviceName ? ` · ${e.serviceName}` : ''}${e.staffName ? ` · ${e.staffName}` : ''}`}
          </span>
        </li>
      ))}
    </ul>
  </section>
)}
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd glowos/apps/web && pnpm tsc --noEmit
git add glowos/apps/web/app/dashboard/clients/[id]/page.tsx
git commit -m "feat(web): package activity timeline on client detail page"
```

### Task 20: Expandable sessions table per package card

**Files:**
- Modify: `glowos/apps/web/app/dashboard/clients/[id]/page.tsx` — inside the existing `clientPackagesData.map((pkg: any) => (...))` block (around line 413)

- [ ] **Step 1: Add local state for which package's sessions are expanded**

Near the top of the component (with other useStates):

```tsx
const [expandedPackage, setExpandedPackage] = useState<string | null>(null);
```

- [ ] **Step 2: Render toggle + table inside the package card**

Inside the existing per-package `<div>`, after the progress bar row, insert:

```tsx
<button
  type="button"
  onClick={() =>
    setExpandedPackage(expandedPackage === pkg.id ? null : pkg.id)
  }
  className="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-700"
>
  {expandedPackage === pkg.id ? '− Hide sessions' : '+ Show sessions'}
</button>
{expandedPackage === pkg.id && (
  <table className="mt-2 w-full text-xs">
    <thead>
      <tr className="text-left text-gray-500 border-b border-gray-200">
        <th className="py-1 font-medium">Status</th>
        <th className="py-1 font-medium">Service</th>
        <th className="py-1 font-medium">Used on</th>
        <th className="py-1 font-medium">By</th>
      </tr>
    </thead>
    <tbody>
      {(pkg.sessions ?? []).map((s: any) => (
        <tr key={s.id} className="border-b border-gray-100">
          <td className="py-1 capitalize">{s.status}</td>
          <td className="py-1">{s.serviceName ?? '—'}</td>
          <td className="py-1">
            {s.completedAt
              ? new Date(s.completedAt).toLocaleDateString('en-SG', {
                  day: 'numeric',
                  month: 'short',
                })
              : '—'}
          </td>
          <td className="py-1">{s.staffName ?? '—'}</td>
        </tr>
      ))}
    </tbody>
  </table>
)}
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd glowos/apps/web && pnpm tsc --noEmit
git add glowos/apps/web/app/dashboard/clients/[id]/page.tsx
git commit -m "feat(web): expandable sessions table per package card"
```

---

# M7: End-to-end verification + docs

### Task 21: Full browser walkthrough

**Files:** none — manual verification.

- [ ] **Step 1: Start both services**

Terminal 1: `cd glowos/services/api && pnpm dev`
Terminal 2: `cd glowos/apps/web && pnpm dev`

- [ ] **Step 2: Walk-through 1 — new client buys + redeems on spot**

1. Go to the dashboard (as a merchant).
2. Click **+ Add Walk-in**.
3. Fill client name + new phone number.
4. Pick a service included in a test package.
5. Click **+ Also sell a package** and pick that package.
6. Confirm the capacity header appears: "0 of N to redeem today".
7. Click the emerald **Redeem from new package** pill on the first row.
8. Confirm: row price drops to S$0.00, capacity header updates to "1 of N", breakdown shows Services S$0.00 / Package S$X / Total S$X.
9. Submit.
10. Verify on dashboard: the new booking card shows S$0.00 and the group.
11. Click the client name → client detail page.
12. Confirm Package Activity timeline shows a 📦 purchase + ✅ redemption.
13. Click **Show sessions** on the package → first session is Completed, rest Pending.

- [ ] **Step 3: Walk-through 2 — existing client redeems pre-owned package**

1. Use the same client (now has pending sessions from Walk-through 1).
2. Click **+ Add Walk-in** again.
3. Enter the client's phone → blur the field.
4. Pick a service matching one of the remaining pending sessions.
5. The existing **Use package** pill should appear on that row.
6. Click it → row price drops to S$0.00.
7. Submit.
8. Verify client detail: another ✅ redemption added to the timeline; Show sessions shows second completion.

- [ ] **Step 4: Walk-through 3 — rejection cases in the UI**

1. Start a new walk-in, pick a package to sell.
2. Add two service rows with the SAME service, and both flagged Redeem from new package.
3. Keep adding rows with the same service beyond the package quantity. Confirm the third pill shows **"⚠ exceeds package quantity"** and is disabled.

- [ ] **Step 5: Screenshot/notes for progress.md**

Take notes of anything unexpected — this is what populates Session 14's progress.md entry.

### Task 22: Update `progress.md`

**Files:**
- Modify: `progress.md` — prepend a new Session 14 section

- [ ] **Step 1: Draft the Session 14 section**

At the top of `progress.md` (after the `**Last updated:**` line), insert:

```markdown
## What's Completed (Session 14 — 21 April 2026)

### Atomic package sell + redeem, plus activity view ✅
Walk-in merchants can now sell a package and redeem session(s) from it in a single transaction — closing the Session 13 two-round-trip gap. Client detail page gains an activity timeline and an expandable per-package session list.

- **Schema:** one new nullable column `booking_groups.package_price_sgd numeric(10,2) not null default 0` (migration 0011). No data backfill — historical rows default to 0, which is correct (no atomic sell+redeem existed before).
- **API (POST `/merchant/bookings/group`):** transaction reordered so the sold package and its sessions are created BEFORE the bookings-insert loop. Each row with `use_new_package: true` pops a session from an in-memory pool keyed by service_id. Response now includes `soldPackage.sessions[]` with final statuses so the client can render capacity without a second call. Grand total = sum(bookingPrices) + soldPackagePrice.
- **API (PATCH group):** total recompute now includes the stored `packagePriceSgd`, preventing a clobber bug on first edit of a sold+redeemed group.
- **API (GET `/merchant/packages/client/:clientId`):** joins `services` for each session so the UI gets `serviceName`.
- **Frontend (BookingForm + ServiceRow):** new emerald "Redeem from new package" pill per eligible row, mutually exclusive with "Use package". Capacity header above the services list; Services/Package/Total breakdown on the checkout card.
- **Frontend (Client detail):** new Package Activity section (timeline) + Show sessions toggle on each package card.

Design doc: [docs/superpowers/specs/2026-04-20-atomic-package-sell-redeem-and-tracking-design.md](docs/superpowers/specs/2026-04-20-atomic-package-sell-redeem-and-tracking-design.md)
Implementation plan: [docs/superpowers/plans/2026-04-20-atomic-package-sell-redeem-and-tracking.md](docs/superpowers/plans/2026-04-20-atomic-package-sell-redeem-and-tracking.md)

### Next up (Session 15)
- Revisit `drizzle.__drizzle_migrations` backfill (still pending from Session 13).
- Consider symmetric staff-conflict check on POST group.
```

Also update the `**Last updated:**` line at the top to today's date.

- [ ] **Step 2: Commit**

```bash
git add progress.md
git commit -m "docs: Session 14 — atomic package sell+redeem shipped"
```

- [ ] **Step 3: Push everything**

```bash
git push origin main
```
