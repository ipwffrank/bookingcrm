# Dashboard Revamp + No-Show Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the merchant dashboard with clickable status filters, a revenue card with retained-revenue breakdown, and a conditional low-ratings card; add a no-show chip that appears wherever a client is shown; and make the `/no-show` endpoint persist retained revenue (`refundAmountSgd`) from the merchant's cancellation policy.

**Architecture:** No DB changes. `/no-show` is extended to write `refundAmountSgd` from `cancellation_policy.no_show_charge`. A new `/merchant/analytics/today-revenue` endpoint aggregates four sources. Three client endpoints return a computed `noShowCount`. A shared `NoShowChip` component renders the warning in three places. Dashboard page gains `?status=X` URL filter for clickable status cards.

**Tech Stack:** Drizzle ORM + PostgreSQL, Hono + Zod (API), Next.js 15 App Router (web), date-fns, Tailwind CSS.

**Spec:** [docs/superpowers/specs/2026-04-21-dashboard-revamp-and-no-show-awareness-design.md](../specs/2026-04-21-dashboard-revamp-and-no-show-awareness-design.md)

**Project testing convention:** Repo has no automated test framework. Each task ends with `pnpm tsc --noEmit` (package-local) + commit. Final walkthrough in browser.

---

## File Map

### Modified files (backend)

- `glowos/services/api/src/routes/bookings.ts` — `/no-show` handler stores `refundAmountSgd` from policy
- `glowos/services/api/src/routes/analytics.ts` — new `GET /merchant/analytics/today-revenue`
- `glowos/services/api/src/routes/clients.ts` — add `noShowCount` to `/lookup`, `/:id`, and list
- `glowos/services/api/src/routes/reviews.ts` — accept `?maxRating`, include `clientId` + `clientPhone` in response rows

### New files (frontend)

- `glowos/apps/web/app/dashboard/components/NoShowChip.tsx` — shared chip component

### Modified files (frontend)

- `glowos/apps/web/app/dashboard/page.tsx` — clickable status cards, revenue card, low-ratings card, URL `?status=` filter
- `glowos/apps/web/app/dashboard/bookings/BookingForm.tsx` — render `NoShowChip` after phone lookup
- `glowos/apps/web/app/dashboard/clients/[id]/page.tsx` — render `NoShowChip` in header
- `glowos/apps/web/app/dashboard/clients/page.tsx` — render `NoShowChip` per row

### Docs

- `progress.md` — Session 15 summary

---

## Milestones

- **M1 (Task 1):** `/no-show` persists retained revenue.
- **M2 (Task 2):** `GET /merchant/analytics/today-revenue`.
- **M3 (Tasks 3–6):** `noShowCount` on client endpoints; reviews endpoint enriched.
- **M4 (Task 7):** `NoShowChip` component.
- **M5 (Tasks 8–10):** Chip in three UI surfaces.
- **M6 (Tasks 11–15):** Dashboard revamp.
- **M7 (Tasks 16–17):** Browser walkthrough + progress.md.

---

# M1: `/no-show` persists retained revenue

### Task 1: Compute and store `refundAmountSgd` on no-show

**Files:**
- Modify: `glowos/services/api/src/routes/bookings.ts` — the `merchantBookingsRouter.put("/:id/no-show", ...)` handler (search for `/:id/no-show` — currently around line 835)

- [ ] **Step 1: Replace the handler body**

Find the existing handler. It loads `{ id, status }` today — change the SELECT to also load `priceSgd`, add a join on `merchants` to read `cancellationPolicy`, then compute and store `refundAmountSgd`:

```ts
merchantBookingsRouter.put("/:id/no-show", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const bookingId = c.req.param("id")!;

  const [existing] = await db
    .select({
      id: bookings.id,
      status: bookings.status,
      priceSgd: bookings.priceSgd,
    })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "Not Found", message: "Booking not found" }, 404);
  }

  if (existing.status !== "confirmed" && existing.status !== "in_progress") {
    return c.json(
      { error: "Conflict", message: `Cannot mark no-show for booking with status: ${existing.status}` },
      409
    );
  }

  // Load merchant's cancellation policy to compute the retained amount.
  const [merchant] = await db
    .select({ cancellationPolicy: merchants.cancellationPolicy })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  const policy = (merchant?.cancellationPolicy ?? null) as
    | { no_show_charge?: "full" | "partial" | "none" }
    | null;
  const charge = policy?.no_show_charge ?? "full";
  // refund % is what we return to the client; retained = price - refund
  const refundPct = charge === "full" ? 0 : charge === "partial" ? 50 : 100;
  const refundAmountSgd = ((Number(existing.priceSgd) * refundPct) / 100).toFixed(2);

  const [updated] = await db
    .update(bookings)
    .set({
      status: "no_show",
      noShowAt: new Date(),
      refundAmountSgd,
      updatedAt: new Date(),
    })
    .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
    .returning();

  await invalidateAvailabilityCacheByMerchantId(merchantId);

  // Queue no-show re-engagement (24h delay)
  await scheduleNoShowReengagement(bookingId);

  return c.json({ booking: updated });
});
```

Ensure `merchants` is imported at the top of the file. Look at the existing import block and add `merchants` to the `@glowos/db` import if it isn't already present.

- [ ] **Step 2: Typecheck**

Run: `cd glowos/services/api && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/services/api/src/routes/bookings.ts && \
  git commit -m "feat(api): /no-show persists refundAmountSgd from policy"
```

---

# M2: `GET /merchant/analytics/today-revenue`

### Task 2: Add the today-revenue endpoint

**Files:**
- Modify: `glowos/services/api/src/routes/analytics.ts`

- [ ] **Step 1: Read the existing file to understand imports and router pattern**

Open `glowos/services/api/src/routes/analytics.ts` and note:
- Whether `merchants`, `clientPackages`, `bookings` are already imported.
- The existing router export name (e.g., `analyticsRouter`).
- How existing endpoints handle `merchantId` and date math.

- [ ] **Step 2: Add the endpoint**

Append this handler to the file. Add missing imports at the top. `clientPackages` is from `@glowos/db`.

```ts
// ─── GET /merchant/analytics/today-revenue ────────────────────────────────────

analyticsRouter.get("/today-revenue", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;

  // "today" in server local time — good enough for the MVP. If a merchant spans
  // multiple timezones we can read merchants.timezone and offset later.
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  // Completed + in-progress: sum(priceSgd) where startTime is today
  const completedRows = await db
    .select({ price: bookings.priceSgd })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        inArray(bookings.status, ["completed", "in_progress"]),
        gte(bookings.startTime, startOfToday),
        lte(bookings.startTime, endOfToday)
      )
    );
  const completedRevenue = completedRows.reduce((s, r) => s + Number(r.price), 0);

  // Cancelled: sum(price - refund) where cancelledAt is today
  const cancelledRows = await db
    .select({ price: bookings.priceSgd, refund: bookings.refundAmountSgd })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        eq(bookings.status, "cancelled"),
        gte(bookings.cancelledAt, startOfToday),
        lte(bookings.cancelledAt, endOfToday)
      )
    );
  const cancelledRetained = cancelledRows.reduce(
    (s, r) => s + (Number(r.price) - Number(r.refund)),
    0
  );

  // No-shows: sum(price - refund) where noShowAt is today
  const noShowRows = await db
    .select({ price: bookings.priceSgd, refund: bookings.refundAmountSgd })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        eq(bookings.status, "no_show"),
        gte(bookings.noShowAt, startOfToday),
        lte(bookings.noShowAt, endOfToday)
      )
    );
  const noShowRetained = noShowRows.reduce(
    (s, r) => s + (Number(r.price) - Number(r.refund)),
    0
  );

  // Packages: sum(pricePaidSgd) where purchasedAt is today
  const packageRows = await db
    .select({ price: clientPackages.pricePaidSgd })
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.merchantId, merchantId),
        gte(clientPackages.purchasedAt, startOfToday),
        lte(clientPackages.purchasedAt, endOfToday)
      )
    );
  const packageRevenue = packageRows.reduce((s, r) => s + Number(r.price), 0);

  const total = completedRevenue + cancelledRetained + noShowRetained + packageRevenue;

  return c.json({
    completedRevenue: completedRevenue.toFixed(2),
    cancelledRetained: cancelledRetained.toFixed(2),
    noShowRetained: noShowRetained.toFixed(2),
    packageRevenue: packageRevenue.toFixed(2),
    total: total.toFixed(2),
  });
});
```

Ensure `gte`, `lte`, `and`, `eq`, `inArray` are imported from `drizzle-orm`. `bookings` and `clientPackages` from `@glowos/db`.

- [ ] **Step 3: Typecheck + commit**

```bash
cd glowos/services/api && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/services/api/src/routes/analytics.ts && \
  git commit -m "feat(api): GET /merchant/analytics/today-revenue endpoint"
```

---

# M3: `noShowCount` on client endpoints; reviews enriched

### Task 3: Add `noShowCount` to `GET /merchant/clients/lookup`

**Files:**
- Modify: `glowos/services/api/src/routes/clients.ts` — the `clientsRouter.get("/lookup", ...)` handler

- [ ] **Step 1: Add the count to the response**

Find the handler (currently around line 134). Inside, after the client is found, add:

```ts
const [nsRow] = await db
  .select({ count: sql<number>`cast(count(*) as int)` })
  .from(bookings)
  .where(
    and(
      eq(bookings.clientId, client.id),
      eq(bookings.merchantId, merchantId),
      eq(bookings.status, "no_show")
    )
  );
const noShowCount = Number(nsRow?.count ?? 0);
```

Then include `noShowCount` in the returned `client` object:

```ts
return c.json({
  client: { ...client, noShowCount },
  activePackages: active.map(...),
});
```

Ensure `sql` is imported from `drizzle-orm` and `bookings` from `@glowos/db`.

- [ ] **Step 2: Typecheck + commit**

```bash
cd glowos/services/api && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/services/api/src/routes/clients.ts && \
  git commit -m "feat(api): /clients/lookup returns noShowCount"
```

### Task 4: Add `noShowCount` to `GET /merchant/clients/:id`

**Files:**
- Modify: `glowos/services/api/src/routes/clients.ts` — the `clientsRouter.get("/:id", ...)` handler

- [ ] **Step 1: Locate the handler**

Search for `clientsRouter.get("/:id"` in the file. Note what it currently returns (probably `{ profile, client, recent_bookings }`).

- [ ] **Step 2: Add the count to the response**

Immediately before the `return c.json(...)` at the end of the handler, compute `noShowCount` using the same pattern as Task 3:

```ts
const [nsRow] = await db
  .select({ count: sql<number>`cast(count(*) as int)` })
  .from(bookings)
  .where(
    and(
      eq(bookings.clientId, client.id),   // use whatever variable holds the loaded client's id
      eq(bookings.merchantId, merchantId),
      eq(bookings.status, "no_show")
    )
  );
const noShowCount = Number(nsRow?.count ?? 0);
```

Then include `noShowCount` at the top level of the returned JSON:

```ts
return c.json({
  profile,
  client,
  recent_bookings,
  noShowCount,
});
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd glowos/services/api && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/services/api/src/routes/clients.ts && \
  git commit -m "feat(api): /clients/:id returns noShowCount"
```

### Task 5: Add `noShowCount` to `GET /merchant/clients` list

**Files:**
- Modify: `glowos/services/api/src/routes/clients.ts` — the list handler (the `clientsRouter.get("/", ...)` one)

- [ ] **Step 1: Extend the list query**

Find the list handler. Replace its `db.select(...).from(clients).where(...)` chain with a version that adds a correlated-subquery column for `noShowCount`:

```ts
const rows = await db
  .select({
    // ...existing fields exactly as before...
    noShowCount: sql<number>`cast((
      SELECT COUNT(*) FROM ${bookings}
      WHERE ${bookings.clientId} = ${clients.id}
        AND ${bookings.merchantId} = ${merchantId}
        AND ${bookings.status} = 'no_show'
    ) as int)`,
  })
  .from(clients)
  // ...existing joins and where clauses...
```

Replace `// ...existing fields exactly as before...` with the actual list of columns the current handler selects (keep them all). The extra `noShowCount` column is appended.

- [ ] **Step 2: Typecheck + commit**

```bash
cd glowos/services/api && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/services/api/src/routes/clients.ts && \
  git commit -m "feat(api): clients list returns noShowCount per row"
```

### Task 6: Enrich `GET /merchant/reviews` with `maxRating` + client identifiers

**Files:**
- Modify: `glowos/services/api/src/routes/reviews.ts` — the `merchantReviewRouter.get("/", ...)` handler

- [ ] **Step 1: Accept `maxRating` and return `clientId` + `clientPhone`**

Find the handler (around line 155). Make these changes:

(a) Parse `maxRating` query:
```ts
const maxRatingFilter = c.req.query("maxRating");
```

(b) Add the condition near the existing `ratingFilter` block:
```ts
if (maxRatingFilter) {
  const maxR = Number(maxRatingFilter);
  if (!Number.isFinite(maxR) || maxR < 1 || maxR > 5) {
    return c.json({ error: "Bad Request", message: "maxRating must be 1–5" }, 400);
  }
  conditions.push(lte(reviews.rating, maxR));
}
```

(c) Add `clientId` and `clientPhone` to the SELECT:
```ts
.select({
  id: reviews.id,
  rating: reviews.rating,
  comment: reviews.comment,
  createdAt: reviews.createdAt,
  clientId: clients.id,
  clientName: clients.name,
  clientPhone: clients.phone,
  clientEmail: clients.email,
  serviceName: services.name,
  staffName: staff.name,
  appointmentDate: bookings.startTime,
})
```

Ensure `lte` is imported from `drizzle-orm`.

- [ ] **Step 2: Typecheck + commit**

```bash
cd glowos/services/api && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/services/api/src/routes/reviews.ts && \
  git commit -m "feat(api): /reviews accepts maxRating, returns clientId+phone"
```

---

# M4: `NoShowChip` component

### Task 7: Create the shared chip component

**Files:**
- Create: `glowos/apps/web/app/dashboard/components/NoShowChip.tsx`

- [ ] **Step 1: Write the component**

```tsx
export function NoShowChip({ count, compact = false }: { count: number; compact?: boolean }) {
  if (!count || count <= 0) return null;
  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium border border-red-200 bg-red-50 text-red-700"
        title={`${count} prior no-show${count > 1 ? 's' : ''}`}
      >
        ⚠ {count}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-red-200 bg-red-50 text-red-700">
      ⚠ {count} no-show{count > 1 ? 's' : ''}
    </span>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd glowos/apps/web && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/apps/web/app/dashboard/components/NoShowChip.tsx && \
  git commit -m "feat(web): NoShowChip shared component"
```

---

# M5: Render NoShowChip in three surfaces

### Task 8: Render chip in BookingForm after phone lookup

**Files:**
- Modify: `glowos/apps/web/app/dashboard/bookings/BookingForm.tsx`

- [ ] **Step 1: Track `noShowCount` in state**

Near the existing `const [clientName, setClientName] = useState('');` declarations, add:

```ts
const [clientNoShowCount, setClientNoShowCount] = useState(0);
```

- [ ] **Step 2: Populate it from the lookup response**

Find `maybeLookupClient`. The response shape is `{ client: { ..., noShowCount? } | null, activePackages }`. Update the handler:

```ts
const res = (await apiFetch(
  `/merchant/clients/lookup?phone=${encodeURIComponent(clientPhone)}`,
  { headers: { Authorization: `Bearer ${token}` } }
)) as {
  client: { id: string; name: string | null; noShowCount?: number } | null;
  activePackages: ActivePackage[];
};
if (res.client && !clientName) setClientName(res.client.name ?? '');
setClientNoShowCount(res.client?.noShowCount ?? 0);
setActivePackages(res.activePackages ?? []);
```

Also reset it when the form is closed / phone is cleared. Inside `maybeLookupClient` at the top, if `clientPhone.trim().length < 6`, return early as today — but also clear the count:
```ts
if (mode !== 'create' || clientPhone.trim().length < 6) {
  setClientNoShowCount(0);
  return;
}
```

- [ ] **Step 3: Render the chip next to the Client Name field**

Import at the top:
```ts
import { NoShowChip } from '../components/NoShowChip';
```

Find the Client Name input block (search for the `<label>Client Name</label>`). Immediately after the `<input>` for client name (inside the same wrapping `<div>`), render:

```tsx
{clientNoShowCount > 0 && (
  <div className="mt-1">
    <NoShowChip count={clientNoShowCount} />
  </div>
)}
```

- [ ] **Step 4: Typecheck + commit**

```bash
cd glowos/apps/web && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/apps/web/app/dashboard/bookings/BookingForm.tsx && \
  git commit -m "feat(web): show NoShowChip in BookingForm after phone lookup"
```

### Task 9: Render chip in client detail page header

**Files:**
- Modify: `glowos/apps/web/app/dashboard/clients/[id]/page.tsx`

- [ ] **Step 1: Read `noShowCount` from the detail response**

Find where `apiFetch('/merchant/clients/${profileId}')` is awaited. The response is stored in `data`. Add the field to whatever `interface ClientDetailData` currently looks like:

```ts
interface ClientDetailData {
  profile: ClientProfile;
  client: Client;
  recent_bookings: BookingEntry[];
  noShowCount?: number;
}
```

- [ ] **Step 2: Render the chip in the header**

Import at the top:
```tsx
import { NoShowChip } from '../../components/NoShowChip';
```

Find the header block that renders the VIP badge (`VipBadge` / `vipCfg`). Immediately after it (inside the same flex wrapper), add:

```tsx
<NoShowChip count={data?.noShowCount ?? 0} />
```

(Adjust the data variable name if it's different — use whatever holds the API response.)

- [ ] **Step 3: Typecheck + commit**

```bash
cd glowos/apps/web && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/apps/web/app/dashboard/clients/\[id\]/page.tsx && \
  git commit -m "feat(web): NoShowChip on client detail header"
```

### Task 10: Render chip per row in clients list

**Files:**
- Modify: `glowos/apps/web/app/dashboard/clients/page.tsx`

- [ ] **Step 1: Read `noShowCount` from list response**

The list endpoint now returns `noShowCount` per client. Extend the client type in this file (search for the type declaration that holds client row fields — likely something like `interface ClientRow { ... }` or inline-typed):

```ts
// Add the field to whichever type/interface represents each list row:
noShowCount?: number;
```

- [ ] **Step 2: Render chip in the row**

Import at the top:
```tsx
import { NoShowChip } from './components/NoShowChip'; // or wherever the page imports from
```

If the component path differs, use the actual relative path to
`app/dashboard/components/NoShowChip`. For `app/dashboard/clients/page.tsx`, the relative import is `../components/NoShowChip`.

In the row render, next to the client name (or in a dedicated column if the list is a table), render:

```tsx
<NoShowChip count={row.noShowCount ?? 0} compact />
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd glowos/apps/web && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/apps/web/app/dashboard/clients/page.tsx && \
  git commit -m "feat(web): NoShowChip on clients list rows"
```

---

# M6: Dashboard revamp

### Task 11: Read status filter from URL, wire cards

**Files:**
- Modify: `glowos/apps/web/app/dashboard/page.tsx`

- [ ] **Step 1: Parse `?status=` on mount**

Add imports:
```tsx
import { useSearchParams, useRouter } from 'next/navigation';
```

Near the top of `DashboardPage`, replace the plain `useRouter()` initialization (if it's already there) with both:
```ts
const router = useRouter();
const searchParams = useSearchParams();
```

- [ ] **Step 2: Compute `statusFilter` from URL**

Just above `return (...)`:
```ts
const VALID_STATUSES: BookingStatus[] = ['confirmed', 'in_progress', 'completed', 'no_show'];
const rawFilter = searchParams.get('status');
const statusFilter: BookingStatus | null = VALID_STATUSES.includes(rawFilter as BookingStatus)
  ? (rawFilter as BookingStatus)
  : null;
```

- [ ] **Step 3: Replace the four-stat-card render with clickable buttons**

Find the existing `{/* Summary stats */}` block that maps four stats. Replace it with:

```tsx
<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
  {[
    { key: 'confirmed' as const,   label: 'Confirmed',   value: confirmed.length,   color: 'text-green-600 bg-green-50 border-green-200' },
    { key: 'in_progress' as const, label: 'In Progress', value: inProgress.length,  color: 'text-blue-600 bg-blue-50 border-blue-200' },
    { key: 'completed' as const,   label: 'Completed',   value: completed.length,   color: 'text-gray-600 bg-gray-50 border-gray-200' },
    { key: 'no_show' as const,     label: 'No Show',     value: noShow.length,      color: 'text-orange-600 bg-orange-50 border-orange-200' },
  ].map((stat) => {
    const selected = statusFilter === stat.key;
    return (
      <button
        key={stat.key}
        type="button"
        onClick={() => {
          const next = new URLSearchParams(Array.from(searchParams.entries()));
          if (selected) next.delete('status');
          else next.set('status', stat.key);
          router.replace(`/dashboard${next.toString() ? `?${next}` : ''}`);
        }}
        className={`text-left rounded-xl border p-4 transition-shadow ${stat.color} ${selected ? 'ring-2 ring-indigo-400 shadow' : 'hover:shadow-sm'}`}
        aria-pressed={selected}
      >
        <p className="text-2xl font-bold">{stat.value}</p>
        <p className="text-xs font-medium mt-0.5 opacity-80">{stat.label}</p>
      </button>
    );
  })}
</div>
{statusFilter && (
  <div className="mb-4 -mt-2 flex items-center gap-2 text-xs text-gray-600">
    <span>Filtering by <strong className="capitalize">{statusFilter.replace('_', ' ')}</strong></span>
    <button
      type="button"
      onClick={() => router.replace('/dashboard')}
      className="underline hover:text-gray-900"
    >
      Clear
    </button>
  </div>
)}
```

- [ ] **Step 4: Apply the filter to the bookings list**

Find the block that renders `{bookings.map((row) => (<BookingCard .../>))}`. Replace `bookings.map(` with `bookings.filter(b => !statusFilter || b.booking.status === statusFilter).map(`.

- [ ] **Step 5: Typecheck + commit**

```bash
cd glowos/apps/web && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/apps/web/app/dashboard/page.tsx && \
  git commit -m "feat(web): clickable dashboard status cards filter bookings list"
```

### Task 12: Revenue card — fetch and render

**Files:**
- Modify: `glowos/apps/web/app/dashboard/page.tsx`

- [ ] **Step 1: Add state and fetch**

Near the other `useState` calls in the component:
```ts
const [revenue, setRevenue] = useState<{
  completedRevenue: string;
  cancelledRetained: string;
  noShowRetained: string;
  packageRevenue: string;
  total: string;
} | null>(null);
```

Inside the existing `init()` function in the mount `useEffect`, after the `Promise.all([...])` completes successfully, add:
```ts
apiFetch('/merchant/analytics/today-revenue', { headers: { Authorization: `Bearer ${token}` } })
  .then((d: any) => setRevenue(d))
  .catch(() => {}); // non-fatal; card shows a dash placeholder
```

Also refresh after actions that may change revenue. In `handleAction`, after `await fetchBookings();`, call the same fetch:
```ts
apiFetch('/merchant/analytics/today-revenue', { headers: { Authorization: `Bearer ${token}` } })
  .then((d: any) => setRevenue(d))
  .catch(() => {});
```

- [ ] **Step 2: Render the revenue card**

Import at the top:
```tsx
import Link from 'next/link';
```

Below the stats grid (after the `{statusFilter && ...}` block, before the existing bookings list), add:

```tsx
<Link
  href="/dashboard/analytics?period=today"
  className="block mb-4 bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow"
>
  <div className="flex items-start justify-between">
    <div>
      <p className="text-xs font-medium text-gray-500">Today&apos;s Revenue</p>
      <p className="text-2xl font-bold text-gray-900 mt-0.5">
        S${revenue ? Number(revenue.total).toFixed(2) : '—'}
      </p>
    </div>
  </div>
  {revenue && (
    <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-y-1 gap-x-4 text-xs">
      <div className="flex justify-between"><span className="text-gray-500">Services completed</span><span className="text-gray-900 tabular-nums">S${Number(revenue.completedRevenue).toFixed(2)}</span></div>
      <div className="flex justify-between"><span className="text-gray-500">Cancellations retained</span><span className="text-gray-900 tabular-nums">S${Number(revenue.cancelledRetained).toFixed(2)}</span></div>
      <div className="flex justify-between"><span className="text-gray-500">No-shows retained</span><span className="text-gray-900 tabular-nums">S${Number(revenue.noShowRetained).toFixed(2)}</span></div>
      <div className="flex justify-between"><span className="text-gray-500">Packages sold</span><span className="text-gray-900 tabular-nums">S${Number(revenue.packageRevenue).toFixed(2)}</span></div>
    </div>
  )}
</Link>
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd glowos/apps/web && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/apps/web/app/dashboard/page.tsx && \
  git commit -m "feat(web): Today's Revenue card with retained-revenue breakdown"
```

### Task 13: Low-ratings card — fetch and render

**Files:**
- Modify: `glowos/apps/web/app/dashboard/page.tsx`

- [ ] **Step 1: Add state and fetch**

Near the other `useState` calls:
```ts
const [lowRatings, setLowRatings] = useState<Array<{
  id: string;
  rating: number;
  comment: string | null;
  serviceName: string;
  staffName: string;
  clientId: string;
  clientName: string | null;
  clientPhone: string | null;
}>>([]);
```

In the mount `useEffect`'s `init()` function, alongside the revenue fetch, add:
```ts
apiFetch('/merchant/reviews?period=7d&maxRating=2&limit=5', { headers: { Authorization: `Bearer ${token}` } })
  .then((d: any) => setLowRatings(d.reviews ?? []))
  .catch(() => {});
```

- [ ] **Step 2: Render conditionally**

Place this block right below the Revenue card (still before the bookings list):

```tsx
{lowRatings.length > 0 && (
  <div className="mb-4 bg-white rounded-xl border border-red-200 p-4">
    <div className="flex items-center gap-2 mb-2">
      <span>⚠</span>
      <h2 className="text-sm font-semibold text-gray-900">Recent low ratings (last 7 days)</h2>
    </div>
    <ul className="divide-y divide-gray-100">
      {lowRatings.map((r) => (
        <li key={r.id}>
          <Link
            href={`/dashboard/clients/${r.clientId}`}
            className="flex items-center gap-3 py-2 -mx-2 px-2 rounded-md hover:bg-gray-50"
          >
            <span className="text-amber-500 text-sm shrink-0">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-900 truncate">
                <span className="font-medium">{r.serviceName}</span>
                <span className="text-gray-500"> · {r.staffName}</span>
                {r.comment && <span className="text-gray-600"> · &ldquo;{r.comment}&rdquo;</span>}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {r.clientName ?? 'Unknown'}{r.clientPhone ? ` · ${r.clientPhone}` : ''}
              </p>
            </div>
            <span className="text-gray-400 text-xs">→</span>
          </Link>
        </li>
      ))}
    </ul>
  </div>
)}
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd glowos/apps/web && pnpm tsc --noEmit
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add glowos/apps/web/app/dashboard/page.tsx && \
  git commit -m "feat(web): low-ratings attention card on dashboard"
```

### Task 14: (intentionally merged — kept for numbering continuity)

Skip. The revenue card was added in Task 12 and the low-ratings card in Task 13. No further dashboard tasks needed beyond the browser walkthrough.

### Task 15: (intentionally merged — kept for numbering continuity)

Skip.

---

# M7: End-to-end verification + docs

### Task 16: Browser walkthrough

**Files:** none — manual verification.

- [ ] **Step 1: Boot servers**

Terminal 1:
```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/glowos/services/api && pnpm dev
```

Terminal 2:
```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/glowos/apps/web && pnpm dev
```

- [ ] **Step 2: No-show retained revenue — DB check**

1. In the browser dashboard, pick a Confirmed booking today and click **No-Show**.
2. In a terminal:

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  export $(grep DATABASE_URL glowos/.env | xargs) && \
  cd glowos/packages/db && \
  node -e "const { Client } = require('pg'); (async () => { \
    const c = new Client({ connectionString: process.env.DATABASE_URL }); \
    await c.connect(); \
    const r = await c.query(\"SELECT id, price_sgd, refund_amount_sgd, status FROM bookings WHERE status='no_show' ORDER BY no_show_at DESC LIMIT 1\"); \
    console.log(r.rows); \
    await c.end(); \
  })();"
```

Expected: `refund_amount_sgd` is a non-negative number that matches the policy formula (default 0 → full charge; partial → 50% of price; none → full price refunded).

- [ ] **Step 3: Today's Revenue card**

Reload the dashboard. Verify the revenue card shows non-zero numbers for any day with bookings. Manually sum a few rows to sanity-check the total.

- [ ] **Step 4: Status card filter**

Click **Confirmed** → URL becomes `/dashboard?status=confirmed`, card shows the indigo ring, only confirmed rows show in the list below, and a "Clear" link appears. Click **Clear** → URL goes back to `/dashboard`, all cards/rows restored.

- [ ] **Step 5: No-Show chip**

Open a walk-in. Type the phone of a client with a no-show. Verify `⚠ 1 no-show` chip appears next to the auto-filled name. Navigate to that client's detail page → chip in the header. Navigate to the Clients list → chip in that client's row.

- [ ] **Step 6: Low ratings card**

Either create a low-rating review via the existing review flow or temporarily edit a row:
```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  export $(grep DATABASE_URL glowos/.env | xargs) && \
  cd glowos/packages/db && \
  node -e "const { Client } = require('pg'); (async () => { \
    const c = new Client({ connectionString: process.env.DATABASE_URL }); \
    await c.connect(); \
    await c.query(\"UPDATE reviews SET rating=2 WHERE id=(SELECT id FROM reviews ORDER BY created_at DESC LIMIT 1)\"); \
    console.log('ok'); \
    await c.end(); \
  })();"
```
Reload dashboard → the Low Ratings card renders with that review. Click the row → lands on the client detail page.

### Task 17: Update `progress.md`

**Files:**
- Modify: `progress.md`

- [ ] **Step 1: Prepend Session 15 section**

Update the `**Last updated:**` line at the top and add a new Session 15 section below it, before Session 14. Use this content:

```markdown
## What's Completed (Session 15 — 21 April 2026)

### Dashboard revamp + no-show awareness ✅
Dashboard landing answers "what's today look like and who should I watch" on one page.

- **`/no-show` endpoint** now reads `cancellation_policy.no_show_charge` and stores `refundAmountSgd` (0 for `full`, 50% for `partial`, 100% for `none`). Semantics match cancelled bookings: retained = `priceSgd - refundAmountSgd`.
- **New endpoint `GET /merchant/analytics/today-revenue`** returns `{ completedRevenue, cancelledRetained, noShowRetained, packageRevenue, total }` — all today only.
- **`noShowCount` on three endpoints**: `/merchant/clients/lookup`, `/merchant/clients/:id`, and `/merchant/clients`. Computed on the fly; no denormalization.
- **`/merchant/reviews` enriched** — accepts `?maxRating=N` and returns `clientId` + `clientPhone` on each row (for the dashboard's low-ratings card).
- **Shared `NoShowChip` component** rendered in three surfaces: BookingForm after phone lookup (full chip), client detail page header (full chip), clients list (compact chip).
- **Dashboard landing redesigned**: four clickable status cards (`?status=` URL filter), a Today's Revenue card with breakdown, and a conditional Low Ratings card (< 3★ last 7 days). Bookings list below the fold filters to the selected status.

Design doc: [docs/superpowers/specs/2026-04-21-dashboard-revamp-and-no-show-awareness-design.md](docs/superpowers/specs/2026-04-21-dashboard-revamp-and-no-show-awareness-design.md)
Implementation plan: [docs/superpowers/plans/2026-04-21-dashboard-revamp-and-no-show-awareness.md](docs/superpowers/plans/2026-04-21-dashboard-revamp-and-no-show-awareness.md)

### Next up (Session 16)
- Waitlist feature (deferred from Session 15).
- Staff revenue attribution on merchant dashboard and individual staff dashboard.
- Backfill `drizzle.__drizzle_migrations` on Neon (still pending from Session 13).
```

- [ ] **Step 2: Commit + push**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm && \
  git add progress.md && \
  git commit -m "docs: Session 15 — dashboard revamp + no-show awareness shipped" && \
  git push origin main
```
