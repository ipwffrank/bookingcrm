# First-Timer Discount ROI Analytics — Design Spec

**Date:** 20 April 2026
**Status:** Drafted, pending user review
**Scope:** A new "First-Timer Discount Performance" section in the merchant analytics dashboard that answers one question: "Is the first-timer discount making me money?" Four stat cards + a prominent Net ROI number. One new backend endpoint, one new frontend component, one small schema addition.

---

## Motivation

The first-timer discount feature (Session 11) closed the abuse vector but left merchants with no way to see whether the discount is actually working. The retention economics question — *"am I acquiring new customers who return, or giving away money to one-time lookie-loos?"* — is the highest-value single question analytics can answer for this feature. Today it can only be answered by hand-querying the database.

---

## Scope

**In scope:**

- One new analytics section: "First-Timer Discount Performance"
- One backend endpoint: `GET /merchant/analytics/first-timer-roi`
- One DB column: `bookings.first_timer_discount_applied boolean not null default false`
- Set the flag in `payments.ts` and `bookings.ts` when the first-timer discount is actually granted
- 4 stat cards + a prominent Net ROI hero number

**Out of scope (deliberate):**

- OTP verification health metrics (operator concern, not merchant; belongs in Railway logs)
- Trend chart over time (v2 once merchants actually request it)
- Cohort-by-month drill-down table (too dense for the salon-merchant audience)
- CSV export (not requested)
- Backfill of historical bookings (flag starts fresh; pre-feature first-timer grants stay untagged)
- Price snapshotting (merchant editing service prices later shifts the `discount_given_sgd` historical number — acceptable for v1)
- Incremental discount math vs. total discount (v1 shows total — easier to explain, directionally correct)

---

## Data Model Change

**Migration `0009_bookings_first_timer_flag.sql`** (hand-written, minimal):

```sql
ALTER TABLE "bookings" ADD COLUMN "first_timer_discount_applied" boolean NOT NULL DEFAULT false;
```

- Default `false` means zero historical data loss and zero analytics pollution. Pre-feature bookings stay false, which is correct.
- Column is additive; no other schema impact.
- Snapshot JSON in `migrations/meta/` is updated alongside (following the same pattern established in commit `9d1b94d`).

**Drizzle schema addition** in `glowos/packages/db/src/schema/bookings.ts`:

```ts
firstTimerDiscountApplied: boolean("first_timer_discount_applied")
  .notNull()
  .default(false),
```

Placed among the existing boolean columns for consistency.

---

## Setting the Flag

In both `payments.ts` (the Stripe payment-intent flow) and `bookings.ts` (the pay-at-appointment `/:slug/confirm` flow), the code already has a branch that decides *"first-timer discount is eligible → apply it"*. At the exact moment the flag is set — AFTER `isFirstTimerAtMerchant` returns `true` AND the first-timer price is confirmed better than the regular price — also set `firstTimerDiscountApplied: true` on the booking insert.

Sketch (payments.ts, inside the existing first-timer block):

```ts
if (firstTimerEligible) {
  const firstTimerPrice = basePrice * (1 - service.firstTimerDiscountPct / 100);
  if (firstTimerPrice < priceSgd) {
    priceSgd = firstTimerPrice;
    firstTimerDiscountApplied = true;  // new local variable
  }
}
// ... later, when inserting:
await db.insert(bookings).values({
  // ...
  firstTimerDiscountApplied,
});
```

Same mirror applied to the `/booking/:slug/confirm` handler in `bookings.ts`.

No change to existing behavior: if the first-timer discount is NOT applied (regular discount wins, or no verification token, or returning customer), `firstTimerDiscountApplied` stays `false` and the booking inserts with the default.

---

## Backend Endpoint

**`GET /merchant/analytics/first-timer-roi`** (mounted via existing `analyticsRouter` at `/merchant/analytics`).

**Query param:** `period: "7d" | "30d" | "90d" | "365d" | "all"`. Matches the enum used by the other analytics endpoints.

**Auth:** existing `requireMerchant` middleware.

**Response shape:**

```json
{
  "period": "30d",
  "first_timers_count": 14,
  "discount_given_sgd": "62.50",
  "mature_first_timers_count": 10,
  "returned_count": 3,
  "return_rate_pct": 30,
  "return_revenue_sgd": "240.00",
  "net_roi_sgd": "177.50"
}
```

All monetary fields are stringified to two decimals (matching the convention used by `priceSgd`).

**Math:**

All four headline numbers refer to **first-timers whose first booking happened in the selected period AT THIS MERCHANT**:

1. `first_timers_count` — `COUNT(*)` of bookings where `merchant_id = X AND first_timer_discount_applied = true AND status = 'completed' AND start_time >= period_start AND start_time <= period_end`.
2. `discount_given_sgd` — for each such booking, compute `service.price_sgd - booking.price_sgd` and sum. This is the "total discount given to first-timers," including the overlap with regular discount. Uses live `service.price_sgd` (price-snapshot caveat documented above).
3. `mature_first_timers_count` — subset of the above where `start_time < NOW() - INTERVAL '30 days'`.
4. `returned_count` — of the mature cohort, count how many have ≥ 1 later completed booking at this merchant. "Later" means `start_time > that first-timer booking's start_time`.
5. `return_rate_pct` — `Math.round(returned_count / mature_first_timers_count * 100)`. Returns `null` if `mature_first_timers_count === 0` (avoids division by zero and avoids misleading "0%").
6. `return_revenue_sgd` — cumulative `SUM(price_sgd)` across ALL 2nd+ completed bookings of every client in the `returned` subset.
7. `net_roi_sgd` — `return_revenue_sgd - discount_given_sgd`.

**Time-domain asymmetry is intentional:** discount cost is recorded the moment it's given (including recent first-timers who haven't matured); return revenue is only counted for cohort members who've had 30+ days. This correctly models "you've already spent the discount dollars; the returns are pending for recent cohort members."

**Edge cases:**

- Merchant with zero first-timer bookings ever → returns all zeros and `return_rate_pct: null`.
- Merchant with exactly one recent first-timer booking (< 30d) → `first_timers_count: 1`, `discount_given_sgd` populated, `mature_first_timers_count: 0`, `return_rate_pct: null`, `return_revenue_sgd: "0.00"`, `net_roi_sgd` is negative (= `−discount_given_sgd`).

**Performance:** the query can join `bookings` to `services` for the price lookup. Existing indexes (`bookings.merchant_id`, `bookings.status`, `bookings.client_id`) cover the filters.

---

## Frontend Component

**New component:** `FirstTimerROI` rendered in `glowos/apps/web/app/dashboard/analytics/page.tsx`, placed **after** the existing `RatingTrend` section so it doesn't disrupt the current visual ordering.

**Layout:**

```
── First-Timer Discount Performance ───────────────────────────

  ┌──────────────────────────────────────────────┐
  │  Net ROI                                     │
  │  +SGD 177.50                                 │   ← hero, prominent
  │  return revenue − discount given             │
  └──────────────────────────────────────────────┘

  ┌────────────┬────────────┬────────────┬────────────┐
  │ First-     │ Discount   │ Return     │ Revenue    │
  │ timers     │ given      │ rate       │ from       │
  │            │            │ (30d+)     │ returns    │
  │    14      │ SGD 62     │    30%     │ SGD 240    │
  └────────────┴────────────┴────────────┴────────────┘
```

**State + data flow:**

- Hooks into the existing top-of-page `period` state (same pattern as `SummaryCards`, `RevenueChart`, etc.).
- Fetches on mount + whenever `period` changes via `useEffect`.
- Uses `apiFetch` → `GET /merchant/analytics/first-timer-roi?period={period}`.

**Loading state:** 4 skeleton cards + skeleton hero row, reusing the file's existing `SkeletonCard` component.

**Empty state** (when `first_timers_count === 0`): render a single muted line — *"No first-timer discounts granted in this period."* — with no cards, no numbers. Rendering zeros would look like data and mislead.

**Return-rate edge case** (`return_rate_pct === null`): the Return rate card shows `—` with a tooltip: *"Need at least one first-timer from 30+ days ago."* Common in the first month of the feature or for very small merchants.

**Net ROI visual:**

- `net_roi_sgd >= 0` → green (text-green-600), prefix `+`
- `net_roi_sgd < 0` → gray/orange (text-orange-600), prefix `−` (using the Unicode minus, not a hyphen)

**Card styling:** matches the existing `SummaryCards` layout — `rounded-2xl border p-5`, same typography hierarchy.

**Accessibility:** Net ROI card has an `aria-label` like `"Net return on investment: positive 177.50 Singapore dollars."`. Empty and edge-case states announce missing state for screen readers.

---

## Observability

No new logging. The existing `[Payments] discount_applied` log line already reports whether the first-timer discount path was taken, so the flag being set is visible in existing logs. Analytics queries run only when a merchant loads the dashboard page, so no background job metrics are needed.

---

## Testing Strategy

Manual (codebase has no automated tests):

- [ ] Empty state: merchant with zero first-timer bookings ever — renders "No first-timer discounts granted in this period." placeholder, no cards
- [ ] Fresh cohort only: merchant with 1 recent first-timer (< 30d) — cards show count + discount given; Return rate is `—`; Net ROI is negative
- [ ] Mature cohort + some returns: merchant with 5+ first-timers from 30+ days ago and some who returned — all cards populated, Net ROI matches hand-calculated value from direct SQL
- [ ] Period selector toggling (7d / 30d / 90d / 365d / all) refetches and updates all cards. Each fetch respects the period boundary.
- [ ] `first_timer_discount_applied` flag set correctly on new bookings — verified with:
      ```sql
      SELECT id, price_sgd, first_timer_discount_applied, booking_source
      FROM bookings
      ORDER BY created_at DESC LIMIT 10;
      ```
- [ ] Regression: the other 11 analytics sections still load and show the same numbers as before (no accidental join/query interference)
- [ ] API returns 401 for unauthenticated request; 400 for invalid `period` value
- [ ] Hand-calculated SQL agrees with endpoint response for one manually constructed test case

---

## Rollout

1. **Apply migration `0009_bookings_first_timer_flag.sql` to production DB** via the same `pg` script pattern used for `merchants.country` (commit `9d1b94d`). Must run BEFORE Railway deploys the new code, otherwise queries reading the column break.
2. **Deploy backend** (merge to main → Railway auto-deploys). Endpoint becomes available; `payments.ts`/`bookings.ts` start tagging new first-timer grants.
3. **Deploy frontend** (same merge → Vercel auto-deploys). New section appears in the analytics dashboard.
4. **Smoke test** with a real booking through the `/embed/abc` or `/abc` widget that claims the first-timer discount. Verify the flag is set in DB, then verify the analytics section picks it up.
5. **Update `progress.md`** with Session 12's G entry.

---

## Files Touched

**New:**

- `glowos/packages/db/src/migrations/0009_bookings_first_timer_flag.sql`
- `glowos/packages/db/src/migrations/meta/0009_snapshot.json` (auto or hand-updated)

**Modified:**

- `glowos/packages/db/src/schema/bookings.ts` — add `firstTimerDiscountApplied` boolean column
- `glowos/services/api/src/routes/payments.ts` — set the flag when first-timer discount applies
- `glowos/services/api/src/routes/bookings.ts` — same, in `/:slug/confirm`
- `glowos/services/api/src/routes/analytics.ts` — new `/first-timer-roi` handler
- `glowos/apps/web/app/dashboard/analytics/page.tsx` — new `FirstTimerROI` component + render after `RatingTrend`
