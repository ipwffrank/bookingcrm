# GlowOS HR & Staff Calendar — Design Spec

**Date:** 2026-04-16
**Status:** Approved

---

## Goal

Build a staff HR module that differentiates GlowOS from competitors: staff logins, duty block scheduling with drag-and-drop, a unified bookings calendar, and a staff-facing dashboard. Admins manage the full roster; staff self-serve their own schedule.

## Architecture

Extends the existing auth and staff systems with minimal new infrastructure:
- One new DB table (`staff_duties`)
- One new column on `merchant_users` (`staff_id`)
- New `staff` JWT role (same auth flow, new scope)
- Two new admin pages, one new staff dashboard
- FullCalendar React for all calendar/drag-and-drop UI

---

## Data Model

### New table: `staff_duties`

```sql
staff_duties (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  date        date NOT NULL,
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  duty_type   text NOT NULL CHECK (duty_type IN ('floor', 'treatment', 'break', 'other')),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
)
```

### Modified table: `merchant_users`

Add one nullable column:
```sql
staff_id uuid REFERENCES staff(id) ON DELETE SET NULL
```

When `staff_id` is set and `role = 'staff'`, the account is a staff login. When null, the account is an admin/manager.

---

## Authentication & Roles

### Roles
- `owner` / `manager` — full admin access, unchanged
- `staff` — new role, scoped to own duty blocks + read-only on rest

### Staff login creation
- Admin goes to `/dashboard/staff` → clicks "Create Login" on any staff card
- Enters email + temporary password
- Creates a `merchant_users` row with `role: 'staff'`, `staff_id` pointing to the staff record
- Staff logs in at the same `/login` page

### JWT claims (staff token)
```json
{
  "userId": "merchant_user_id",
  "merchantId": "...",
  "role": "staff",
  "staffId": "..."
}
```

### Routing after login
- `owner` / `manager` → `/dashboard`
- `staff` → `/staff/dashboard`

### API middleware
- New `requireStaffOrAdmin` middleware: accepts tokens where role is `owner`, `manager`, or `staff`
- New `requireAdmin` guard: rejects `staff` role tokens on sensitive endpoints (clients PII bulk export, campaign send, settings)
- Existing `requireMerchant` middleware unchanged — staff tokens also pass (same `merchantId` claim)

---

## Admin Views

### 1. Staff Roster — `/dashboard/roster`

**Purpose:** Admin sees all staff duty blocks for the week in a single grid.

**Layout:**
- Week/day toggle (default: week)
- Rows = staff members, columns = time slots (15-min increments)
- Duty blocks rendered as draggable FullCalendar events, colour-coded:
  - Floor duty → blue (`#4f46e5`)
  - Treatment → purple (`#7c3aed`)
  - Break → grey (`#9ca3af`)
  - Other → amber (`#d97706`)
- Bookings overlaid as non-draggable read-only chips in indigo
- Admin can:
  - Drag a block to move it (updates `start_time`, `end_time`, `date`)
  - Resize a block to change duration
  - Click a block to open edit modal (change type, notes, delete)
  - Click empty space to create a new block

**API endpoints used:**
- `GET /merchant/duties?from=&to=` — all duty blocks for the merchant in date range
- `POST /merchant/duties` — create block
- `PATCH /merchant/duties/:id` — update block (move/resize/edit)
- `DELETE /merchant/duties/:id` — delete block

### 2. Unified Bookings Calendar — `/dashboard/calendar`

**Purpose:** Single read-only view of all bookings across all staff.

**Layout:**
- FullCalendar week/day view
- Each booking shown as an event: client name + service name
- Colour by staff member (auto-assigned from a palette)
- Filter bar: staff selector, service selector, status filter (confirmed/completed/no-show)
- Click a booking → side drawer with full booking details
- No actions from this view — check-in/complete done from `/dashboard`

**API endpoints used:**
- `GET /merchant/bookings?from=&to=` — existing endpoint, already returns all bookings

### 3. Staff Management — `/dashboard/staff` (extended)

Add to each staff card:
- **"Create Login" button** — if no `merchant_users` row linked to this staff
- **"Login: email@example.com" badge** — if login already exists
- **"Reset Password" button** — if login exists

Modal for Create Login:
- Email field
- Temporary password field (shown once, staff should change on first login)
- Submit → `POST /merchant/staff/:id/create-login`

---

## Staff Dashboard — `/staff/dashboard`

Separate layout from admin dashboard. Minimal sidebar: My Schedule, All Bookings, My Bookings. No access to Services, Clients, Analytics, Campaigns, Settings.

### My Schedule (default landing)

- FullCalendar week view showing own duty blocks
- Bookings assigned to this staff member overlaid (non-draggable)
- Can drag/resize own duty blocks → `PATCH /merchant/duties/:id` (API verifies staffId matches token)
- Can create new blocks by clicking empty space
- Cannot see or edit other staff's blocks

### All Bookings

- FullCalendar week view showing ALL bookings for the merchant (all staff)
- Colour by staff member
- Filter by date, staff, service
- Read-only — no actions

### My Bookings

- Simple list view (not calendar)
- Shows upcoming bookings assigned to this staff member
- Columns: date/time, client name, service, status
- Sorted by date ascending
- No actions

---

## Navigation Changes

### Admin sidebar
Add two new items:
- **Roster** (between Staff and Clients) → `/dashboard/roster`
- **Calendar** (after Roster) → `/dashboard/calendar`

### Staff sidebar
Separate layout component at `app/staff/layout.tsx`:
- My Schedule → `/staff/dashboard`
- All Bookings → `/staff/bookings`
- My Bookings → `/staff/my-bookings`
- Logout button

---

## API Endpoints

### New endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/merchant/duties` | admin or staff | Get duty blocks for date range (`?from=&to=&staffId=`) |
| `POST` | `/merchant/duties` | admin only | Create duty block |
| `PATCH` | `/merchant/duties/:id` | admin or own staff | Update duty block (staff can only update their own) |
| `DELETE` | `/merchant/duties/:id` | admin only | Delete duty block |
| `POST` | `/merchant/staff/:id/create-login` | admin only | Create staff login credentials |
| `POST` | `/merchant/staff/:id/reset-password` | admin only | Reset staff login password |
| `GET` | `/staff/me` | staff | Get own staff profile + merchant info |
| `GET` | `/staff/bookings` | staff | Get all merchant bookings (read-only) |
| `GET` | `/staff/my-bookings` | staff | Get bookings assigned to this staff member |

---

## Tech Stack

- **FullCalendar:** `@fullcalendar/react`, `@fullcalendar/daygrid`, `@fullcalendar/timegrid`, `@fullcalendar/interaction` (drag-and-drop)
- **DB migration:** Drizzle `drizzle-kit generate` → push to Neon
- **Auth:** Extend existing JWT lib — add `staffId` claim, add `requireStaffOrAdmin` middleware

---

## Out of Scope

- Staff payroll / commission tracking (Phase 3)
- Staff-to-staff messaging
- Leave request approval workflow
- Mobile app for staff (web responsive only)
- Staff performance metrics (already in existing analytics)
