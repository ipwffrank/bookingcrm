# Dashboard conventions

## Booking create & edit UI

`app/dashboard/bookings/BookingForm.tsx` is the single source of truth for
booking create and edit UI. Do not create new walk-in or edit modals — extend
this one. It handles:

- Multi-service walk-ins (parent: `booking_groups`; children: `bookings`)
- Package redemption via the existing `package_sessions` table
- Editing any booking status except `cancelled` (including `completed`)
- Per-field audit logging via `booking_edits`

Endpoints:
- `POST   /merchant/bookings/group` — create group walk-in
- `GET    /merchant/bookings/:id/edit-context` — load edit modal data
- `PATCH  /merchant/bookings/group/:groupId` — edit a grouped booking
- `PATCH  /merchant/bookings/:id` — edit a non-grouped booking
- `GET    /merchant/bookings/:id/edits` — audit trail
