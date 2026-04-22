# Palette & Hierarchy Redesign — Design Spec

**Date:** 2026-04-22
**Target surfaces:** admin dashboard (`glowos/apps/web/app/dashboard/**`), staff dashboard (`glowos/apps/web/app/staff/**`), booking widget (`glowos/apps/web/app/[slug]/**`)
**Out of scope:** landing page (`app/page.tsx`) — that redesign is paused in [docs/design.md](../../../docs/design.md)
**Status:** Design — awaiting user approval

---

## Problem

Inventory of current color usage:

- **Admin dashboard:** ~227 `bg-*` occurrences across 20 files
- **Staff dashboard:** ~19 `bg-*` occurrences across 6 files
- **Hues in play:** indigo, red, green, emerald, amber, orange, blue, purple, pink, violet, fuchsia, cyan, teal, sky, yellow, rose — **16 distinct hues**

Three distinct concerns are currently all solved with hue:

1. **Semantic state** — success/warning/danger/info (emerald, amber, red, indigo)
2. **Identity/variety** — avatars, service categories, chart series, booking-source tags (7+ decorative colors)
3. **Interaction** — primary button, active tab, selected pill (indigo)

The result is visual cacophony: an analytics page shows eight accent hues; a service list uses seven category hues; a client detail page has VIP-tier colors (purple/yellow/amber) overlapping with risk-tier colors (green/yellow/red).

---

## Principle

Color carries meaning only when it is rare. Most of what currently uses color should be **typographic**: weight, italic, size, uppercase, tracking. Hue is reserved for what genuinely demands instant, pre-attentive recognition.

## Three approaches

### Approach A — Strict tri-tone (minimalist)

Three tones only: ink, surface, sage. No danger-red, no warn-amber. All state encoded typographically (bold for urgent, italic for in-progress, strikethrough for cancelled).

- **Pros:** Maximal visual calm. Landing-page-consistent.
- **Cons:** "No-show" and "Needs attention" lose their instant scan. In a dense table, typography alone is too subtle for truly urgent rows. Destructive-confirm buttons become ambiguous.

### Approach B — Tri-tone + semantic pair (RECOMMENDED)

Three **tones** (ink / surface / sage) handle background, text, and accent. Two **semantic signals** (danger-red, warn-amber) are allowed *only* for genuinely critical states. Variety (avatars, categories, chart series) is cast as a **grey ramp** — opacity variants of ink at 5 / 15 / 30 / 45 / 60 / 75 / 90%.

- **Pros:** Visual calm without losing scannability of the two states that matter. Grey ramp gives up to 7 identity slots while staying in-brand.
- **Cons:** Chart series lose hue-based distinction — relies on legend + grey ramp ordering.

### Approach C — Semantic tokens, no hue restriction

Define tokens (`text-primary`, `text-muted`, `text-accent`, `state-success`, `state-warning`, `state-danger`). Keep existing hue variety but funnel it through tokens. Future UI is automatically consistent.

- **Pros:** Lowest-risk migration — rename-only. Preserves existing affordances.
- **Cons:** Does not actually reduce visual chaos. Doesn't deliver on "reduce to 3 tones."

**Recommendation: Approach B.** Delivers the user's ask (visual calm, reduced hue count) without sacrificing urgent-state scannability.

---

## Palette — Approach B

| Role             | Token                 | HEX       | Usage                                                    |
|------------------|-----------------------|-----------|----------------------------------------------------------|
| Ink (primary)    | `--tone-ink`          | `#1a2313` | All primary text, headings, CTAs, active states          |
| Surface          | `--tone-surface`      | `#ffffff` | Card backgrounds, default page background                |
| Surface warm     | `--tone-surface-warm` | `#fcfaef` | Alternating sections, top-level page background          |
| Sage (accent)    | `--tone-sage`         | `#456466` | Selected pill, hover underlines, focus outlines, success. Matches landing `--color-secondary`. |
| Danger           | `--semantic-danger`   | `#b8403a` | No-show, destructive buttons, error messages             |
| Warn             | `--semantic-warn`     | `#c48a2f` | "Needs attention", waitlist notified, urgent review      |

**Grey ramp** (identity / variety — derived from ink via opacity):

| Token          | Opacity | Example use                                        |
|----------------|---------|----------------------------------------------------|
| `--grey-5`     | 5%      | Light card tint, hover surface                     |
| `--grey-15`    | 15%     | Chart series 1, avatar bg (initial A–B)            |
| `--grey-30`    | 30%     | Chart series 2, avatar bg (initial C–F)            |
| `--grey-45`    | 45%     | Chart series 3, muted labels                       |
| `--grey-60`    | 60%     | Body muted text                                    |
| `--grey-75`    | 75%     | Strong body text                                   |
| `--grey-90`    | 90%     | Headings (near-ink)                                |

Avatars and categories identify via **letter + grey-ramp slot**, not hue. Chart series identify via **legend + position in grey ramp**, not hue.

---

## Typography-for-state

State-specific utility classes replace colored status pills:

| State               | Class             | Typography                                              | Color        |
|---------------------|-------------------|---------------------------------------------------------|--------------|
| Default / confirmed | `state-default`   | weight 500, regular                                     | ink          |
| In progress         | `state-active`    | weight 600, regular                                     | ink          |
| Notified (waitlist) | `state-notified`  | weight 500, italic, `-0.01em` tracking                  | warn         |
| Completed           | `state-completed` | weight 400, regular                                     | grey-60      |
| Cancelled           | `state-cancelled` | weight 400, strikethrough                               | grey-45      |
| No-show             | `state-no-show`   | weight 600, uppercase, `0.08em` tracking, 11px          | danger       |
| Urgent / needs-attention | `state-urgent` | weight 600, italic, uppercase, `0.08em` tracking, 11px | warn         |

Pattern replaces e.g. `bg-red-50 text-red-700 border-red-200 rounded-full px-2 py-0.5 text-xs` pill → plain `span.state-urgent` with no background. Chrome disappears; meaning stays.

**VIP tiers & risk tiers** — these currently use color. Proposed replacement:

- VIP: `★` count (bronze 1, silver 2, gold 3, platinum 4) in ink. No color.
- Risk: text label only (`Low risk` / `Medium risk` / `High risk`) with size + weight. Only `High risk` gets danger color.

---

## Migration strategy

A global rewrite touching ~250 color occurrences is 2–3 sessions of mechanical work plus visual QA. Risky as a single PR. Proposed staging:

1. **Foundation PR (this spec's first implementation)**
   - Add CSS variables to `globals.css`
   - Add `@theme` tokens for `ink`, `sage`, `danger`, `warn`, `surface-warm`, `grey-{5..90}`
   - Add state utility classes (`.state-*`) to `globals.css`
   - Document the rule in [glowos/apps/web/app/dashboard/CLAUDE.md](../../../glowos/apps/web/app/dashboard/CLAUDE.md): no new `bg-{red|green|blue|indigo|purple|pink|amber|emerald|orange|violet|fuchsia|cyan|teal|sky|rose|lime|yellow}-*` classes — use `tone-*`, `semantic-*`, `grey-*`, or state utilities.
   - Adds tokens additively — the existing `--color-primary`, `--color-surface` etc. stay untouched. Produces no visual change until a component references the new tokens.

2. **Reference migration — dashboard home (`app/dashboard/page.tsx`)**
   - Migrate the single highest-traffic page end-to-end as a template.
   - Ship alongside screenshots (before/after) for visual confirmation.

3. **Progressive rollout — subsequent sessions**
   - Per-page migrations: analytics, services, clients, reviews, calendar, staff dashboard, staff client detail.
   - Each page is its own small PR so visual regressions are isolated.
   - Grep guard in CI (optional): fail build if a forbidden `bg-*` appears outside `app/page.tsx` or marketing pages.

4. **Booking widget last**
   - Customer-facing surface — held for final polish so merchants see the admin experience stabilize first.

---

## Non-goals

- Replacing the landing page's gilt/gold/sage/ink palette — that page has its own paused redesign brief.
- Changing fonts. Current two-font stack (Cormorant Garamond display, Manrope body) stays.
- Dark mode. Not scoped.
- Merchant-customizable branding (logo color override). Out of scope for this pass; merchants pick logo + accent within the sage/ink constraint.

---

## Open questions (resolved)

- **Sage exact hex.** Resolved 2026-04-22: switched from `#6b8e5a` (green) to `#456466` (landing page's `--color-secondary`, muted teal). This ensures dashboards inherit the landing brand.
- **Canvas color.** Resolved 2026-04-22: page canvas uses `--tone-surface-warm` (`#fcfaef`) to match the landing page hero panel. Cards remain white.
- **Danger + warn exact hexes.** Proposed values are muted (not primary red/amber). If they're too soft, we'll tune during the reference migration.
- **Chart series in analytics.** Do we keep booking-source color chips (google/direct/walkin/ig/fb/phone) in the analytics page, or migrate those to grey-ramp + icon? This is the single most color-dense page — worth a separate micro-decision during the analytics migration.

---

## Acceptance

This spec is considered implemented when:

1. `globals.css` contains the token block (6 tones + grey ramp + state utilities).
2. `app/dashboard/page.tsx` renders using only `tone-*`, `semantic-*`, `grey-*`, and state utilities.
3. The CLAUDE.md rule documenting the palette restriction is in place.
4. Visual regression check on the dashboard home page confirms legibility of:
   - Today's bookings list (status pills replaced with typographic state utilities)
   - Stats row (5 tiles — revenue / waitlist / staff contribution / no-shows / completions)
   - Empty states

Subsequent screen migrations are tracked as follow-up work, not part of this spec's acceptance.
