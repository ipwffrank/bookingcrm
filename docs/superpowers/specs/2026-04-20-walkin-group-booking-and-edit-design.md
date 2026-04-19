# Walk-in Group Booking, Packages, and Editable Bookings — Design

**Status:** Design approved, pending implementation plan
**Author:** Frank Ip
**Date:** 2026-04-20

## Summary

Expand the merchant-side walk-in flow to support multiple services per visit with a single payment, integrate packages (both upselling a new package and redeeming an existing one), and add a general-purpose edit function that covers every booking status except `cancelled` — including `completed` bookings, so staff and admins can fix data-entry mistakes after the fact. Every edit is recorded in an audit log.

The existing single-service `WalkInModal` is replaced by a shared `BookingForm` modal used for both create and edit paths.

## Goals

- One walk-in = one payment, even when the client receives multiple services.
- Calendar still shows each service as its own slot (own staff, own time, own status).
- Staff at the counter can sell a package to a walk-in client, or redeem an existing client package against a service in the same visit.
- Any booking (except cancelled) can be edited — including completed — by both admin and staff.
- Every field-level change is logged with who, when, old, and new values.

## Non-Goals (explicit YAGNI)

- Role-based field restrictions (policy decision: no restrictions).
- Auto-recompute of commission when a completed booking is edited (frozen at completion).
- Editing cancelled bookings.
- Bulk edits across multiple bookings.
- An "undo edit" button — audit log is read-only; reverting is a new edit.
- Surfacing the full edit history as a separate page; a simple inline list inside the modal is enough for now.

## Data Model

All changes are additive. Existing single-service bookings and online bookings continue to work with no migration of existing rows.

### New table: `booking_groups`

Parent record that owns the payment and client for a multi-service walk-in. A group is always created for walk-ins, even when there's only one service, so the code path is uniform.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, pk | |
| `merchant_id` | uuid, fk → `merchants.id` | |
| `client_id` | uuid, fk → `clients.id` | |
| `total_price_sgd` | decimal(10,2) | Sum of child bookings at create; editable |
| `payment_method` | enum: `cash` / `card` / `paynow` / `other` | Standardized on the dashboard UI's existing enum. The older `walkins.payment_method` (`stripe` / `cash` / `otc`) is not used by this flow. |
| `notes` | text, nullable | |
| `created_by_user_id` | uuid, nullable | Staff/admin who created the group |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

Note: `booking_groups` has no `status` column. Status lives on each child booking (a group can have mixed statuses — e.g. manicure completed while pedicure is in progress). The group is purely a payment + audit container.

### New column: `bookings.group_id`

Nullable fk → `booking_groups.id`. NULL for existing bookings and for online bookings created via the public widget. Walk-ins always populate it.

### New table: `booking_package_redemptions`

Links a child booking to the client-package session it consumed. One booking can redeem at most one session (enforced by unique constraint on `booking_id`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, pk | |
| `booking_id` | uuid, fk → `bookings.id`, unique | |
| `client_package_id` | uuid, fk → `client_packages.id` | |
| `session_id` | uuid, fk → the client-package session row | |
| `created_at` | timestamp | |

On edit or delete of a booking that consumed a session, the session is re-credited and this row is deleted.

### New table: `booking_edits`

Audit log. One row per changed field per edit action. Supports both booking-level and group-level changes.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, pk | |
| `booking_id` | uuid, fk, nullable | |
| `booking_group_id` | uuid, fk, nullable | |
| `edited_by_user_id` | uuid | |
| `edited_by_role` | enum: `admin` / `staff` | |
| `field_name` | text | e.g. `"service_id"`, `"price_sgd"`, `"start_time"` |
| `old_value` | jsonb | |
| `new_value` | jsonb | |
| `created_at` | timestamp | |

## API

All new endpoints are merchant-scoped and require `requireMerchant` middleware.

### `POST /merchant/bookings/group`

Create a walk-in group booking. Creates the group row, N child `bookings`, any `booking_package_redemptions` rows, and optionally a new `client_package` if `sell_package` is provided.

**Request body:**

```json
{
  "client_name": "string",
  "client_phone": "string",
  "payment_method": "cash | card | paynow | other",
  "notes": "string?",
  "services": [
    {
      "service_id": "uuid",
      "staff_id": "uuid",
      "start_time": "ISO datetime?",
      "price_sgd": "number?",
      "use_package": { "client_package_id": "uuid", "session_id": "uuid" }
    }
  ],
  "sell_package": { "package_id": "uuid" }
}
```

- `start_time` on the first service defaults to "now" if omitted. Subsequent services default to the previous row's `endTime` (back-to-back packing).
- `price_sgd` defaults to the service's list price; an explicit value overrides it.
- `use_package` sets the row's effective price to 0 and consumes a session.
- `sell_package` assigns a new package to the client in the same transaction (composes the existing `/merchant/packages/assign` logic inline).

**Response:** `{ group, bookings[], redemptions[], sold_package? }`.

### `GET /merchant/bookings/:id/edit-context`

One call returns everything the edit modal needs: the booking, its group (if any), sibling bookings in the same group, active client packages for that client, the merchant's services list, and the staff list.

### `PATCH /merchant/bookings/group/:groupId`

Full edit of a group. Atomically replaces the services list by diffing the submitted list against the current state: inserts new services, updates changed ones, deletes removed ones. Recomputes `total_price_sgd`. Writes `booking_edits` rows for every field-level change. Invalidates availability cache. Adjusts package redemptions (credit returned sessions; debit newly-redeemed ones).

Request body mirrors `POST /merchant/bookings/group`. Each service row optionally carries a `booking_id` field (the existing `bookings.id`): present = update this booking, absent = insert a new booking. Existing booking ids returned by `edit-context` that are NOT in the submitted list are deleted.

### `PATCH /merchant/bookings/:id`

Edit a single non-grouped booking (historical bookings from before this feature; online bookings created via the public widget with `group_id = NULL`). Same diff and audit behavior as the group edit, narrower surface.

**Which endpoint to call:** the frontend chooses based on the booking's `group_id` — set → use the group endpoint; null → use the single-booking endpoint. `GET /merchant/bookings/:id/edit-context` returns enough data to make this choice without extra round-trips.

### `GET /merchant/bookings/:id/edits`

Returns the audit trail for a booking (and its group, if any). Used by the in-modal "history" list.

## API Behavior Rules

- **Editing `completed` is allowed.** No status check blocks it.
- **Editing `cancelled` is disallowed.** Returns 409 with a clear message.
- **Service change recomputes price.** On service change, the new row price defaults to the new service's list price. Any `price_sgd` explicitly supplied in the request body overrides this.
- **Staff/time change checks availability.** Conflicts return 409 with `{ conflictingBookingId, staffId, startTime, endTime }`.
- **Commission is locked on completion.** Edits to a completed booking do NOT recompute `commission_sgd` or `commission_rate`. This is a deliberate data-integrity choice; if it needs to change, the booking is re-opened via a separate future flow.
- **Package redemption undo.** If an edit removes a service that consumed a session, the session is re-credited and the redemption row is deleted.
- **Completion jobs do not re-fire.** Review-request and post-service-sequence jobs are triggered once at completion, not on subsequent edits.
- **All edit operations run in a DB transaction.** Partial edits are never persisted.

The existing `PATCH /merchant/bookings/:id/reschedule` endpoint stays — it remains the public client-facing reschedule path. The new `PATCH /merchant/bookings/:id` is the merchant-side general edit.

## Frontend

### `BookingForm` modal

New component at `glowos/apps/web/app/dashboard/bookings/BookingForm.tsx`. Handles both create and edit modes. Replaces the inline `WalkInModal` in `app/dashboard/page.tsx`.

**Props:**

```ts
{
  mode: 'create' | 'edit',
  bookingId?: string,
  groupId?: string,
  onClose: () => void,
  onSave: () => void,
}
```

In edit mode, fetches `GET /merchant/bookings/:id/edit-context` on mount. In create mode, fetches `/merchant/services`, `/merchant/staff`, and `/merchant/clients/lookup?phone=...` (on phone blur).

### Layout (top to bottom)

1. **Client row** — name + phone. On phone blur, a chip appears below if a matching client is found: `"Jane Doe · 3 active packages"`. Clicking the chip autofills the name.
2. **"Sell a package" disclosure** (collapsed by default) — expands to reveal a package template dropdown and "Add to this visit" button.
3. **Services list** — repeatable rows. Each row:
   - Service dropdown
   - Staff dropdown
   - Start time (defaults to previous row's `endTime`; first row defaults to now)
   - "Use package" chip — visible only when the matched client has an active package covering this service; tapping it zeroes the row price and flags it for session consumption
   - Price input (defaults to service list price; recomputes on service change unless user has touched it)
   - Remove (×) button, disabled when only one row remains
   - "+ Add service" button at the bottom
4. **Payment method** — one dropdown for the whole group.
5. **Total** — live-computed sum of row prices, displayed above the footer.
6. **Notes** — single textarea for the group.
7. **Footer** — Cancel / Save. Button label is "Create Booking" in create mode, "Save changes" in edit mode.

### Edit-mode additions

- Small timestamp under the title showing the last edit: `"Last edited by Sarah on 20 Apr 2026, 9:14 pm"` (pulled from the most recent `booking_edits` row; hidden if none).
- "View history" link that expands an inline list of edits (from `GET /merchant/bookings/:id/edits`).
- Amber notice at the top when the booking status is `completed`: *"This booking is completed. Edits will not re-send review requests or recalculate commissions."*

### Triggers

- **Dashboard booking card** — a small pencil "Edit" button next to Check-In / No-Show, visible on all statuses except `cancelled`. Opens `BookingForm` in edit mode.
- **"Add Walk-in" button** — opens `BookingForm` in create mode. Placement unchanged.
- **Calendar page** — double-click on a booking slot opens the same form in edit mode.

### Validation & UX

- Inline per-row errors (service required, staff required, start time required, price ≥ 0).
- Staff double-booking surfaces as a highlight on the offending row with a message like *"Sarah is already booked 5:30–6:00."*
- Network errors show a banner at the top of the modal; form state is preserved.
- No optimistic UI. Edits round-trip to the server before the dashboard re-renders — bookings are financial data.

## Error Handling

| Scenario | Response |
|---|---|
| Missing/invalid field on create or edit | 400 with `{ errors: { field: message } }` |
| Staff double-booking | 409 with `{ conflictingBookingId, staffId, startTime, endTime }` |
| Editing a cancelled booking | 409 with `"Cannot edit a cancelled booking"` |
| Package redemption: session already consumed by another booking | 409 with `"Package session is no longer available"` |
| Phone reformat failure | 400 with `"Invalid phone number"` |
| Any DB error mid-edit | Transaction rolls back; 500 with generic message |

## Testing

### API integration tests (primary, matching `services/api/src/routes/*.test.ts` pattern)

- Create group with 1 service → verify group + 1 booking.
- Create group with 3 services → verify back-to-back start times when not supplied.
- Create group with `sell_package` → verify `client_package` row created.
- Create group with `use_package` → verify session deducted, row price = 0, redemption row created.
- Edit group: add service, remove service, change service (price recomputes), change staff, change price (override sticks).
- Edit completed booking → succeeds, audit rows written, no review-request job queued.
- Edit cancelled booking → 409.
- Edit with staff conflict → 409 with conflict payload.
- Remove service that consumed a package session → session re-credited, redemption row deleted.
- All edits write one `booking_edits` row per changed field with correct `old_value` / `new_value`.

### Frontend test (Playwright)

One end-to-end flow:
- Create walk-in with 2 services + 1 package redemption.
- Verify dashboard + calendar show both services.
- Edit the group: change one service, remove another.
- Verify dashboard reflects the change and the audit trail endpoint returns the expected rows.

## Rollout

All changes are additive and ship in a single merged PR, ordered so that each commit is independently deployable and reversible:

1. **Commit 1 — migration.** Adds three tables (`booking_groups`, `booking_package_redemptions`, `booking_edits`) and the nullable `bookings.group_id` column. Zero behavior change on its own.
2. **Commit 2 — API endpoints.** New endpoints live but unused by any client.
3. **Commit 3 — frontend.** Dashboard page switches to `BookingForm`; old `WalkInModal` code is removed. This is the commit that changes user-visible behavior.

Merging the PR deploys all three in sequence. No feature flag — the existing walk-in flow is a strict subset of the new group flow (single service, no package → identical observable behavior). A bad frontend commit rolls back cleanly since the API and schema changes are backward-compatible.

A brief CLAUDE.md note under `glowos/apps/web/app/dashboard/` will point at `BookingForm` as the single source of truth for booking create and edit UI.

## Open Questions

None. All design questions were answered in the brainstorming session.
