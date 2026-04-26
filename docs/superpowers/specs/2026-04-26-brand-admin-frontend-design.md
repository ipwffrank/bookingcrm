# Brand-admin Frontend — Design Spec

**Date:** 2026-04-26
**Phase:** Multi-branch Phase 1 — frontend slot
**Depends on:** `feat(brand): unified brand-admin auth foundation` (04aa38a) and `feat(brand): /group/* accepts brand-admin merchant_users tokens` (aea8471)

---

## Goal

Let a merchant_user with `brand_admin_group_id` set reach the existing `/dashboard/group/*` views from their normal merchant login — no separate group_users account, no second password, no second portal — AND give them the ability to spin up new branches in their group and edit existing branch profiles, so the group composition is self-serve.

## Scope

In:
- One additive field on the `POST /auth/login` response so the frontend can show the group name without a second API call.
- A "Group" item in the merchant dashboard sidebar, visible only when the logged-in merchant_user has `brandAdminGroupId`.
- A "← Back to [Branch Name]" item at the top of the group sidebar.
- The group layout sources its group name from `localStorage` (set at login), not from the legacy group_users-only login flow.
- Palette migration of `app/dashboard/group/{layout,overview,branches,clients}.tsx` from indigo → the 3-tone palette mandated by `app/dashboard/CLAUDE.md`.
- **Branch CRUD by brand admin:** create a new branch (inserts `merchants` row pre-tied to the brand admin's `groupId`); edit branch profile fields on existing branches.

Out:
- Logout button behavior. The existing handler clears localStorage + redirects to `/login`. That's the same shape as `/dashboard` logout — leave it.
- Group-users login path (the legacy fallback in `requireGroupAccess`). Untouched. Still works for HQ-only accounts.
- New `/group/*` analytics features. Pure access + visual parity for the analytics views; the new write surface is branch CRUD only.
- Inviting a branch owner email at create-time. The new branch has no merchant_users row — only platform-level tooling (super-admin) provisions owners. Brand admin requests an owner-invite via the existing channels.
- Scaffolding inside a new branch (operating hours, services, staff, payment gateway). Empty branch shell only; the branch's own merchant_users owner sets these up via their normal `/dashboard/*` once invited.
- Slug edits after creation. Changing a slug invalidates outbound booking links and is reserved for super-admin.

---

## API change

**`POST /auth/login`** — when the matching `merchant_users` row has a non-null `brand_admin_group_id`, include a top-level `group` object in the response:

```jsonc
{
  "userType": "merchant",
  "user": { /* ... */, "brandAdminGroupId": "uuid-..." },
  "merchant": { /* ... */ },
  "group": { "id": "uuid-...", "name": "Aura Wellness Group" },  // ← new, conditional
  "access_token": "...",
  "refresh_token": "..."
}
```

Implementation:
- In `routes/auth.ts`, the merchant-user branch already computes `brandAdminGroupId`. When it's truthy, JOIN/select the matching `groups` row by id and add `group: { id, name }` to the response payload.
- The legacy group-users branch already returns `group` — same shape — so the frontend handler that already writes `localStorage.group` for `userType: "group_admin"` works unchanged.
- Refresh-token response: not extended. The group id never changes during a session; the frontend keeps the cached value across refreshes.

Failure modes:
- `brand_admin_group_id` points to a missing/deleted group row → omit `group` from the response and log a warning. The login still succeeds; the frontend will not render the Group sidebar item. (Defense-in-depth: the API path also checks DB on every request.)

## API additions — branch CRUD

**`POST /group/branches`** — create a new branch inside the caller's group.

```jsonc
// Request body (zod-validated)
{
  "name": "Aura Wellness — Damansara",        // required, 1..255
  "slug": "aura-damansara",                    // required, lowercase + dashes, 3..100, unique across all merchants
  "country": "MY",                             // required, "SG" | "MY"
  "category": "spa",                           // optional, enum (see merchants schema)
  "addressLine1": "Lot 3.10, ...",             // optional
  "addressLine2": null,
  "postalCode": "50490",
  "phone": "+60123456789",
  "email": "damansara@aurawellness.com",
  "description": "..."                         // optional, free text
}
// Response 201
{ "merchant": { /* full row */ } }
// Errors
// 400 invalid body / slug format / unsupported country
// 409 slug already taken
```

Server behavior:
- `groupId` is set from `c.get("groupId")` (the brand admin's group from JWT) — never from request body.
- `timezone` defaults from `country`: `SG` → `Asia/Singapore`, `MY` → `Asia/Kuala_Lumpur`.
- `paymentGateway` defaults: `SG` → `stripe`, `MY` → `ipay88`.
- `subscriptionTier` defaults to `starter`, `subscriptionStatus` to `trial`. Brand admin doesn't set platform/billing fields.
- The legacy group_users path (also accepted by `requireGroupAccess`) gets the same write surface — no extra branch on the route.

**`PATCH /group/branches/:merchantId`** — partial update of editable profile fields on an existing branch in the caller's group.

```jsonc
// Request body — any subset of:
{ "name", "category", "addressLine1", "addressLine2", "postalCode",
  "phone", "email", "description", "logoUrl", "coverPhotoUrl" }
// Response 200
{ "merchant": { /* full row */ } }
// Errors
// 400 invalid field value
// 404 merchantId not in caller's group
```

Editable allow-list above is intentional. Off-limits via this endpoint (each guarded by zod):
- `slug` — would invalidate outbound booking links
- `country`, `timezone` — locale concerns; bake during create
- `subscriptionTier`, `subscriptionStatus`, `subscriptionExpiresAt` — billing
- `paymentGateway`, `stripeAccountId`, `hitpayMerchantId`, `ipay88*` — payment provisioning
- `gbpPlaceId`, `gbpBookingLinkConnectedAt`, `googleActionsStatus` — owned by the branch owner via their merchant `/dashboard/settings`
- `operatingHours`, `cancellationPolicy` — owned by the branch owner
- `groupId` — set at create, never editable
- `payoutFrequency` — platform concern

The existing `GET /group/branches/:merchantId` route currently returns a 3-field `merchant` block (`id`, `name`, `location`). **Extend it** to return the full editable profile so the edit modal can pre-fill without a second call:

```jsonc
{
  "merchant": {
    "id", "slug", "name", "country", "timezone",
    "category", "addressLine1", "addressLine2", "postalCode",
    "phone", "email", "description", "logoUrl", "coverPhotoUrl"
  },
  "revenue": ..., "bookingCount": ..., "activeClients": ..., "recentBookings": [...]
}
```

The aggregate fields and `recentBookings` are unchanged. The change is additive on the `merchant` block only — existing consumers reading `id`/`name`/`location` keep working (the new field is `addressLine1` instead of `location`; existing UI either keeps `location` for back-compat or migrates in this same change).

### Zod schemas

Both `POST` and `PATCH` schemas use `.strict()` so unknown keys are rejected at the boundary, not silently dropped. The PATCH schema is `.partial()` over the editable allow-list. Anything outside the allow-list is a 400 — including off-limits fields like `slug`, `subscriptionTier`, etc. — to give an explicit failure rather than a silent no-op.

---

## Frontend changes

### 1. Login (`app/login/page.tsx`)

The merchant branch of the response handler already writes `access_token`, `refresh_token`, `user`, `merchant` to localStorage. Add one line: when the response contains `data.group`, also write `localStorage.setItem('group', JSON.stringify(data.group))`. Otherwise, `localStorage.removeItem('group')` to avoid stale data leaking across logins.

The legacy `userType === "group_admin"` branch is untouched.

### 2. Merchant dashboard sidebar (`app/dashboard/layout.tsx`)

Add one nav item, rendered only when `JSON.parse(localStorage.user).brandAdminGroupId` is truthy:

```tsx
{ href: '/dashboard/group/overview', label: 'Group', icon: BuildingIcon }
```

Position: below "Campaigns", above the divider/logout area. The icon (`BuildingIcon`) already exists in the group layout and can be inlined or shared via the icons module — same pattern as the rest of the file.

The check happens once on mount, alongside the existing `setMerchant` block. No new context, no new fetch.

### 3. Group layout (`app/dashboard/group/layout.tsx`)

Three changes, all small:

a) **Back-to-branch item.** Above the existing 3-item nav, render:

```tsx
<Link
  href="/dashboard"
  className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-grey-60 hover:text-tone-ink"
>
  <ArrowLeftIcon className="w-4 h-4" />
  Back to {merchantName}
</Link>
```

The merchant name is read from `localStorage.merchant` on mount. If localStorage has no merchant (legacy group_users session), fall back to the literal "Back to dashboard". Render the back link regardless of which session type is active — both can use it.

b) **Group name fallback chain.** The existing `localStorage.getItem('group')` read keeps working — the new login path now writes the same key for brand admins. No code change here, but the comment/wording in the file should stop implying group_users is the only source.

c) **Palette migration.** Replace every `indigo-*` class with the 3-tone equivalents per `docs/superpowers/specs/2026-04-22-palette-hierarchy-redesign.md`:

| Old | New |
|---|---|
| `text-indigo-600` (logo, active state) | `text-tone-ink` (logo) / `text-tone-sage` (active link) |
| `bg-indigo-50` (active link bg) | `bg-tone-sage/10` |
| `text-indigo-700` (active link text) | `text-tone-sage` |
| `bg-gray-50` (canvas) | `bg-tone-surface-warm` (matches the rest of the dashboard) |
| `text-gray-*`, `bg-gray-*`, `border-gray-*` | `text-grey-*`, `bg-grey-*`, `border-grey-*` (opacity ramp tokens) |

The non-indigo neutrals (`gray-50`, `gray-200`, etc.) get migrated to the project's `grey-*` token ramp at the same time. The CLAUDE.md rule is permissive about `gray-*` from a strict reading, but the rest of the redesigned dashboard uses `grey-*`, so this keeps everything consistent.

### 4. Group pages

`overview` and `clients` pages — same indigo→3-tone substitution rules. No structural changes. Stat cards stay the same shape; just the colors move.

The "Hero metric" pattern from the analytics page (ink-filled card for the headline number, sage tint for the secondary, neutrals for the rest) is the right reference if a card hierarchy choice comes up. Default: revenue card = ink-filled, branch count = sage tint, the rest = `tone-surface` over warm canvas.

### 5. Branches page (`app/dashboard/group/branches/page.tsx`)

Same palette migration as overview/clients, plus two new affordances:

a) **`+ New branch` primary button** in the page header. Click opens a modal with the create form (fields per `POST /group/branches` body). Submit → success toast → modal closes → refetch the list. Validation errors render inline.

b) **Per-row `Edit` button** (or `⋯` menu) on each branch in the list. Click opens a modal with the same form pre-filled from `GET /group/branches/:merchantId` (the existing endpoint already returns the merchant block). Submit → `PATCH /group/branches/:merchantId` → success toast → modal closes → refetch.

Both modals share a single `<BranchForm>` component with a `mode: "create" | "edit"` prop. Required fields disabled in edit mode (slug, country) per the API allow-list. Country select drives the timezone hint shown to the user ("This branch will operate on Asia/Kuala_Lumpur time") rather than letting them pick timezone directly.

A real `/dashboard/group/branches/[merchantId]` deep-detail page is still out of scope — the modal pattern keeps the entire workflow on one route.

---

## Data flow

```
Login form
  └─> POST /auth/login
       └─> response { user.brandAdminGroupId?, group? }
            └─> localStorage: access_token, user, merchant, group?

Dashboard layout (merchant)
  └─> reads user.brandAdminGroupId from localStorage
       └─> conditionally renders "Group" sidebar item

Click "Group"
  └─> /dashboard/group/overview
       └─> Group layout
            ├─> reads localStorage.group → renders group.name in sidebar header
            ├─> reads localStorage.merchant → renders "Back to {name}" link
            └─> Pages call GET /group/* with Bearer access_token
                 └─> requireGroupAccess: validates brand-admin claim, sets c.groupId
```

---

## Auth/security notes

- The frontend never trusts `brandAdminGroupId` as authority; it's only used for menu visibility. The API enforces every request via `requireGroupAccess`.
- Stale localStorage on a brand-admin revocation: when an admin removes the `brand_admin_group_id`, the API returns 403 on the next `/group/*` call. The frontend should treat the same 401/403 path it already has — redirect to `/login` and clear localStorage. The "Group" sidebar item will disappear after re-login.
- The shipped commit aea8471 already blocks impersonating sessions from `/group/*`; nothing to do on the frontend.

---

## Testing

- Manual: log in as a merchant_user with `brand_admin_group_id` set → confirm the "Group" sidebar item appears, clicks through to `/dashboard/group/overview`, the group name renders, the back link returns to `/dashboard`.
- Manual: log in as a merchant_user without `brand_admin_group_id` → confirm no "Group" sidebar item appears, direct nav to `/dashboard/group/overview` either renders nothing useful or the API returns 403 (the existing 401/403 redirect kicks in).
- Manual: log in as a legacy group_users account → confirm the existing flow (group name in sidebar header, no merchant data, "Back to dashboard" fallback wording) still works.
- Manual: as brand admin, click "+ New branch", submit a valid form → branch appears in the list, public `/booking/<slug>` resolves (empty services so the booking page should render an "no services" state but the merchant row exists).
- Manual: as brand admin, edit an existing branch → name change reflects on the merchant dashboard's branch name (cross-check `/super` Merchants table).
- Manual: attempt `PATCH /group/branches/:id` with `slug` or `subscriptionTier` in the body → 400 (zod strips). Attempt `POST /group/branches` with a slug already in use → 409.
- Manual: attempt `POST /group/branches` from a brand admin in group A targeting a body that mentions group B (no field exists for it, but verify the JWT-derived groupId is the only source) → branch created in A.
- Visual: spot-check the migrated pages against the palette spec — no `indigo-*` or other forbidden hues remain in `app/dashboard/group/**`.
- Typecheck: `pnpm --filter @glowos/web typecheck` and `pnpm --filter @glowos/api typecheck` clean.

---

## Out of scope (deferred)

- A real `/dashboard/group/branches/[merchantId]` deep-detail frontend page (read-only API endpoint exists; UI uses modals from the list page).
- Multi-group brand admins (current schema and JWT model supports a single `brand_admin_group_id` per user).
- Brand-admin RBAC inside `/group/*` (currently any matching merchant_user is full-power within their group; sub-roles can land later if needed).
- Replacing the legacy group_users login path entirely — kept for back-compat.
- Inviting / provisioning a branch owner email at create-time — handled by super-admin or future invite flow.
- Branch-internal scaffolding (operating hours, services, staff, payment config) — stays in the branch owner's `/dashboard/*` flows.
- Slug rename and country/timezone migration after create — super-admin only.
