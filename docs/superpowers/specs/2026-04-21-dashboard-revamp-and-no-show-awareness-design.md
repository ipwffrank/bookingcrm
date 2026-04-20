# Dashboard Revamp + No-Show Awareness

**Date:** 2026-04-21
**Session:** 15
**Status:** Draft

## Problem

The merchant dashboard today is a bare list of today's bookings plus a four-tile status summary. It doesn't answer the questions staff ask first thing in the morning:

1. How much money are we earning today?
2. Who's already checked in, who's no-show, who's coming?
3. Are there any clients I should be careful about (no-show history)?
4. Are any recent reviews complaining?

It also misses the nuance that cancelled and no-show bookings can still be revenue if the merchant's policy charges for them, but no code today persists or surfaces that "retained" amount.

## Scope

**In scope**

- A redesigned Dashboard landing: four clickable status cards (Confirmed / In Progress / Completed / No-Show), a Revenue card with a breakdown, and a conditional Low Ratings card. Each status card filters the bookings list below via a URL query param.
- An honest Today's Revenue calculation that includes: completed/in-progress service prices + retained portion of cancelled bookings + retained portion of no-show bookings + package sales purchased today.
- No-show awareness: a `⚠ N no-shows` chip on the client in BookingForm, the client detail page, and the clients list. Zero no-shows → chip hidden.
- Automatic retained-revenue accounting on no-show: the `/no-show` endpoint now stores `refundAmountSgd` from `cancellation_policy.no_show_charge`, matching how cancellation already works.

**Out of scope (explicit)**

- Waitlist — separate session.
- Hard block on clients with many no-shows — not wanted. The chip is the only deterrent.
- Denormalized `no_show_count` on `client_profiles` — computed on the fly for now; revisit only if measurably slow.
- Configurable `no_show_refund_pct` — partial is hardcoded at 50%. A `no_show_refund_pct` setting can follow if staff want it.
- Staff revenue attribution (full amount to each staff on multi-staff bookings, both merchant and staff dashboards). Noted as a future feature.
- Projected revenue (confirmed-but-not-yet-completed today) — deferred.
- Hard block after N no-shows — explicitly not planned.

## Data model

No schema changes. Uses existing columns:

- `bookings.refundAmountSgd` (already on the table; already populated on cancellation).
- `bookings.noShowAt` (already populated by the `/no-show` endpoint).
- `bookings.status` including `'no_show'`, `'cancelled'`, `'completed'`, `'in_progress'`.
- `client_packages.pricePaidSgd`, `purchasedAt` for package revenue.
- `merchants.cancellationPolicy.no_show_charge` (`"full" | "partial" | "none"`) already in the schema.

## API

### `PUT /merchant/bookings/:id/no-show` — persist retained revenue

Today the handler sets `status='no_show'` and `noShowAt=now()`. It now also reads the merchant's `cancellationPolicy.no_show_charge` and stores `refundAmountSgd`:

```ts
const chargePolicy = (merchant.cancellationPolicy as { no_show_charge?: "full" | "partial" | "none" } | null)
  ?.no_show_charge ?? "full";
const refundPct = chargePolicy === "full" ? 0 : chargePolicy === "partial" ? 50 : 100;
const refundAmountSgd = ((Number(booking.priceSgd) * refundPct) / 100).toFixed(2);

await tx.update(bookings)
  .set({ status: "no_show", noShowAt: new Date(), refundAmountSgd, updatedAt: new Date() })
  .where(eq(bookings.id, bookingId));
```

Semantics: `priceSgd − refundAmountSgd` is the amount the merchant retains, for both cancelled and no-show bookings.

### New: `GET /merchant/analytics/today-revenue`

```jsonc
{
  "completedRevenue": "320.00", // sum(price_sgd) where status in ('completed', 'in_progress') and start_time::date = today
  "cancelledRetained": "25.00", // sum(price_sgd - refund_amount_sgd) where status='cancelled' and cancelled_at::date = today
  "noShowRetained":    "88.00", // sum(price_sgd - refund_amount_sgd) where status='no_show' and no_show_at::date = today
  "packageRevenue":    "120.00",// sum(price_paid_sgd) from client_packages where purchased_at::date = today
  "total":             "553.00"
}
```

All date comparisons use the merchant's timezone. The endpoint is protected by `requireMerchant`.

### Client no-show count exposed on three existing endpoints

No new endpoints. Each response gains a `noShowCount: number` field computed via a simple `COUNT(*)` subquery:

- `GET /merchant/clients/lookup?phone=X` — adds `noShowCount` to the returned client object.
- `GET /merchant/clients/:id` — adds `noShowCount` at the top level of the detail response.
- `GET /merchant/clients` (list) — adds `noShowCount` per client row.

SQL shape for the list:

```sql
SELECT c.*, (
  SELECT COUNT(*) FROM bookings b
  WHERE b.client_id = c.id
    AND b.merchant_id = :merchantId
    AND b.status = 'no_show'
) AS no_show_count
FROM clients c
WHERE c.merchant_id = :merchantId
ORDER BY ...
```

If the list endpoint's response time suffers, we denormalize later.

## Frontend

### `/dashboard` (page.tsx) — new layout

**Row 1 — Status cards, clickable filters.** Today's four-tile summary already exists; the redesign wraps each tile in a `<button>` that toggles `?status=<state>` in the URL. When a card is selected, it renders with a ring, the bookings list below filters to that state, and an "All" pill appears on the right of the row as a clear-filter. Click the same card again → clears the filter.

State:
- `const [statusFilter, setStatusFilter] = useState<BookingStatus | null>(...)` initialized from `searchParams.get('status')`.
- Router push via `router.replace('/dashboard?status=confirmed')` so clicks are bookmarkable and back-button-friendly.
- Bookings list `.filter(b => !statusFilter || b.booking.status === statusFilter)`.

**Row 2 — Revenue card.** A single wide card:

```
Today's Revenue                                   S$ 553.00
─────────────────────────────────────────────────────────
Services completed                  S$ 320.00
Cancellations retained              S$  25.00
No-shows retained                   S$  88.00
Packages sold                       S$ 120.00
```

Fetched from `GET /merchant/analytics/today-revenue`. The whole card is a `<Link>` to `/dashboard/analytics?period=today`. A loading skeleton keeps the height stable.

**Row 3 — Low ratings (conditional).** Fetches the same reviews endpoint the Reviews page uses (`GET /merchant/reviews?period=7d&maxRating=2&limit=5`). Rendered only when the response has ≥1 review. Each row: `★ rating · service · staff · short comment · client name · phone`. The whole row is a `<Link>` to `/dashboard/clients/[clientId]`.

**Under all three rows:** the existing Today's Bookings list continues to render, now filtered by `statusFilter`.

### Client no-show chip — shared component

New component `NoShowChip` in `apps/web/app/dashboard/components/NoShowChip.tsx`:

```tsx
export function NoShowChip({ count }: { count: number }) {
  if (!count || count <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-red-200 bg-red-50 text-red-700">
      ⚠ {count} no-show{count > 1 ? 's' : ''}
    </span>
  );
}
```

Used in three places:

1. **BookingForm** after phone lookup — rendered next to the filled-in client name inside the existing "Client Name" field row, only when `maybeLookupClient` returns a client with `noShowCount > 0`.
2. **Client detail page header** — placed next to the VIP / churn badges.
3. **Clients list page** — new column "Flags" (or just an icon-only cell) per row.

All three read the same `noShowCount` field from their respective API responses.

## Edge cases

1. **Policy missing.** If `merchants.cancellationPolicy` is null, no-show defaults to `"full"` charge → `refundAmountSgd = 0`, merchant retains full price. Same default as existing cancellation logic.
2. **Booking marked no-show twice.** Endpoint already 409s if status isn't `confirmed`/`in_progress`. Still true after the change.
3. **Booking manually edited from no-show to completed.** The stored `refundAmountSgd` remains (we don't re-zero it automatically). If this ever becomes confusing, future work: `PATCH booking` clears `refundAmountSgd` on status change out of cancelled/no-show. Out of scope for this session.
4. **Historical no-shows before this ship date.** Their `refundAmountSgd` is 0 (the default). Today's Revenue endpoint filters by `no_show_at::date = today`, so historical rows don't affect today's numbers regardless. No backfill needed.
5. **Staff marks the same booking Complete and then Undo.** Not a flow we currently support. Out of scope.
6. **Empty day.** All four status counts = 0, Revenue = S$0.00 with zeros in every sub-line, Low Ratings card hidden. Bookings list shows the existing "No bookings today" empty state.
7. **Client shared across merchants.** The `COUNT(*)` for `noShowCount` must filter `merchant_id = :merchantId`. A client who no-showed at a different salon does not get flagged here. Covered by the SQL shape in the API section.

## Testing

Typecheck is the minimum. Manual verification:

- **API / curl:** create a no-show via `/no-show` for a S$58 booking with policy `no_show_charge='partial'` → verify DB has `refundAmountSgd = 29.00`. Then hit `/merchant/analytics/today-revenue` → verify `noShowRetained = 29.00`.
- **Frontend:** Walk-through on a seeded day:
  1. Create a client, book them, mark no-show. Verify `⚠ 1 no-show` chip appears in BookingForm when their phone is entered again.
  2. Click "Confirmed" card → URL updates → bookings list filters to confirmed. Click "All" → clears.
  3. Revenue card total matches manual sum of today's data.
  4. Add a 1-star review via the existing review flow → appears on the dashboard's Low Ratings card.

## Migration / Rollout

- No DB migration.
- No feature flag — pure UI overhaul, no behavior change for clients' bookings.
- Deploy API and web together. Historic no-shows keep their `refundAmountSgd = 0` value; only no-shows created after the ship date pick up the retained amount.

## Open Questions

None after Section 1–4 walkthrough.
