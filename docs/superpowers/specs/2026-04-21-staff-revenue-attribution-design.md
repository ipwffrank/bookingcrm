# Staff Revenue Attribution

**Date:** 2026-04-21
**Session:** 17
**Status:** Draft

## Problem

Merchants want to see which staff are contributing to revenue so they can manage performance; staff want to see their own numbers to feel ownership of their output. The current system has no staff-scoped revenue view and no way to credit package sales to the staff who closed the sale (which matters in salons that employ separate sales/consultant roles alongside treatment staff).

## Scope

**In scope**

- One new nullable column `client_packages.sold_by_staff_id` referencing `staff(id)`.
- Walk-in form UI: a "Sold by" dropdown surfaces whenever a package is being sold; defaults to the first service row's staff, overridable to any active staff.
- Two new API endpoints:
  - `GET /merchant/analytics/staff-contribution?period=today|7d|30d|90d|all` for the merchant's per-staff breakdown.
  - `GET /staff/my-contribution?period=today|7d|30d|90d|all` for a staff's own numbers.
- Merchant dashboard: a new "Staff Contribution" card between Revenue and Waitlist, with a period selector.
- Real `/staff/dashboard` page (replacing today's redirect) showing Today + This Month big cards plus a period filter.
- Services delivered valued at **list price**, not `bookings.price_sgd` — redeemed bookings ($0 price) still count as work.
- Packages sold valued at `client_packages.price_paid_sgd`, credited to `sold_by_staff_id`.
- Contribution is **two independent streams**: services delivered (by the performer) + packages sold (by the seller). Neither is split — both get full credit. Consistent with Session 15's multi-staff rule: each group-booking participant sees the group's full service total, not their child's portion.

**Out of scope (explicit)**

- Team leaderboard / rankings on staff view (self-only per Section 3 Option A).
- Historical backfill of `sold_by_staff_id` — old rows stay NULL and are excluded from merchant-view totals with a clear "(Unattributed)" row only if summed.
- Commission / payout calculation. Contribution is a "work done" metric, not a payout formula. `bookings.commission_rate` / `commission_sgd` are untouched.
- Editing `sold_by_staff_id` post-creation. No PATCH path for package sales.
- Per-service commission rates or target-vs-actual widgets.
- CSV export.

## Data Model

One new column:

```sql
ALTER TABLE "client_packages"
  ADD COLUMN "sold_by_staff_id" uuid REFERENCES "staff"("id") ON DELETE SET NULL;
```

`client_packages.sold_by_staff_id` is nullable. Existing rows get NULL. No index needed for v1 (merchant's staff count is small; contribution queries filter by `merchant_id` + period first, then group by staff; the existing `idx_client_packages_client` covers lookups by client).

Drizzle schema (`glowos/packages/db/src/schema/packages.ts`), inside `clientPackages`:

```ts
soldByStaffId: uuid("sold_by_staff_id").references(() => staff.id, { onDelete: "set null" }),
```

## Contribution Math

For a given merchant, period, and staff:

**Services delivered**
```sql
SUM(services.price_sgd)
FROM bookings
INNER JOIN services ON services.id = bookings.service_id
WHERE bookings.merchant_id = :merchantId
  AND bookings.staff_id    = :staffId
  AND bookings.status      IN ('completed', 'in_progress')
  AND bookings.start_time  BETWEEN :periodStart AND :periodEnd
```

Uses `services.price_sgd` (list price) not `bookings.price_sgd`, so redeemed bookings still carry value. Keyed on `start_time` for alignment with the Session 15 today-revenue card.

**Packages sold**
```sql
SUM(client_packages.price_paid_sgd)
FROM client_packages
WHERE merchant_id        = :merchantId
  AND sold_by_staff_id   = :staffId
  AND purchased_at       BETWEEN :periodStart AND :periodEnd
```

**Total contribution** = services + packages.

### Period bounds

All periods compute `periodStart` and `periodEnd` as absolute timestamps in **server local time** (same approach as the today-revenue card — multi-tz refinement is deferred):

- `today`: start of today 00:00:00 → end of today 23:59:59
- `7d` / `30d` / `90d`: now − N days → now
- `all`: `periodStart = 1970-01-01`, `periodEnd = now`

## API

### `GET /merchant/analytics/staff-contribution?period=today|7d|30d|90d|all`

- `requireMerchant`. Validates period; defaults to `today` if omitted.
- Joins `staff` so response includes each staff's name. All **active** staff for this merchant are returned (even with zero contribution) ordered by `total DESC`, then `staffName ASC` as tiebreak. Inactive staff still contributing in the period (edge case: they were active when they delivered) are **excluded** — dashboard targets current team management, not historical rosters.
- Response:

```jsonc
{
  "period": "today",
  "rows": [
    {
      "staffId": "...",
      "staffName": "Sarah Lim",
      "servicesDelivered": "320.00",
      "packagesSold":      "500.00",
      "total":             "820.00"
    }
    // ...
  ]
}
```

Implementation approach (single-query with two correlated subqueries per staff row is simplest; a `LEFT JOIN LATERAL` may be cleaner but either works for the expected scale — merchants have dozens of staff, not thousands).

### `GET /staff/my-contribution?period=today|7d|30d|90d|all`

- Uses the existing staff-scoped auth. Resolves `staffId` from the staff session.
- Same math, scoped to one staff.
- Response:

```jsonc
{
  "period": "today",
  "staffId": "...",
  "staffName": "Sarah Lim",
  "servicesDelivered": "320.00",
  "packagesSold":      "500.00",
  "total":             "820.00"
}
```

### Modified: `POST /merchant/bookings/group`

The existing `sell_package` Zod schema gains an optional `sold_by_staff_id: z.string().uuid().optional()`. When `sell_package` is present but `sold_by_staff_id` is missing, the server returns **400 Bad Request** with `"sold_by_staff_id is required when sell_package is provided"`. Enforcement lives at the API edge; the frontend prevents it from reaching there by disabling submit.

Validation: `sold_by_staff_id` must belong to the same merchant and be active. Returns 404 if not found. Stored on `client_packages.sold_by_staff_id`.

### Modified: `POST /merchant/packages/assign`

The standalone assign endpoint gains the same optional `sold_by_staff_id`. Same validation rules. For this endpoint it's optional (not required) — merchants may want to retroactively assign a package without attributing a seller.

## Frontend

### `BookingForm` (`glowos/apps/web/app/dashboard/bookings/BookingForm.tsx`)

Inside the existing "+ Also sell a package" disclosure, a new dropdown renders immediately below the package `<select>`:

```tsx
<label>Sold by</label>
<select
  value={soldByStaffId}
  onChange={(e) => setSoldByStaffId(e.target.value)}
  required
>
  <option value="">Select staff...</option>
  {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
</select>
```

- State: `soldByStaffId` initialized to the first service row's `staffId` when the package picker opens.
- Kept in sync when the user changes that first row's staff (only if `soldByStaffId` still matches the previous first-row staff — don't clobber a manual pick).
- Validation in `handleSubmit`: when `sellPackageId` is truthy and `soldByStaffId` is empty, show `"Pick who sold the package"` and block submit.
- Payload: `sell_package: { package_id, price_sgd?, sold_by_staff_id: soldByStaffId }`.

### Merchant dashboard card (`/dashboard`)

New component `StaffContributionCard` in `glowos/apps/web/app/dashboard/components/StaffContributionCard.tsx`. Placed between the Revenue card and the Waitlist tile.

```
┌────────────────────────────────────────────────┐
│ Staff Contribution    [Today ▾]                │
│ ─────────────────────────────────────────────  │
│                Services    Packages     Total  │
│ Sarah Lim      S$320.00    S$500.00   S$820.00 │
│ Michelle Tan   S$220.00    S$0.00     S$220.00 │
│ Wei Lin         S$88.00    S$0.00      S$88.00 │
│ Priya Nair       S$0.00    S$0.00       S$0.00 │
└────────────────────────────────────────────────┘
```

Period selector: `Today / 7d / 30d / 90d / All`. Default Today. Selection triggers a refetch and re-render. No drill-down.

### Staff personal dashboard (`/staff/dashboard`)

Replace the redirect at `glowos/apps/web/app/staff/dashboard/page.tsx` with a new page.

Initial load: `apiFetch('/staff/my-contribution?period=today')` + `apiFetch('/staff/my-contribution?period=30d')` in parallel.

Layout:

```
Hi Sarah

┌─ Today ──────────┐  ┌─ This month ─────┐
│  S$820.00        │  │  S$4,250.00       │
│  Services S$320  │  │  Services S$2,100 │
│  Packages S$500  │  │  Packages S$2,150 │
└──────────────────┘  └───────────────────┘

[Today] [7d] [30d] [90d] [All]

→ Your upcoming bookings
→ Your clients
```

Period pills: clicking one collapses the two-card row into a single big card showing only that period. "Today" pill resets to the two-card default view.

## Edge Cases

1. **`sold_by_staff_id` references an inactive staff.** The `staff.isActive` filter excludes them from the merchant-dashboard table. Their historical packages are invisible in the per-staff row, but the package sale still counts in today-revenue (merchant's cash view). Fine for v1.
2. **Staff delivers a booking then becomes inactive.** Same handling — the inactive staff isn't shown. Future: add a toggle to include inactive.
3. **Multi-staff group booking.** Each child booking's service price attributes to that child's staff. No splitting: each staff on the group shows the full value of **their** child rows — consistent with existing grain (one staff per booking row).
4. **Package purchased today, no seller attributed (NULL `sold_by_staff_id`).** Merchant's "Packages sold" totals exclude NULL rows. The `today-revenue` card (Session 15) is unaffected — it sums all `client_packages.price_paid_sgd` regardless of seller.
5. **Period selector set to "all" with lots of staff.** Should render fine; row count bounded by merchant's staff count (dozens, not thousands).
6. **Inactive staff attempts to access `/staff/dashboard`.** Existing staff auth handles session validation. A staff whose `isActive = false` might still have a valid session token; the page renders their numbers (they can see their own history). If we want to block this, it's a future concern — out of scope.

## Testing

Typecheck + manual verification, following project convention.

- **API:**
  - Create a walk-in with `sell_package` but no `sold_by_staff_id` → expect 400.
  - With both set → expect 201, DB row has the seller.
  - Hit `/merchant/analytics/staff-contribution?period=today` after creating a completed booking + a package sale → verify the two numbers appear against the right staff.
  - Hit `/staff/my-contribution?period=30d` with a staff token → verify single-staff response.

- **Frontend:**
  1. Open walk-in form, tick a package, submit without picking a seller → form blocks with error.
  2. Pick seller → submit → verify dashboard card updates.
  3. Log in as that staff (or simulate staff session) → `/staff/dashboard` shows Today + This month.
  4. Click "30d" on staff dashboard → single-card view; click "Today" → two-card default.

## Migration / Rollout

- One DB migration: `0013_client_packages_sold_by.sql` adds the nullable column.
- No feature flag. Additive.
- Deploy API + web together.

## Open Questions

None.
