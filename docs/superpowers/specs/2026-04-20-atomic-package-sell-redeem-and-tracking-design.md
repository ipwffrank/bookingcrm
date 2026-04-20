# Atomic Package Sell + Redeem, and Package Activity Tracking

**Date:** 2026-04-20
**Session:** 14
**Status:** Draft

## Problem

Two related gaps in the walk-in flow today:

1. **Atomic buy + redeem is not supported.** A walk-in who decides to buy a
   package and use one session for today's treatment must be saved in two
   separate transactions: first the walk-in + package sale, then an Edit to
   toggle redemption. The root cause lives in
   [`services/api/src/routes/booking-groups.ts`](../../glowos/services/api/src/routes/booking-groups.ts)
   — the `sell_package` block runs at the end of the POST transaction, so the
   newly-created `package_sessions` don't exist yet when the booking-insert
   loop is asked to consume them. Pre-transaction validation at lines 143–163
   rejects the request with 404 "Package session not found".

2. **`booking_groups.totalPriceSgd` undercounts revenue when packages are
   sold.** Today the group total is sum-of-booking-prices only. If staff
   sells a S$500 package and redeems today's session (booking price = 0),
   the group total is S$0 and the S$500 lives only on `client_packages
   .pricePaidSgd`. Downstream payment confirmation UI and daily-cash reports
   see the wrong number.

A third, smaller gap: tracking of package activity is thin. Progress is
visible on the client detail page (used/total bar), but there is no
per-session audit (who redeemed what, when) and no purchase/redemption
timeline. Data already exists to render both — only the UI is missing.

## Scope

**In scope:**

- POST `/merchant/bookings/group` — atomic buy + redeem via new
  `use_new_package` flag on service rows.
- `booking_groups.totalPriceSgd` = sum of booking prices **plus** sold
  package price (semantic change).
- POST group response includes the sold package's session rows so the
  frontend can render capacity immediately.
- BookingForm — new "Redeem from new package" pill on each eligible
  service row; capacity header; total breakdown when a package is sold.
- Client detail page — expandable per-package session list; package
  activity timeline.

**Out of scope:**

- PATCH `/merchant/bookings/group/:groupId` — editing a group will **not**
  support adding a package sale retroactively. Staff who need that today
  continue to void and recreate.
- Merchant analytics page changes.
- Export / CSV.
- Price-snapshot-at-purchase (already captured on
  `client_packages.pricePaidSgd`).
- Server-side capacity validation for "more rows than the package allows"
  beyond the basic "row's service is in package" check. The UI prevents it;
  the server trusts the client for quantity.

## Data Model

No new tables. No migrations.

Existing tables used:

- `booking_groups` (parent: payment + total)
- `bookings` (children; `priceSgd` becomes "0.00" when redeemed)
- `client_packages` (`sessionsUsed` / `sessionsTotal`, auto-flip to
  `status='completed'` when full — already handled by
  `incrementPackageSessionsUsed`)
- `package_sessions` (each session has `status`, `bookingId`, `staffId`,
  `completedAt` — already the audit record we need)

**Semantic change:** `booking_groups.totalPriceSgd` is now defined as
*sum of child booking prices + sold package price paid* (if any), not just
sum of booking prices. No backfill needed — no atomic buy+redeem existed
before, so historical totals remain correct under both definitions.

## API

### POST `/merchant/bookings/group`

**`serviceItemSchema` gains a `use_new_package` boolean:**

```ts
const serviceItemSchema = z.object({
  booking_id: z.string().uuid().optional(),
  service_id: z.string().uuid(),
  staff_id: z.string().uuid(),
  start_time: z.string().datetime().optional(),
  price_sgd: z.number().nonnegative().optional(),
  use_package: z.object({
    client_package_id: z.string().uuid(),
    session_id: z.string().uuid(),
  }).optional(),
  use_new_package: z.boolean().optional(),
})
.refine(
  (v) => !(v.use_package && v.use_new_package),
  { message: "cannot combine use_package and use_new_package on one row" }
);
```

**Pre-tx validation:**

- Existing `use_package` entries — unchanged (session exists, pending, right
  client_package).
- `use_new_package` rows — reject with 400 if `body.sell_package` is absent.
- `use_new_package` rows — reject with 400 if the row's `service_id` is not
  in `servicePackages.includedServices` of the sold package.

**Transaction reordering** (the core fix). Inside the tx:

1. Insert `booking_groups` parent row.
2. Ensure `client_profiles` row exists.
3. **If `sell_package` present** — create the `client_packages` row and
   insert all `package_sessions` rows (status `pending`).
   Build an in-memory "sold session pool":
   `Map<serviceId, sessionId[]>` from the just-created sessions.
4. Booking insert loop, for each row `r`:
   - If `r.use_new_package` — pop the first session from
     `pool.get(r.service_id)`. If the pool is empty for that service,
     throw `new Error("new_package_capacity_exceeded")` — caller returns
     400 with a useful message.
   - Else if `r.use_package` — existing path (flip session to completed,
     `incrementPackageSessionsUsed`).
   - Else — regular booking at `priceSgd`.
5. Compute `groupTotal = sum(bookingPrices) + soldPackagePrice`. Since
   `booking_groups` is inserted before prices are known, issue an UPDATE
   at the end of the transaction to set `totalPriceSgd`.

Any sessions left in the pool at end of loop remain `pending` — that is
the common case ("bought 10, used 1 today, 9 remaining").

**Response (extended):**

```jsonc
{
  "group": { ... },
  "bookings": [ ... ],
  "soldPackage": {
    "id": "...",
    "packageName": "...",
    "sessionsTotal": 10,
    "sessionsUsed": 1,
    "pricePaidSgd": "500.00",
    "expiresAt": "...",
    "sessions": [
      { "id": "...", "serviceId": "...", "sessionNumber": 1,
        "status": "completed", "bookingId": "..." },
      { "id": "...", "serviceId": "...", "sessionNumber": 2,
        "status": "pending", "bookingId": null }
      // ...
    ]
  }
}
```

### GET `/merchant/packages/client/:clientId`

No DB change. Endpoint currently returns `{ ...pkg, sessions }` where each
session includes `bookingId`, `staffName`, `staffId`, `completedAt`, and
`serviceId`. Missing for the new timeline UI: the service **name** (UI
wants "Gel Manicure", not a UUID). Fix: add a LEFT JOIN on `services` in
the session query so each session also returns `serviceName`. No other
caller relies on the current shape; the extra field is additive.

## Frontend

### BookingForm (`apps/web/app/dashboard/bookings/BookingForm.tsx`)

- `ServiceRowState` gains `useNewPackage?: boolean`.
- After `sellPackageId` is chosen, compute a per-service capacity map from
  `packageTemplates.find(...)includedServices`.
- Compute a per-service **used-count** from `rows.filter(r => r.useNewPackage
  && r.serviceId === svcId).length`.
- Pass the template + capacity map + used-count to each `ServiceRow`.
- Total card: render breakdown (Services / Package / Total) when
  `sellPackageId` is set.
- Submit payload — add `use_new_package: true` for flagged rows. Do not
  send alongside `use_package`.

### ServiceRow (`apps/web/app/dashboard/bookings/ServiceRow.tsx`)

New pill next to "Use package":

- Shown only if `sellPackageTemplate` is passed AND the row's `service_id`
  is in `sellPackageTemplate.includedServices`.
- Mutually exclusive with the existing "Use package" pill — if one is
  toggled on, the other clears.
- When over capacity (current used-count for this service exceeds
  quantity), the pill is disabled and shows `⚠ exceeds package quantity`.
- Toggling on: `onChange({ useNewPackage: true, usePackage: undefined,
  priceSgd: '0.00', priceTouched: false })`.
- Toggling off: `onChange({ useNewPackage: false, priceSgd:
  service.priceSgd, priceTouched: false })`.

Label: `✓ Redeem from new package` when active, `Redeem from new package`
when available.

### Capacity header (above services list)

When `sellPackageId` is set, render a compact line per included-service:

```
Selling Gel Manicure Starter (S$500):
  · Gel Manicure — 1 of 10 to redeem today, 9 remaining
  · Pedicure     — 0 of 5 to redeem today, 5 remaining
```

Updates live as staff toggle rows.

### Client detail page (`apps/web/app/dashboard/clients/[id]/page.tsx`)

Two additions, both above or within the existing "Packages" card:

1. **Activity timeline (new, above Packages).** Flatten
   `clientPackagesData` into events:
   - Purchase: `{ type: 'purchase', when: pkg.purchasedAt, packageName,
     pricePaid }`
   - Redemption: `{ type: 'redemption', when: session.completedAt,
     serviceName, staffName, bookingId }` for every session with status
     `completed`.
   - Sort descending by `when`. Render as compact rows with emoji + text.

2. **Expandable sessions list (inside each package card).** Add a "Show
   sessions" toggle that reveals a table with columns: Status, Service,
   Used on, By, Booking-link. Pending rows render `—` in the last three.

Read-only. No mutating actions (the existing "complete session" button
stays where it is — this is an audit view, not an edit view).

## Edge Cases

1. **Staff sells package but redeems none today.** All sessions remain
   pending; group total = service prices + package price. Standard.
2. **Staff redeems more than included.** UI prevents it (capacity header
   + disabled pill); if the client somehow posts it anyway, server
   returns 400 `new_package_capacity_exceeded`.
3. **Row has `use_package` AND `use_new_package`.** Zod `.refine`
   rejects with 400.
4. **Package contains services not on any row.** Those sessions remain
   pending. Normal — client buys 10 manicures, redeems 1 today, 9 wait.
5. **Existing client buys another package while using an old one.** Form
   supports: some rows toggle `use_package` (old package), others toggle
   `use_new_package` (newly sold). Mutually exclusive per row only.
6. **Sold package + row is free under new package + client has a
   first-timer discount.** First-timer flagging logic applies to
   non-redeemed rows only. Redeemed rows were never eligible for a
   discount (price is 0).
7. **Server error during session insert but after package insert.** Full
   rollback — the transaction is atomic as today.

## Testing

- **API:** extend POST group tests with: (a) buy-only (no
  `use_new_package`), (b) buy + redeem one, (c) buy + redeem multiple of
  the same service, (d) buy + redeem across different services in a
  bundle package, (e) rejection of invalid row service, (f) rejection of
  combined `use_package` + `use_new_package`, (g) totalPriceSgd includes
  package price.
- **Frontend:** Playwright walk-through:
  1. Add walk-in for new client → pick package to sell → toggle redeem on
     first row → submit → verify booking at S$0, client_package at
     S$500, session #1 completed, 9 pending, total on confirmation
     matches S$500.
  2. Add walk-in for existing client with active package → toggle "Use
     package" → submit → same as today's Scenario 2 behavior.
- **Client detail page:** visual check after the two scenarios above —
  confirm activity timeline and expandable session list render correctly.

## Migration / Rollout

- No DB migration.
- No feature flag — behavior is additive (`use_new_package` is new field,
  old clients ignore it; total semantics change only when a package is
  sold in the same request, which is impossible today).
- Deploy API and web together.

## Open Questions

None remaining after the Section 1–4 walkthrough with the user.
