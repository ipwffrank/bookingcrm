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

## Palette (Session 19)

Admin + staff dashboards use a restricted palette. See the full spec:
`docs/superpowers/specs/2026-04-22-palette-hierarchy-redesign.md`.

**Allowed:**
- `tone-ink`, `tone-surface`, `tone-surface-warm`, `tone-sage` — three tones
- `semantic-danger`, `semantic-warn` — reserved for genuinely critical state only
- `grey-5` … `grey-90` — identity/variety (avatars, chart series, categories)
- `.state-default` / `.state-active` / `.state-notified` / `.state-completed` /
  `.state-cancelled` / `.state-no-show` / `.state-urgent` — typographic state
  utilities (see `globals.css`). Apply to the text node directly, no wrapping pill.

**Forbidden for new dashboard code:**
`bg-{red|green|blue|indigo|purple|pink|amber|emerald|orange|violet|fuchsia|cyan|teal|sky|rose|lime|yellow}-*`
and the `text-*` equivalents. The landing page (`app/page.tsx`) and the
customer-facing booking widget (`app/[slug]/**`) are out of scope — do not
migrate those here.

**Identity instead of hue:** avatars use the first initial over a grey-ramp
background slot, not a colored background. VIP tiers render as `★` counts.
Risk tiers are text labels; only `High risk` gets the danger color.
