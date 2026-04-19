# First-Timer Discount ROI Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one analytics section to the merchant dashboard answering "is my first-timer discount making me money?" via 4 stat cards + a prominent Net ROI hero number.

**Architecture:** Add a `bookings.first_timer_discount_applied` boolean flag (set at payment-intent and `/confirm` time when the first-timer discount is granted). Add one new analytics endpoint that aggregates the flag against service/booking prices. Add one new frontend section in the existing analytics page, matching the visual patterns of the other 11 sections.

**Tech Stack:** Drizzle ORM, Hono + Zod, Next.js 15 App Router. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-04-20-first-timer-roi-analytics-design.md](../specs/2026-04-20-first-timer-roi-analytics-design.md)

---

## File Map

### New files

- `glowos/packages/db/src/migrations/0009_bookings_first_timer_flag.sql` — hand-written minimal migration
- `glowos/packages/db/src/migrations/meta/0009_snapshot.json` — drizzle-generated snapshot (updated alongside the migration)

### Modified files

- `glowos/packages/db/src/schema/bookings.ts` — add `firstTimerDiscountApplied` boolean column
- `glowos/services/api/src/routes/payments.ts` — set the flag on first-timer grants
- `glowos/services/api/src/routes/bookings.ts` — same, in `/booking/:slug/confirm`
- `glowos/services/api/src/routes/analytics.ts` — new `/first-timer-roi` handler
- `glowos/apps/web/app/dashboard/analytics/page.tsx` — new `FirstTimerROI` component + render after `RatingTrend`

---

## Milestones

- **M1 (Tasks 1–2):** Schema + migration. Backwards compatible, safe to deploy first.
- **M2 (Tasks 3–4):** Set the flag at the two points first-timer discounts are granted.
- **M3 (Tasks 5–6):** New analytics endpoint + frontend section.
- **M4 (Task 7):** Apply migration + rollout + smoke test in production.

---

# M1: Schema + migration

## Task 1: Add `firstTimerDiscountApplied` column to bookings schema

**Files:**
- Modify: `glowos/packages/db/src/schema/bookings.ts`

- [ ] **Step 1: Locate the schema file and existing boolean fields**

Open `glowos/packages/db/src/schema/bookings.ts`. Find the `bookings = pgTable("bookings", { … })` definition. It has many columns; boolean columns are rare. Grep for `boolean(` to find an example pattern to match.

- [ ] **Step 2: Add the new column**

Append a new field alongside the booking-source / commission fields (anywhere between `bookingSource` and `cancelledAt` is fine — pick a sensible spot near other booking-state fields). Add:

```ts
firstTimerDiscountApplied: boolean("first_timer_discount_applied")
  .notNull()
  .default(false),
```

- [ ] **Step 3: Verify `boolean` is imported**

The import list at the top of the file should already include `boolean` from `drizzle-orm/pg-core`. If not, add it to the import list.

- [ ] **Step 4: Type check**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/.worktrees/<worktree-name>/glowos/packages/db
pnpm tsc --noEmit
```

Expect: no new errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/.worktrees/<worktree-name>
git add glowos/packages/db/src/schema/bookings.ts
git commit -m "feat(db): add bookings.first_timer_discount_applied column to schema"
```

---

## Task 2: Hand-write the migration SQL + snapshot

**Files:**
- Create: `glowos/packages/db/src/migrations/0009_bookings_first_timer_flag.sql`
- Create: `glowos/packages/db/src/migrations/meta/0009_snapshot.json` (see below)
- Modify: `glowos/packages/db/src/migrations/meta/_journal.json`

The drizzle-kit auto-generator would produce a migration with all the drifted schema changes it still hasn't snapshotted. Skip drizzle-kit and hand-write the minimal migration.

- [ ] **Step 1: Create the migration SQL file**

```bash
cat > /Users/chrisrine/Desktop/projects/bookingcrm/.worktrees/<worktree-name>/glowos/packages/db/src/migrations/0009_bookings_first_timer_flag.sql <<'EOF'
ALTER TABLE "bookings" ADD COLUMN "first_timer_discount_applied" boolean DEFAULT false NOT NULL;
EOF
```

Exactly one line of SQL. Nothing else.

- [ ] **Step 2: Update `_journal.json`**

Open `glowos/packages/db/src/migrations/meta/_journal.json`. It's a JSON file that tracks migrations by index. Add a new entry at the end of the `entries` array:

```json
{
  "idx": 9,
  "version": "7",
  "when": 1745107200000,
  "tag": "0009_bookings_first_timer_flag",
  "breakpoints": true
}
```

(Use the current Unix timestamp in milliseconds for `when` — or copy the format from the existing last entry and increment. The exact timestamp value doesn't matter as long as it's later than entry 8's.)

If the last entry has different fields (e.g. no `version`), match its shape exactly — don't invent fields.

- [ ] **Step 3: Create the snapshot JSON**

The snapshot must reflect the full current schema state, including the new column. The simplest way: copy `0008_snapshot.json` to `0009_snapshot.json`, then add the new column to the `bookings` table entry inside it.

```bash
cp /Users/chrisrine/Desktop/projects/bookingcrm/.worktrees/<worktree-name>/glowos/packages/db/src/migrations/meta/0008_snapshot.json \
   /Users/chrisrine/Desktop/projects/bookingcrm/.worktrees/<worktree-name>/glowos/packages/db/src/migrations/meta/0009_snapshot.json
```

Then open `0009_snapshot.json`. Find the `bookings` table definition (search for `"name": "bookings"`). Inside its `columns` object, add:

```json
"first_timer_discount_applied": {
  "name": "first_timer_discount_applied",
  "type": "boolean",
  "primaryKey": false,
  "notNull": true,
  "default": false
}
```

Insert it alphabetically among the other columns, or at the end of the columns object — drizzle doesn't care about order. Also update the top-level `id` field in the JSON to a new UUID if the other snapshots follow that convention (check `0008_snapshot.json` to see).

If modifying the snapshot JSON by hand proves fragile (malformed JSON, column object shape differs from expectations), STOP and report — we can reconcile it by running `drizzle-kit push --dialect=postgresql` against a dev branch and pulling the resulting snapshot.

- [ ] **Step 4: Verify the JSON files are well-formed**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/.worktrees/<worktree-name>
python3 -m json.tool glowos/packages/db/src/migrations/meta/0009_snapshot.json > /dev/null && echo "OK"
python3 -m json.tool glowos/packages/db/src/migrations/meta/_journal.json > /dev/null && echo "OK"
```

Expect: both print `OK`.

- [ ] **Step 5: Commit**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/.worktrees/<worktree-name>
git add glowos/packages/db/src/migrations/0009_bookings_first_timer_flag.sql \
  glowos/packages/db/src/migrations/meta/_journal.json \
  glowos/packages/db/src/migrations/meta/0009_snapshot.json
git commit -m "feat(db): migration for bookings.first_timer_discount_applied column"
```

---

# M2: Flag setting

## Task 3: Set the flag in payment-intent handler

**Files:**
- Modify: `glowos/services/api/src/routes/payments.ts`

This endpoint is the Stripe path for online-paid bookings. The first-timer discount decision already happens here (from Session 11). We tag the booking when the discount is actually applied.

- [ ] **Step 1: Locate the first-timer block**

Grep for `firstTimerDiscountEnabled` in `payments.ts`. You'll find the block (roughly lines 350–410) that:

1. Checks if the service has first-timer enabled
2. Decodes + verifies the `verification_token`
3. Calls `isFirstTimerAtMerchant(...)`
4. If eligible, computes `firstTimerPrice` and maybe overrides `priceSgd`

- [ ] **Step 2: Introduce a local tracking variable**

Just before the first-timer block, declare:

```ts
let firstTimerDiscountApplied = false;
```

- [ ] **Step 3: Set it to `true` when the first-timer discount wins**

Find the inner comparison — approximately:

```ts
if (firstTimerEligible) {
  const firstTimerPrice = basePrice * (1 - service.firstTimerDiscountPct / 100);
  if (firstTimerPrice < priceSgd) {
    priceSgd = firstTimerPrice;
  }
}
```

Change to:

```ts
if (firstTimerEligible) {
  const firstTimerPrice = basePrice * (1 - service.firstTimerDiscountPct / 100);
  if (firstTimerPrice < priceSgd) {
    priceSgd = firstTimerPrice;
    firstTimerDiscountApplied = true;
  }
}
```

The flag is set only when the first-timer price actually wins (not just because the merchant has first-timer enabled and the user verified). If the regular discount or base price is cheaper, the flag stays `false`.

- [ ] **Step 4: Pass the flag into the booking insert**

Grep inside the same handler for the `db.insert(bookings).values({ … })` call. Add the new field to the values:

```ts
firstTimerDiscountApplied,
```

If there's no booking insert here (payment-intent sometimes creates the booking lazily on webhook), trace back what happens on the successful-payment path and add the flag THERE. But in most modern flows the booking row is inserted when the payment intent is created with status `confirmed` + `payment_status: 'pending'`. Match the pattern already in the file.

If you can't find the insert, STOP and report — the flag needs to be stored on the bookings row, so we'll need to trace the actual insert location.

- [ ] **Step 5: Type check**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/.worktrees/<worktree-name>/glowos/services/api
pnpm tsc --noEmit
```

Expect: no new errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/.worktrees/<worktree-name>
git add glowos/services/api/src/routes/payments.ts
git commit -m "feat(api): tag payment-intent bookings with first_timer_discount_applied flag"
```

---

## Task 4: Set the flag in `/booking/:slug/confirm`

**Files:**
- Modify: `glowos/services/api/src/routes/bookings.ts`

Same pattern as Task 3, but in the pay-at-appointment confirm handler.

- [ ] **Step 1: Locate the first-timer block in `/:slug/confirm`**

Grep for `firstTimerDiscountEnabled` in `bookings.ts`. You'll find a block inside the `bookingsRouter.post("/:slug/confirm", …)` handler (around lines 1220–1280) that mirrors the payments.ts structure.

- [ ] **Step 2: Track whether the first-timer price wins**

Just before the first-timer block, declare:

```ts
let firstTimerDiscountApplied = false;
```

When the inner `ftPrice < computedPrice` check succeeds, set `firstTimerDiscountApplied = true` alongside the price update:

```ts
if (firstTimerEligible) {
  const ftPrice = basePrice * (1 - service.firstTimerDiscountPct / 100);
  if (ftPrice < computedPrice) {
    computedPrice = ftPrice;
    firstTimerDiscountApplied = true;
  }
}
```

- [ ] **Step 3: Pass the flag into the booking insert**

Grep inside the handler for the `db.insert(bookings).values({ … })` call (around line 1280). Add:

```ts
firstTimerDiscountApplied,
```

- [ ] **Step 4: Type check**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/.worktrees/<worktree-name>/glowos/services/api
pnpm tsc --noEmit
```

Expect: no new errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/.worktrees/<worktree-name>
git add glowos/services/api/src/routes/bookings.ts
git commit -m "feat(api): tag /:slug/confirm bookings with first_timer_discount_applied flag"
```

---

# M3: Analytics endpoint + frontend

## Task 5: Add `GET /merchant/analytics/first-timer-roi` endpoint

**Files:**
- Modify: `glowos/services/api/src/routes/analytics.ts`

- [ ] **Step 1: Locate the end of the existing endpoints**

`analytics.ts` has ~11 GET endpoints. Find the last one (likely at the very bottom, just before `export default analyticsRouter`).

- [ ] **Step 2: Add the new handler**

Append (before the `export`):

```ts
// ─── GET /merchant/analytics/first-timer-roi ──────────────────────────────

analyticsRouter.get("/first-timer-roi", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const periodParam = c.req.query("period") ?? "30d";

  let days: number;
  if (periodParam === "7d") days = 7;
  else if (periodParam === "30d") days = 30;
  else if (periodParam === "90d") days = 90;
  else if (periodParam === "365d") days = 365;
  else if (periodParam === "all") days = 36500; // 100 years, effectively "all"
  else return c.json({ error: "Bad Request", message: "invalid period" }, 400);

  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

  // 1. First-timer bookings in period
  const firstTimerRows = await db
    .select({
      bookingId: bookings.id,
      clientId: bookings.clientId,
      startTime: bookings.startTime,
      priceSgd: bookings.priceSgd,
      serviceBasePrice: services.priceSgd,
    })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        eq(bookings.firstTimerDiscountApplied, true),
        eq(bookings.status, "completed"),
        gte(bookings.startTime, start),
        lte(bookings.startTime, end)
      )
    );

  const firstTimersCount = firstTimerRows.length;

  // 2. Total discount given — sum(service.priceSgd - booking.priceSgd)
  const discountGiven = firstTimerRows.reduce((sum, r) => {
    const base = parseFloat(r.serviceBasePrice);
    const paid = parseFloat(r.priceSgd);
    return sum + Math.max(0, base - paid);
  }, 0);

  // 3. Mature cohort — first-timers whose first booking was ≥ 30d ago
  const matureRows = firstTimerRows.filter((r) => r.startTime < thirtyDaysAgo);
  const matureFirstTimersCount = matureRows.length;

  // 4. For each mature first-timer, check if they have a 2nd+ completed booking
  let returnedCount = 0;
  let returnRevenue = 0;
  for (const r of matureRows) {
    const laterBookings = await db
      .select({ priceSgd: bookings.priceSgd })
      .from(bookings)
      .where(
        and(
          eq(bookings.merchantId, merchantId),
          eq(bookings.clientId, r.clientId),
          eq(bookings.status, "completed"),
          gt(bookings.startTime, r.startTime)
        )
      );
    if (laterBookings.length > 0) {
      returnedCount += 1;
      returnRevenue += laterBookings.reduce(
        (s, b) => s + parseFloat(b.priceSgd),
        0
      );
    }
  }

  const returnRatePct =
    matureFirstTimersCount === 0
      ? null
      : Math.round((returnedCount / matureFirstTimersCount) * 100);

  const netRoi = returnRevenue - discountGiven;

  return c.json({
    period: periodParam,
    first_timers_count: firstTimersCount,
    discount_given_sgd: discountGiven.toFixed(2),
    mature_first_timers_count: matureFirstTimersCount,
    returned_count: returnedCount,
    return_rate_pct: returnRatePct,
    return_revenue_sgd: returnRevenue.toFixed(2),
    net_roi_sgd: netRoi.toFixed(2),
  });
});
```

- [ ] **Step 3: Ensure imports are complete**

Check that the top of the file already imports `gt` from `drizzle-orm` — if not, add it:

```ts
import { eq, and, gte, lte, gt, sql } from "drizzle-orm";
```

Also ensure `services` is imported from `@glowos/db`:

```ts
import { ..., bookings, services, ... } from "@glowos/db";
```

Grep the file's existing imports and add only what's missing.

- [ ] **Step 4: Type check**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/.worktrees/<worktree-name>/glowos/services/api
pnpm tsc --noEmit
```

Expect: no new errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/.worktrees/<worktree-name>
git add glowos/services/api/src/routes/analytics.ts
git commit -m "feat(api): /first-timer-roi analytics endpoint"
```

---

## Task 6: Add `FirstTimerROI` frontend section

**Files:**
- Modify: `glowos/apps/web/app/dashboard/analytics/page.tsx`

- [ ] **Step 1: Add the type for the endpoint response**

Near the other `interface …Data` type declarations at the top of the file, add:

```ts
interface FirstTimerROIData {
  period: string;
  first_timers_count: number;
  discount_given_sgd: string;
  mature_first_timers_count: number;
  returned_count: number;
  return_rate_pct: number | null;
  return_revenue_sgd: string;
  net_roi_sgd: string;
}
```

- [ ] **Step 2: Add state + fetch in the main component**

Find the main component's `useState` declarations for the existing analytics data (e.g. `summaryData`, `revenueData`, etc.). Alongside them, add:

```tsx
const [firstTimerROIData, setFirstTimerROIData] = useState<FirstTimerROIData | null>(null);
const [firstTimerROILoading, setFirstTimerROILoading] = useState(true);
```

Then in the existing `useEffect` (or the analogous fetch block — look for where `summaryData` is fetched), add a fetch call:

```tsx
apiFetch(`/merchant/analytics/first-timer-roi?period=${period}`)
  .then((data) => setFirstTimerROIData(data as FirstTimerROIData))
  .catch(() => setFirstTimerROIData(null))
  .finally(() => setFirstTimerROILoading(false));
```

Match whatever pattern the other sections use (Promise.all, async/await, etc.) — don't invent a new one. Set `firstTimerROILoading` to `true` before each refetch so the skeleton shows again on period change.

- [ ] **Step 3: Define the `FirstTimerROI` component**

Find the other section components (e.g., `RatingTrend`). Below the last one, add:

```tsx
function FirstTimerROI({
  data,
  loading,
}: {
  data: FirstTimerROIData | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">
          First-Timer Discount Performance
        </h2>
        <SkeletonCard />
      </div>
    );
  }

  if (!data || data.first_timers_count === 0) {
    return (
      <div className="bg-white rounded-2xl border p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">
          First-Timer Discount Performance
        </h2>
        <p className="text-sm text-gray-500">
          No first-timer discounts granted in this period.
        </p>
      </div>
    );
  }

  const net = parseFloat(data.net_roi_sgd);
  const netPositive = net >= 0;
  const netLabel = `${netPositive ? "+" : "−"}SGD ${Math.abs(net).toFixed(2)}`;
  const netColor = netPositive ? "text-green-600" : "text-orange-600";

  return (
    <div className="bg-white rounded-2xl border p-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">
        First-Timer Discount Performance
      </h2>

      {/* Net ROI hero */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 mb-4">
        <div className="text-xs text-gray-500 mb-1">Net ROI</div>
        <div
          className={`text-3xl font-bold ${netColor}`}
          aria-label={`Net return on investment: ${netPositive ? "positive" : "negative"} ${Math.abs(net).toFixed(2)} Singapore dollars.`}
        >
          {netLabel}
        </div>
        <div className="text-xs text-gray-400 mt-1">
          return revenue − discount given
        </div>
      </div>

      {/* 4 stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-1">First-timers</div>
          <div className="text-xl font-semibold text-gray-900">
            {data.first_timers_count}
          </div>
        </div>
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-1">Discount given</div>
          <div className="text-xl font-semibold text-gray-900">
            SGD {parseFloat(data.discount_given_sgd).toFixed(2)}
          </div>
        </div>
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
          <div
            className="text-xs text-gray-500 mb-1"
            title={
              data.return_rate_pct === null
                ? "Need at least one first-timer from 30+ days ago."
                : undefined
            }
          >
            Return rate (30d+)
          </div>
          <div className="text-xl font-semibold text-gray-900">
            {data.return_rate_pct === null ? "—" : `${data.return_rate_pct}%`}
          </div>
        </div>
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-1">Revenue from returns</div>
          <div className="text-xl font-semibold text-gray-900">
            SGD {parseFloat(data.return_revenue_sgd).toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}
```

Adjust class names (rounded-2xl vs xl, p-6 vs p-5, etc.) to match the visual style of neighboring sections if they use different conventions.

- [ ] **Step 4: Render the component in the page JSX**

Find where `<RatingTrend data={…} />` is rendered. Immediately after it, add:

```tsx
<FirstTimerROI data={firstTimerROIData} loading={firstTimerROILoading} />
```

- [ ] **Step 5: Type check**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/.worktrees/<worktree-name>/glowos/apps/web
pnpm tsc --noEmit
```

Expect: no new errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/.worktrees/<worktree-name>
git add glowos/apps/web/app/dashboard/analytics/page.tsx
git commit -m "feat(web): First-Timer Discount Performance section in analytics"
```

---

# M4: Rollout

## Task 7: Merge, apply migration, verify

**Files:** None (rollout only)

- [ ] **Step 1: Merge feature branch to main + push**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm
git checkout main
git merge --no-ff feature/first-timer-roi -m "Merge feature/first-timer-roi"
git push origin main
```

- [ ] **Step 2: Apply the migration to production BEFORE Railway finishes deploying**

Same `pg` script pattern used for `merchants.country`. Copy a script into the api package (where `pg` is a dep):

```ts
// Temporary file: glowos/services/api/_migrate.ts
import pg from "pg";
async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query(`ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "first_timer_discount_applied" boolean DEFAULT false NOT NULL;`);
  const r = await c.query(`SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name='bookings' AND column_name='first_timer_discount_applied';`);
  console.log("Column state:", JSON.stringify(r.rows, null, 2));
  await c.end();
}
main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
```

Run:

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/glowos/services/api
DATABASE_URL="<production connection string>" npx tsx _migrate.ts
rm _migrate.ts
```

Expected output:

```
Column state: [{"column_name":"first_timer_discount_applied","data_type":"boolean","column_default":"false","is_nullable":"NO"}]
```

- [ ] **Step 3: Wait for Railway to finish deploying**

Hit the health endpoint until a new deploy is live (the response will include a later `timestamp`):

```bash
curl -sS https://bookingcrm-production.up.railway.app/health
```

Railway typically takes 1–2 min after push.

- [ ] **Step 4: Smoke-test the new endpoint**

```bash
# Expect all zeros since no bookings have the flag yet
curl -sS -H "Authorization: Bearer <your merchant jwt>" \
  "https://bookingcrm-production.up.railway.app/merchant/analytics/first-timer-roi?period=30d" \
  | python3 -m json.tool
```

Expected: JSON response with `first_timers_count: 0`, `mature_first_timers_count: 0`, `return_rate_pct: null`, etc.

If you don't have a JWT handy, the frontend section will exercise this automatically — just open the dashboard in the next step.

- [ ] **Step 5: Frontend smoke test**

Open `https://glowos-nine.vercel.app/dashboard/analytics` in a browser. Log in as a merchant. Scroll to the bottom. Expected:
- "First-Timer Discount Performance" section renders
- Empty state ("No first-timer discounts granted in this period.") displays since no tagged bookings exist yet
- Period selector toggling (7d/30d/90d/365d/all) does not throw errors

- [ ] **Step 6: Create a test first-timer booking and verify it's tagged**

Use the `/embed/abc` or `/abc` widget to complete a booking on a service that has first-timer discount enabled + a first-timer phone number. After booking:

```sql
SELECT id, price_sgd, first_timer_discount_applied, booking_source
FROM bookings
ORDER BY created_at DESC
LIMIT 5;
```

Expected: the latest row has `first_timer_discount_applied = true`.

Then refresh the analytics dashboard. Expected: the section now shows `first_timers_count: 1`, a populated `discount_given_sgd`, `return_rate_pct: —` (mature cohort still zero), negative Net ROI.

- [ ] **Step 7: Regression check**

Verify the other 11 analytics sections still render correctly. Specifically:
- `SummaryCards` — bookings, revenue, active clients, new clients
- `RevenueChart` — line chart
- `RatingTrend` — ratings over time

Any section breaking would indicate an accidental join/query interference from Task 5.

- [ ] **Step 8: Update progress.md**

Append a short "First-Timer Discount ROI Analytics ✅" entry to the Session 12 section of `progress.md`. Commit + push:

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm
git add progress.md
git commit -m "docs: Session 12 — first-timer ROI analytics shipped"
git push origin main
```

---

## Plan Self-Review Notes

- **Spec coverage:**
  - Migration + schema column → Tasks 1–2
  - Flag setting in payments.ts and bookings.ts → Tasks 3–4
  - Analytics endpoint → Task 5
  - Frontend section (hero Net ROI + 4 cards, empty state, null return-rate handling, color semantics) → Task 6
  - Rollout ordering (migration before Railway deploy) → Task 7
  - Manual test checklist → Task 7 steps 4–7
- **Placeholder scan:** no `TBD` / `TODO` / "implement later" markers. All tasks include concrete code snippets.
- **Type consistency:** `firstTimerDiscountApplied` (camelCase) is used in Tasks 1, 3, 4, 6 and matches the drizzle convention. `first_timer_discount_applied` (snake_case) is the column name, used in Tasks 2, 5, 7. Consistent.
- **Out of scope (per spec):** OTP health metrics, trend chart, cohort table, CSV export, historical backfill, price snapshotting. None of these have tasks.
