# Embed Booking Widget — Design Spec

**Date:** 19 April 2026
**Status:** Drafted, pending user review
**Scope:** A dedicated `/embed/[slug]` route that renders the existing booking widget in a minimal, iframe-friendly layout; admin Settings UI that gives merchants a copy-paste iframe snippet to drop into their own websites; booking-source tagging so the resulting bookings are distinguishable in analytics.

---

## Motivation

Today, customers can only book via the public URL `https://glowos-nine.vercel.app/{slug}`. The widget is well-built but has no distribution — merchants have no practical way to integrate it into their own marketing pages (Wix, Squarespace, WordPress, Shopify). Every booking the merchant drives depends on sending customers to a GlowOS-branded URL, which is friction and an awkward ask.

Letting merchants embed the booking widget in a single `<iframe>` tag on their existing website:

- Lowers merchant friction to go live ("paste this into your booking page")
- Grows bookings by putting the widget where customers already are
- Creates a mutual-incentive referral loop via a small "Powered by GlowOS" footer link
- Does not interfere with the existing `/{slug}` direct-link flow

---

## Format Decision — Inline iframe (v1)

The widget is delivered as a single `<iframe>` tag the merchant pastes into any HTML block. No companion script, no popup/modal. Fixed height, merchant adjusts via the `height` attribute.

Rejected for v1:

- **Popup/modal (button-trigger) embed.** Higher conversion, but requires shipping and hosting a separate `embed.js`, managing cross-origin iframe messaging, and handling modal layering. Deferred as a potential v2.
- **Auto-resize via `postMessage`.** Would eliminate internal scrollbars inside the iframe, but requires merchants to paste a second script tag. Many site-builder HTML blocks reject or sanitize multiple tags. Deferred as a v1.1 upgrade for merchants who need it.

v1 snippet format:

```html
<iframe
  src="https://glowos-nine.vercel.app/embed/{slug}"
  width="100%"
  height="900"
  style="border:0; max-width: 720px;"
></iframe>
```

Merchant pastes exactly that, with `{slug}` pre-filled at render time by the admin UI.

---

## New Route: `/embed/[slug]`

A minimal Next.js page at `glowos/apps/web/app/embed/[slug]/page.tsx`.

**Structure:**

```tsx
<div className="min-h-screen bg-transparent p-0">
  <BookingWidget merchantSlug={slug} embedded />
  <footer className="py-3 text-center">
    <a
      href="https://glowos.co"
      target="_blank"
      rel="noopener"
      className="text-[11px] text-gray-400 hover:text-gray-600"
    >
      Powered by GlowOS →
    </a>
  </footer>
</div>
```

Key properties:

- **Transparent background** so the merchant's page color shows through the iframe.
- **No outer page padding**; the widget fills the iframe tightly.
- **No merchant header** (no logo, address, or description) — the merchant's own website already provides this above the embed.
- **"Powered by GlowOS →" footer link** — small gray text at the bottom, opens a new tab. Cheap brand exposure; can be toggled off for an enterprise tier later.
- **`target="_blank"` on the footer link** ensures clicking it does not disrupt the customer's booking flow inside the iframe.

### BookingWidget prop change

`BookingWidget` gets one optional prop: `embedded?: boolean`. Default `false`.

When `embedded` is `true`:

- Internal padding/margins are tightened (no desktop-max-width clamp, no sticky-nav assumptions).
- `booking_source` sent in the payment/confirm POST bodies is overridden from the default `"direct_widget"` to `"embedded_widget"`.

All other widget behavior — service selection, OTP verification, discount logic, calendar, confirmation — is shared verbatim with `/{slug}`.

### Missing-slug handling

If the slug does not resolve to a merchant, `/embed/[slug]` renders a small centered block:

```
Booking is temporarily unavailable.
```

rather than the full 404 page. This keeps the merchant's surrounding page intact if, for example, a slug was mistyped in their embed snippet. A normal customer just sees a discreet message where the widget would have been.

---

## Admin Snippet UI

**Location:** a new "Embed on your website" section appended to the bottom of the existing Settings → **Booking page** tab. This tab already hosts the public URL and QR code, so the embed snippet is a natural fit. No new top-level tab.

**Content:**

- Section heading: "Embed on your website"
- One-line description: *"Paste this into your website's custom HTML block to show the booking widget inline."*
- A read-only `<pre>` or `<textarea>` showing the iframe snippet with the merchant's slug pre-filled (the admin renders the slug server-side; no client-side string interpolation).
- A **"Copy"** button that calls `navigator.clipboard.writeText(...)` and shows a 2-second "Copied!" confirmation.
- A **"Preview in new tab →"** button that opens `/embed/{slug}` so the merchant sees exactly what customers will see inside the iframe.
- A short tip: *"Works with Wix, Squarespace, WordPress, Shopify, and most site builders. Adjust the height if your customers need more room."*

**Explicitly out of scope for v1:** theme picker, primary-color picker, font picker, width picker, show/hide merchant name toggle. Ship a single plain iframe and iterate once merchants ask.

---

## Booking-Source Tracking

Every booking records a `booking_source` for analytics. Today the enum has:

```
direct_widget, google_reserve, google_gbp_link, instagram, qr_walkin, walkin_manual
```

Add a new value: **`embedded_widget`**.

Plumbing:

1. **Zod schemas** — update the enum literal array in `createPaymentIntentSchema` (in `payments.ts`) and, if present, the corresponding schema on `/booking/:slug/confirm` (in `bookings.ts`).
2. **Frontend** — in `BookingWidget`, when `embedded` is true, send `booking_source: "embedded_widget"` in both the payment-intent POST and the `/confirm` POST bodies.
3. **DB schema** — if `bookings.booking_source` is a varchar (not a Postgres ENUM), no migration is required. If it is an ENUM, add the new value via a migration.

The existing merchant analytics endpoint that buckets by `booking_source` automatically picks up the new value once bookings start flowing with it.

---

## X-Frame-Options / CSP Middleware

Next.js applies default security headers that can block iframe embedding from third-party origins. Explicitly allow framing on `/embed/*` only — admin and direct-booking routes retain default protection.

New file: `glowos/apps/web/middleware.ts` (or additions if one already exists):

```ts
import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/embed/")) {
    const res = NextResponse.next();
    res.headers.delete("X-Frame-Options");
    res.headers.set("Content-Security-Policy", "frame-ancestors *");
    return res;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/embed/:path*"],
};
```

Any existing middleware must be merged, not replaced. If the codebase already has middleware, add the embed branch alongside the existing logic.

---

## SEO / Indexing

`/embed/*` is a technical surface, not a page customers should land on via search. Prevent it from competing with `/{slug}` in search results.

- Add a `robots.txt` rule: `Disallow: /embed/`
- Add `<meta name="robots" content="noindex, nofollow">` to the `/embed/[slug]` page via Next.js metadata export

---

## Testing Strategy

Manual checklist (the codebase has no automated test framework):

- [ ] `/embed/abc` renders the widget without the merchant header; transparent background; "Powered by GlowOS →" footer visible.
- [ ] Complete a full booking from `/embed/abc` — new booking row in DB has `booking_source = 'embedded_widget'`.
- [ ] `/embed/not-a-real-slug` shows "Booking is temporarily unavailable." (not the 404 page).
- [ ] Paste the iframe snippet into a throwaway HTML file or codepen.io — widget loads inside the iframe; booking completes successfully; no console errors about X-Frame-Options or CSP.
- [ ] Existing `/{slug}` bookings still tag `booking_source = 'direct_widget'` (no regression).
- [ ] Admin Settings → Booking Page → "Embed on your website": snippet shows, slug is pre-filled, "Copy" button works, "Preview in new tab" opens `/embed/{slug}` correctly.
- [ ] Clicking "Powered by GlowOS →" opens `https://glowos.co` in a new tab without disrupting the booking flow.

---

## Rollout

1. **Deploy backend first.** Adds `embedded_widget` to the Zod enums. Fully backwards compatible — the existing direct widget continues to send `direct_widget` and is accepted; the new value is also accepted for future requests.
2. **Deploy frontend.** New `/embed/[slug]` route, middleware, admin snippet UI, `embedded` prop on `BookingWidget`.
3. **Smoke-test in production** using the manual checklist above.
4. **Update `progress.md`.** Append to Session 12 (or extend the Session 11 post-polish section if done same day).

No feature flag needed. A broken `/embed/*` route does not impact the primary `/{slug}` flow, and the admin UI change is purely additive.

---

## Out of Scope (deliberate, v2 candidates)

- **Popup/modal embed variant** (`embed.js` hosted script that opens the widget in an overlay). Higher conversion but requires a separate script surface and cross-origin messaging.
- **Auto-resize via `postMessage`.** Would eliminate internal iframe scrollbars. Ships when a merchant asks.
- **Custom styling from the merchant** (theme, primary color, width, typography). Would require a config API and URL parameters.
- **Domain whitelist / allowlist.** Most embed products are open; we match that default.
- **White-label mode** (remove "Powered by GlowOS →"). Paid-tier candidate.
- **Analytics dashboard section** that surfaces embed-specific metrics (conversion rate, top referring domains, etc.). Ships once there are enough embed bookings to analyze.

---

## Files Touched

**New:**

- `glowos/apps/web/app/embed/[slug]/page.tsx` — minimal embed page
- `glowos/apps/web/middleware.ts` — X-Frame-Options + CSP overrides for `/embed/*` (only if middleware does not already exist)

**Modified:**

- `glowos/apps/web/app/[slug]/BookingWidget.tsx` — add `embedded?: boolean` prop; use it to tighten layout and override `booking_source`
- `glowos/services/api/src/routes/payments.ts` — add `"embedded_widget"` to `createPaymentIntentSchema` enum
- `glowos/services/api/src/routes/bookings.ts` — add `"embedded_widget"` to the confirm-schema enum if it validates source
- `glowos/apps/web/app/dashboard/settings/page.tsx` (or the Booking Page tab component wherever it currently lives) — add "Embed on your website" section with snippet, Copy button, Preview button
- `glowos/apps/web/public/robots.txt` — disallow `/embed/`

No database migration required unless `bookings.booking_source` is a Postgres ENUM (almost certainly a varchar given the existing additive pattern, but verify during implementation).
