# Staff Revenue Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attribute package sales to a seller staff, track services delivered at list price per staff, expose both via merchant + staff dashboards with a period selector.

**Architecture:** One nullable column on `client_packages` captures the seller. Two new aggregation endpoints — one merchant-scoped (all staff) and one staff-scoped (self). Walk-in form adds a required "Sold by" dropdown when a package is being sold. Merchant dashboard gets a new "Staff Contribution" card; `/staff/dashboard` becomes a real page showing Today + This Month plus a period selector.

**Tech Stack:** Drizzle ORM + PostgreSQL, Hono + Zod (API), Next.js 15 App Router (web), date-fns, Tailwind CSS.

**Spec:** [docs/superpowers/specs/2026-04-21-staff-revenue-attribution-design.md](../specs/2026-04-21-staff-revenue-attribution-design.md)

**Project testing convention:** Repo has no automated test framework. Each task ends with `pnpm tsc --noEmit` (package-local) + commit. Final browser walkthrough.

---

## File Map

### Modified (backend)

- `glowos/packages/db/src/schema/packages.ts` — add `soldByStaffId` to `clientPackages`
- `glowos/packages/db/src/migrations/0013_client_packages_sold_by.sql` — new migration
- `glowos/services/api/src/routes/booking-groups.ts` — accept + validate + persist `sold_by_staff_id` on `POST /merchant/bookings/group`
- `glowos/services/api/src/routes/packages.ts` — accept `sold_by_staff_id` on `POST /merchant/packages/assign`
- `glowos/services/api/src/routes/analytics.ts` — new `GET /merchant/analytics/staff-contribution`
- `glowos/services/api/src/routes/staff-portal.ts` — new `GET /staff/my-contribution`

### New (frontend)

- `glowos/apps/web/app/dashboard/components/StaffContributionCard.tsx`
- `glowos/apps/web/app/staff/dashboard/page.tsx` (replaces the redirect)

### Modified (frontend)

- `glowos/apps/web/app/dashboard/bookings/BookingForm.tsx` — add "Sold by" dropdown + submit validation + payload
- `glowos/apps/web/app/dashboard/page.tsx` — mount `StaffContributionCard`

### Docs

- `progress.md`

---

## Milestones

- **M1 (Tasks 1–3):** Schema + migration.
- **M2 (Tasks 4–5):** API write endpoints accept seller.
- **M3 (Tasks 6–7):** Aggregation endpoints.
- **M4 (Task 8):** Walk-in "Sold by" UI.
- **M5 (Tasks 9–10):** Merchant dashboard card.
- **M6 (Task 11):** Staff personal dashboard.
- **M7 (Tasks 12–13):** Verify + docs/merge.

---

# M1: Schema + migration

### Task 1: Drizzle schema

**Files:**
- Modify: `glowos/packages/db/src/schema/packages.ts`

- [ ] **Step 1: Add field to `clientPackages`**

Insert inside the `clientPackages` pgTable definition, after `pricePaidSgd`, before `notes` (or at a position that's syntactically valid):

```ts
soldByStaffId: uuid("sold_by_staff_id").references(() => staff.id, {
  onDelete: "set null",
}),
```

Imports: `staff` is already imported at the top of the file.

- [ ] **Step 2: Typecheck + commit**

```bash
cd glowos/packages/db && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/packages/db/src/schema/packages.ts && \
  git commit -m "feat(db): client_packages.sold_by_staff_id column"
```

### Task 2: Migration 0013

**Files:**
- Create: `glowos/packages/db/src/migrations/0013_client_packages_sold_by.sql`

- [ ] **Step 1: Write SQL**

```sql
ALTER TABLE "client_packages"
  ADD COLUMN "sold_by_staff_id" uuid REFERENCES "staff"("id") ON DELETE SET NULL;
```

- [ ] **Step 2: Commit**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/packages/db/src/migrations/0013_client_packages_sold_by.sql && \
  git commit -m "feat(db): migration 0013 client_packages.sold_by_staff_id"
```

### Task 3: Apply to Neon

- [ ] **Step 1: Apply**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  export $(grep DATABASE_URL glowos/.env | xargs) && \
  cd glowos/packages/db && \
  node -e "const { Client } = require('pg'); (async () => { \
    const c = new Client({ connectionString: process.env.DATABASE_URL }); \
    await c.connect(); \
    const sql = require('fs').readFileSync('src/migrations/0013_client_packages_sold_by.sql', 'utf8'); \
    await c.query(sql); \
    console.log('0013 applied'); await c.end(); })();"
```

Expected: `0013 applied`.

- [ ] **Step 2: Verify column**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  export $(grep DATABASE_URL glowos/.env | xargs) && \
  cd glowos/packages/db && \
  node -e "const { Client } = require('pg'); (async () => { \
    const c = new Client({ connectionString: process.env.DATABASE_URL }); \
    await c.connect(); \
    const r = await c.query(\"SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='client_packages' AND column_name='sold_by_staff_id'\"); \
    console.log(r.rows); await c.end(); })();"
```

Expected: one row, `is_nullable: 'YES'`.

---

# M2: API write endpoints accept seller

### Task 4: Extend `POST /merchant/bookings/group` with seller

**Files:**
- Modify: `glowos/services/api/src/routes/booking-groups.ts`

- [ ] **Step 1: Extend `sell_package` schema**

Find the `createGroupSchema` in the file. Locate the `sell_package` object and add `sold_by_staff_id`:

```ts
sell_package: z
  .object({
    package_id: z.string().uuid(),
    price_sgd: z.number().nonnegative().optional(),
    sold_by_staff_id: z.string().uuid().optional(),
  })
  .optional(),
```

- [ ] **Step 2: Pre-tx validation + persist**

Inside the POST handler, locate the `if (body.sell_package)` block inside the transaction (after the session pool is created, where `client_packages` is inserted). Add a pre-tx check BEFORE the transaction starts:

```ts
// Require sold_by_staff_id when selling a package
if (body.sell_package) {
  if (!body.sell_package.sold_by_staff_id) {
    return c.json(
      { error: "Bad Request", message: "sold_by_staff_id is required when sell_package is provided" },
      400
    );
  }
  // Verify the chosen seller belongs to this merchant and is active
  const [seller] = await db
    .select({ id: staff.id, isActive: staff.isActive })
    .from(staff)
    .where(
      and(
        eq(staff.id, body.sell_package.sold_by_staff_id),
        eq(staff.merchantId, merchantId)
      )
    )
    .limit(1);
  if (!seller || !seller.isActive) {
    return c.json(
      { error: "Not Found", message: "Seller staff not found or inactive" },
      404
    );
  }
}
```

Then, inside the existing `if (body.sell_package) { ... }` block where `client_packages` is inserted, extend the `.values({...})` to include the seller:

```ts
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
    soldByStaffId: body.sell_package.sold_by_staff_id,
  })
  .returning();
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd glowos/services/api && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/services/api/src/routes/booking-groups.ts && \
  git commit -m "feat(api): POST group — require + persist sold_by_staff_id"
```

### Task 5: Extend `POST /merchant/packages/assign`

**Files:**
- Modify: `glowos/services/api/src/routes/packages.ts`

- [ ] **Step 1: Accept `sold_by_staff_id` and persist**

Find the `packagesRouter.post("/assign", ...)` handler (around line 167). Update its body type and the `db.insert(clientPackages).values(...)` call:

```ts
packagesRouter.post("/assign", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const body = await c.req.json<{
    clientId: string;
    packageId: string;
    pricePaidSgd: number;
    notes?: string;
    soldByStaffId?: string; // NEW
  }>();

  // ... existing template lookup unchanged ...

  // Optional seller validation (only when supplied)
  if (body.soldByStaffId) {
    const [seller] = await db
      .select({ id: staff.id, isActive: staff.isActive })
      .from(staff)
      .where(and(eq(staff.id, body.soldByStaffId), eq(staff.merchantId, merchantId)))
      .limit(1);
    if (!seller || !seller.isActive) {
      return c.json({ error: "Not Found", message: "Seller staff not found or inactive" }, 404);
    }
  }

  // ... calculate expiresAt unchanged ...

  const [clientPkg] = await db
    .insert(clientPackages)
    .values({
      merchantId,
      clientId: body.clientId,
      packageId: pkg.id,
      packageName: pkg.name,
      sessionsTotal: pkg.totalSessions,
      pricePaidSgd: String(body.pricePaidSgd),
      expiresAt,
      notes: body.notes || null,
      soldByStaffId: body.soldByStaffId ?? null,
    })
    .returning();

  // ... rest unchanged ...
});
```

Only add the seller validation block and the `soldByStaffId` field in `.values({...})`. Leave everything else as-is.

- [ ] **Step 2: Typecheck + commit**

```bash
cd glowos/services/api && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/services/api/src/routes/packages.ts && \
  git commit -m "feat(api): /packages/assign accepts soldByStaffId"
```

---

# M3: Contribution endpoints

### Task 6: `GET /merchant/analytics/staff-contribution`

**Files:**
- Modify: `glowos/services/api/src/routes/analytics.ts`

- [ ] **Step 1: Append endpoint**

Read the top of the file first to confirm imports and router name. Ensure these are imported from `@glowos/db`: `db`, `staff`, `bookings`, `services`, `clientPackages`. From `drizzle-orm`: `and`, `eq`, `inArray`, `gte`, `lte`, `sql`.

Append the handler:

```ts
// ─── GET /merchant/analytics/staff-contribution ──────────────────────────────

function periodBounds(period: string): { start: Date; end: Date } {
  const now = new Date();
  if (period === "today") {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0),
      end:   new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999),
    };
  }
  if (period === "all") {
    return { start: new Date(0), end: now };
  }
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 30;
  return { start: new Date(now.getTime() - days * 24 * 60 * 60 * 1000), end: now };
}

analyticsRouter.get("/staff-contribution", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const period = c.req.query("period") ?? "today";
  if (!["today", "7d", "30d", "90d", "all"].includes(period)) {
    return c.json({ error: "Bad Request", message: "period must be today|7d|30d|90d|all" }, 400);
  }
  const { start, end } = periodBounds(period);

  // Load all active staff for this merchant
  const allStaff = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(and(eq(staff.merchantId, merchantId), eq(staff.isActive, true)));

  if (allStaff.length === 0) {
    return c.json({ period, rows: [] });
  }

  const staffIds = allStaff.map((s) => s.id);

  // Services delivered by each staff at list price
  const svcRows = await db
    .select({
      staffId: bookings.staffId,
      total: sql<string>`COALESCE(SUM(${services.priceSgd}), 0)`,
    })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        inArray(bookings.staffId, staffIds),
        inArray(bookings.status, ["completed", "in_progress"]),
        gte(bookings.startTime, start),
        lte(bookings.startTime, end)
      )
    )
    .groupBy(bookings.staffId);
  const svcMap = new Map(svcRows.map((r) => [r.staffId, Number(r.total)]));

  // Packages sold by each staff
  const pkgRows = await db
    .select({
      staffId: clientPackages.soldByStaffId,
      total: sql<string>`COALESCE(SUM(${clientPackages.pricePaidSgd}), 0)`,
    })
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.merchantId, merchantId),
        inArray(clientPackages.soldByStaffId, staffIds),
        gte(clientPackages.purchasedAt, start),
        lte(clientPackages.purchasedAt, end)
      )
    )
    .groupBy(clientPackages.soldByStaffId);
  const pkgMap = new Map(pkgRows.map((r) => [r.staffId, Number(r.total)]));

  const rows = allStaff.map((s) => {
    const services = svcMap.get(s.id) ?? 0;
    const packages = pkgMap.get(s.id) ?? 0;
    return {
      staffId: s.id,
      staffName: s.name,
      servicesDelivered: services.toFixed(2),
      packagesSold: packages.toFixed(2),
      total: (services + packages).toFixed(2),
    };
  });

  rows.sort((a, b) => {
    const d = Number(b.total) - Number(a.total);
    return d !== 0 ? d : a.staffName.localeCompare(b.staffName);
  });

  return c.json({ period, rows });
});
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd glowos/services/api && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/services/api/src/routes/analytics.ts && \
  git commit -m "feat(api): GET /merchant/analytics/staff-contribution"
```

### Task 7: `GET /staff/my-contribution`

**Files:**
- Modify: `glowos/services/api/src/routes/staff-portal.ts`

- [ ] **Step 1: Append endpoint**

Imports: ensure `services`, `clientPackages` from `@glowos/db`, `inArray`, `sql` from `drizzle-orm`.

Append before `export { staffPortalRouter };`:

```ts
function periodBounds(period: string): { start: Date; end: Date } {
  const now = new Date();
  if (period === "today") {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0),
      end:   new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999),
    };
  }
  if (period === "all") {
    return { start: new Date(0), end: now };
  }
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 30;
  return { start: new Date(now.getTime() - days * 24 * 60 * 60 * 1000), end: now };
}

// GET /staff/my-contribution?period=today|7d|30d|90d|all
staffPortalRouter.get("/my-contribution", async (c) => {
  const merchantId = c.get("merchantId")!;
  const staffId = c.get("staffId");
  if (!staffId) {
    return c.json({ error: "Forbidden", message: "Staff access required" }, 403);
  }
  const period = c.req.query("period") ?? "today";
  if (!["today", "7d", "30d", "90d", "all"].includes(period)) {
    return c.json({ error: "Bad Request", message: "period must be today|7d|30d|90d|all" }, 400);
  }
  const { start, end } = periodBounds(period);

  const [svcRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${services.priceSgd}), 0)` })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        eq(bookings.staffId, staffId),
        inArray(bookings.status, ["completed", "in_progress"]),
        gte(bookings.startTime, start),
        lte(bookings.startTime, end)
      )
    );
  const servicesDelivered = Number(svcRow?.total ?? 0);

  const [pkgRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${clientPackages.pricePaidSgd}), 0)` })
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.merchantId, merchantId),
        eq(clientPackages.soldByStaffId, staffId),
        gte(clientPackages.purchasedAt, start),
        lte(clientPackages.purchasedAt, end)
      )
    );
  const packagesSold = Number(pkgRow?.total ?? 0);

  const [staffRow] = await db
    .select({ name: staff.name })
    .from(staff)
    .where(eq(staff.id, staffId))
    .limit(1);

  return c.json({
    period,
    staffId,
    staffName: staffRow?.name ?? null,
    servicesDelivered: servicesDelivered.toFixed(2),
    packagesSold: packagesSold.toFixed(2),
    total: (servicesDelivered + packagesSold).toFixed(2),
  });
});
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd glowos/services/api && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/services/api/src/routes/staff-portal.ts && \
  git commit -m "feat(api): GET /staff/my-contribution"
```

---

# M4: BookingForm "Sold by"

### Task 8: Add `soldByStaffId` state + dropdown + validation + submit

**Files:**
- Modify: `glowos/apps/web/app/dashboard/bookings/BookingForm.tsx`

- [ ] **Step 1: Add state**

Near the existing `const [sellPackageId, setSellPackageId] = useState<string>('');` declaration, add:

```ts
const [soldByStaffId, setSoldByStaffId] = useState<string>('');
```

- [ ] **Step 2: Default to the first row's staff when the picker opens**

Find the `clearNewPackageRedemptions()` helper from Session 14. Alongside it, add logic that initializes `soldByStaffId` when `sellPackageId` becomes truthy. The cleanest place: inside the `setSellPackageId` wrapper. If your code sets it directly via the `<select onChange>`, wrap the call. Replace the existing `onChange={(e) => { clearNewPackageRedemptions(); setSellPackageId(e.target.value); }}` with:

```tsx
onChange={(e) => {
  clearNewPackageRedemptions();
  setSellPackageId(e.target.value);
  if (e.target.value && !soldByStaffId) {
    setSoldByStaffId(rows[0]?.staffId ?? '');
  }
  if (!e.target.value) {
    setSoldByStaffId('');
  }
}}
```

- [ ] **Step 3: Render the dropdown**

Inside the `{sellOpen && (...)}` block, right under the existing package `<select>`, add:

```tsx
{sellPackageId && (
  <div className="mt-2">
    <label className="block text-xs font-medium text-gray-700 mb-1">Sold by</label>
    <select
      value={soldByStaffId}
      onChange={(e) => setSoldByStaffId(e.target.value)}
      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      required
    >
      <option value="">Select staff...</option>
      {staffList.map((s) => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </select>
  </div>
)}
```

- [ ] **Step 4: Validate on submit**

Find `handleSubmit`. After the existing client-name / rows validation, BEFORE the POST call, add:

```ts
if (sellPackageId && !soldByStaffId) {
  setApiError('Pick who sold the package');
  return;
}
```

- [ ] **Step 5: Extend the POST payload**

Find the POST body inside `handleSubmit`'s `mode === 'create'` branch. Update the `sell_package` field:

```ts
sell_package: sellPackageId
  ? { package_id: sellPackageId, sold_by_staff_id: soldByStaffId }
  : undefined,
```

- [ ] **Step 6: Typecheck + commit**

```bash
cd glowos/apps/web && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/apps/web/app/dashboard/bookings/BookingForm.tsx && \
  git commit -m "feat(web): BookingForm 'Sold by' dropdown + payload + validation"
```

---

# M5: Merchant dashboard card

### Task 9: `StaffContributionCard` component

**Files:**
- Create: `glowos/apps/web/app/dashboard/components/StaffContributionCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

type Period = 'today' | '7d' | '30d' | '90d' | 'all';

interface Row {
  staffId: string;
  staffName: string;
  servicesDelivered: string;
  packagesSold: string;
  total: string;
}

const PERIOD_LABEL: Record<Period, string> = {
  today: 'Today',
  '7d': '7d',
  '30d': '30d',
  '90d': '90d',
  all: 'All',
};

export function StaffContributionCard() {
  const [period, setPeriod] = useState<Period>('today');
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    apiFetch(`/merchant/analytics/staff-contribution?period=${period}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((d) => {
        const res = d as { rows: Row[] };
        setRows(res.rows ?? []);
      })
      .catch(() => setRows([]));
  }, [period]);

  return (
    <div className="mb-4 bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">Staff Contribution</h2>
        <div className="flex gap-1">
          {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${
                period === p
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No active staff yet.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100">
              <th className="py-1 font-medium">Staff</th>
              <th className="py-1 font-medium text-right">Services</th>
              <th className="py-1 font-medium text-right">Packages</th>
              <th className="py-1 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.staffId} className="border-b border-gray-50 last:border-0">
                <td className="py-1.5 text-gray-900">{r.staffName}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-700">S${Number(r.servicesDelivered).toFixed(2)}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-700">S${Number(r.packagesSold).toFixed(2)}</td>
                <td className="py-1.5 text-right tabular-nums font-semibold text-gray-900">S${Number(r.total).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd glowos/apps/web && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/apps/web/app/dashboard/components/StaffContributionCard.tsx && \
  git commit -m "feat(web): StaffContributionCard component"
```

### Task 10: Mount on `/dashboard`

**Files:**
- Modify: `glowos/apps/web/app/dashboard/page.tsx`

- [ ] **Step 1: Import + render between Revenue and Waitlist**

Add import near the other `./components/` imports:
```tsx
import { StaffContributionCard } from './components/StaffContributionCard';
```

Find the block that renders the Revenue `<Link>` (with `/dashboard/analytics?period=today`). Immediately after it, BEFORE the waitlist `<div ref={waitlistRef}>...`, insert:

```tsx
<StaffContributionCard />
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd glowos/apps/web && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/apps/web/app/dashboard/page.tsx && \
  git commit -m "feat(web): mount StaffContributionCard on dashboard"
```

---

# M6: Staff personal dashboard

### Task 11: Replace redirect with a real page

**Files:**
- Modify: `glowos/apps/web/app/staff/dashboard/page.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';

type Period = 'today' | '7d' | '30d' | '90d' | 'all';

interface Contribution {
  staffName: string | null;
  servicesDelivered: string;
  packagesSold: string;
  total: string;
}

const PERIOD_LABEL: Record<Period, string> = {
  today: 'Today',
  '7d': '7d',
  '30d': '30d',
  '90d': '90d',
  all: 'All',
};

export default function StaffDashboard() {
  const [today, setToday] = useState<Contribution | null>(null);
  const [month, setMonth] = useState<Contribution | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<Period | null>(null);
  const [selectedContribution, setSelectedContribution] = useState<Contribution | null>(null);

  async function load(period: Period): Promise<Contribution | null> {
    try {
      const token = localStorage.getItem('access_token');
      const d = await apiFetch(`/staff/my-contribution?period=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return d as Contribution;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    load('today').then(setToday);
    load('30d').then(setMonth);
  }, []);

  async function pickPeriod(p: Period) {
    if (p === 'today') {
      setSelectedPeriod(null);
      setSelectedContribution(null);
      return;
    }
    setSelectedPeriod(p);
    const c = await load(p);
    setSelectedContribution(c);
  }

  const showCollapsed = selectedPeriod !== null;

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-lg font-semibold mb-1 text-gray-900">
        Hi {today?.staffName ?? ''}
      </h1>
      <p className="text-xs text-gray-500 mb-4">Your contribution at a glance.</p>

      {!showCollapsed && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <ContributionCard title="Today" c={today} />
          <ContributionCard title="This month" c={month} />
        </div>
      )}

      {showCollapsed && selectedContribution && (
        <div className="mb-4">
          <ContributionCard title={PERIOD_LABEL[selectedPeriod!]} c={selectedContribution} />
        </div>
      )}

      <div className="flex gap-1 mb-6">
        {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => {
          const selected = p === 'today' ? !showCollapsed : selectedPeriod === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => pickPeriod(p)}
              className={`px-2.5 py-1 text-xs font-medium rounded-full border ${
                selected
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {PERIOD_LABEL[p]}
            </button>
          );
        })}
      </div>

      <div className="space-y-2">
        <Link href="/staff/bookings" className="block text-sm text-indigo-600 hover:underline">
          → Your upcoming bookings
        </Link>
        <Link href="/staff/clients" className="block text-sm text-indigo-600 hover:underline">
          → Your clients
        </Link>
      </div>
    </div>
  );
}

function ContributionCard({ title, c }: { title: string; c: Contribution | null }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-xs font-medium text-gray-500 mb-0.5">{title}</p>
      <p className="text-2xl font-bold text-gray-900">
        {c ? `S$${Number(c.total).toFixed(2)}` : '—'}
      </p>
      {c && (
        <div className="mt-2 space-y-0.5 text-xs text-gray-600">
          <div className="flex justify-between"><span>Services</span><span className="tabular-nums">S${Number(c.servicesDelivered).toFixed(2)}</span></div>
          <div className="flex justify-between"><span>Packages</span><span className="tabular-nums">S${Number(c.packagesSold).toFixed(2)}</span></div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd glowos/apps/web && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/apps/web/app/staff/dashboard/page.tsx && \
  git commit -m "feat(web): real /staff/dashboard with Today + This month + period selector"
```

---

# M7: Verify + docs

### Task 12: Browser walkthrough

- [ ] **Step 1: Boot servers + seed**

Terminal 1: `cd /Users/chrisrine/Desktop/projects/bookingcrm/glowos/services/api && pnpm dev`
Terminal 2: `cd /Users/chrisrine/Desktop/projects/bookingcrm/glowos/apps/web && pnpm dev`

- [ ] **Step 2: Create a walk-in with a package sale**

Dashboard → **+ Add Walk-in**. Pick a service + staff, then **+ Also sell a package** → pick a package → a "Sold by" dropdown appears → pick any staff → Submit. The `client_packages.sold_by_staff_id` DB row should be populated.

Confirm:
```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  export $(grep DATABASE_URL glowos/.env | xargs) && \
  cd glowos/packages/db && \
  node -e "const { Client } = require('pg'); (async () => { \
    const c = new Client({ connectionString: process.env.DATABASE_URL }); \
    await c.connect(); \
    const r = await c.query(\"SELECT id, package_name, price_paid_sgd, sold_by_staff_id FROM client_packages ORDER BY created_at DESC LIMIT 3\"); \
    console.log(r.rows); await c.end(); })();"
```

- [ ] **Step 3: Staff Contribution card**

Reload `/dashboard`. The Staff Contribution card should render between Revenue and Waitlist. Sarah's row should show Services = list price of the service delivered × visits, Packages = the price paid for the package she sold. Click the period pills → numbers refetch for that period.

- [ ] **Step 4: Staff personal dashboard**

In a separate tab (or using a staff session), go to `/staff/dashboard`. Verify greeting shows the staff's name + two cards: Today + This Month. Click a period pill (e.g., 30d) → the two-card view collapses to one; clicking Today → back to two-card default.

- [ ] **Step 5: Validation**

Try submitting a walk-in with a package selected but no "Sold by" chosen → expect an inline error "Pick who sold the package" and no POST.

### Task 13: `progress.md` + merge

- [ ] **Step 1: Update `progress.md`**

Prepend a Session 17 section; update `**Last updated:**` line. Session 17 summary:

```markdown
## What's Completed (Session 17 — 21 April 2026)

### Staff revenue attribution ✅
Per-staff revenue visibility for both merchant and individual staff. Two parallel streams: services delivered (at list price, credited to the booking's staff) and packages sold (credited to a new `sold_by_staff_id` on client_packages). No splitting — each stream is attributed in full to the performer/seller, aligning with the multi-staff rule from Session 15.

- **Data:** new column `client_packages.sold_by_staff_id uuid references staff(id) on delete set null` (migration 0013). Historical rows stay NULL.
- **API:** `POST /merchant/bookings/group` requires `sell_package.sold_by_staff_id`; `POST /merchant/packages/assign` accepts it optionally. Two new aggregations — `GET /merchant/analytics/staff-contribution` for merchant per-staff rows and `GET /staff/my-contribution` for the signed-in staff. Both accept `?period=today|7d|30d|90d|all`.
- **Walk-in form:** a required "Sold by" dropdown appears whenever a package is being sold. Defaults to the first service row's staff, overridable to any active staff (for sales-only consultants).
- **Merchant dashboard:** new Staff Contribution card between Revenue and Waitlist with period selector. Rows sorted by total desc.
- **Staff dashboard:** `/staff/dashboard` is now a real page with Today + This Month side-by-side cards and a 5-period selector that collapses to a single card when non-default.

Design doc: [docs/superpowers/specs/2026-04-21-staff-revenue-attribution-design.md](docs/superpowers/specs/2026-04-21-staff-revenue-attribution-design.md)
Implementation plan: [docs/superpowers/plans/2026-04-21-staff-revenue-attribution.md](docs/superpowers/plans/2026-04-21-staff-revenue-attribution.md)

### Next up (Session 18)
- Backfill `drizzle.__drizzle_migrations` on Neon (still pending since Session 13).
- Optional: `no_show_refund_pct` merchant setting to replace hardcoded 50% from Session 15.
- Optional: team leaderboard on staff view (deferred — Option B from Session 17 brainstorm).
```

- [ ] **Step 2: Merge + push + delete branch**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add progress.md && \
  git commit -m "docs: Session 17 — staff revenue attribution shipped" && \
  git checkout main && \
  git merge --no-ff feature/staff-contribution -m "Merge feature/staff-contribution" && \
  git push origin main && \
  git branch -d feature/staff-contribution
```

Update the Session 17 progress.md entry after merge to record the actual merge commit SHA (same pattern as Sessions 14–16).
