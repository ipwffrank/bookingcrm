# Embed Booking Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a dedicated `/embed/[slug]` route that renders the existing booking widget in a minimal, iframe-friendly layout, with an admin Settings snippet UI and `embedded_widget` booking-source tracking.

**Architecture:** Reuse the existing `BookingWidget` component verbatim. Add one optional `embedded?: boolean` prop that (a) tightens outer layout and (b) overrides the POST body's `booking_source` to `"embedded_widget"`. New Next.js route at `/embed/[slug]` mirrors the data-fetching pattern of `/[slug]` but strips the merchant header and page chrome. New middleware relaxes framing headers only for the embed route. Admin Settings gets a new "Embed on your website" section in the existing Booking Page tab.

**Tech Stack:** Next.js 15 App Router, Hono + Zod for API schemas, Drizzle ORM (no migration — `bookings.booking_source` is `varchar`). No new third-party dependencies.

**Spec:** [docs/superpowers/specs/2026-04-19-embed-booking-widget-design.md](../specs/2026-04-19-embed-booking-widget-design.md)

---

## File Map

### New files

- `glowos/apps/web/app/embed/[slug]/page.tsx` — minimal embed page (server component, fetches merchant data, renders `<BookingWidget embedded />` + footer)
- `glowos/apps/web/middleware.ts` — relaxes `X-Frame-Options` and sets `Content-Security-Policy: frame-ancestors *` on `/embed/*`
- `glowos/apps/web/public/robots.txt` — disallows crawling of `/embed/*`

### Modified files

- `glowos/apps/web/app/[slug]/BookingWidget.tsx` — add `embedded?: boolean` prop; use it to set `booking_source` in two POST bodies
- `glowos/services/api/src/routes/bookings.ts` — add `booking_source` field to `confirmSchema` with the new enum; use `body.booking_source ?? "direct_widget"` when inserting a booking
- `glowos/services/api/src/routes/payments.ts` — add `"embedded_widget"` to the existing `booking_source` enum in `createPaymentIntentSchema`
- `glowos/apps/web/app/dashboard/settings/page.tsx` — append "Embed on your website" section to the existing Booking Page tab render block

---

## Milestones

- **M1 (Tasks 1–2):** Backend schema updates — additive, safe to deploy first.
- **M2 (Tasks 3–4):** Embed route + middleware + robots.
- **M3 (Tasks 5–6):** BookingWidget `embedded` prop + booking-source threading.
- **M4 (Task 7):** Admin Settings snippet section.
- **M5 (Task 8):** Manual end-to-end verification.

---

# M1: Backend schema updates

## Task 1: Add `embedded_widget` to payments schema

**Files:**
- Modify: `glowos/services/api/src/routes/payments.ts` (around line 28, the `booking_source` enum in `createPaymentIntentSchema`)

- [ ] **Step 1: Inspect the current schema**

Open the file and locate `createPaymentIntentSchema`. The `booking_source` field is a `z.enum([...])`. Note the current values:

```ts
booking_source: z
  .enum([
    "google_reserve",
    "google_gbp_link",
    "direct_widget",
    "instagram",
    "qr_walkin",
    "walkin_manual",
  ])
  .default("direct_widget"),
```

- [ ] **Step 2: Add the new enum value**

Append `"embedded_widget"` to the array. The full field becomes:

```ts
booking_source: z
  .enum([
    "google_reserve",
    "google_gbp_link",
    "direct_widget",
    "instagram",
    "qr_walkin",
    "walkin_manual",
    "embedded_widget",
  ])
  .default("direct_widget"),
```

- [ ] **Step 3: Build check**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/glowos/services/api
pnpm tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm
git add glowos/services/api/src/routes/payments.ts
git commit -m "feat(api): add embedded_widget to payment intent booking_source enum"
```

---

## Task 2: Thread `booking_source` through `/booking/:slug/confirm`

**Files:**
- Modify: `glowos/services/api/src/routes/bookings.ts` (confirm schema around line 48 + insert around line 1281)

- [ ] **Step 1: Extend `confirmSchema`**

Locate `const confirmSchema = z.object({...})` (around line 48). Add a new `booking_source` field matching the payment-intent schema:

```ts
const confirmSchema = z.object({
  lease_id: z.string().uuid(),
  client_name: z.string().min(1, "Client name is required"),
  client_phone: z.string().min(1, "Client phone is required"),
  client_email: z.string().email().optional(),
  client_id: z.string().uuid().optional(),
  payment_method: z.string().optional(),
  verification_token: z.string().optional(),
  booking_source: z
    .enum([
      "google_reserve",
      "google_gbp_link",
      "direct_widget",
      "instagram",
      "qr_walkin",
      "walkin_manual",
      "embedded_widget",
    ])
    .optional(),
});
```

- [ ] **Step 2: Use it in the booking insert**

Locate the booking insert inside the `/:slug/confirm` handler around line 1281:

```ts
bookingSource: "direct_widget",
```

Change to:

```ts
bookingSource: body.booking_source ?? "direct_widget",
```

- [ ] **Step 3: Build check**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/glowos/services/api
pnpm tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm
git add glowos/services/api/src/routes/bookings.ts
git commit -m "feat(api): accept booking_source in /confirm; default direct_widget"
```

---

# M2: Embed route + middleware + robots

## Task 3: `robots.txt` disallow + middleware for `/embed/*`

**Files:**
- Create: `glowos/apps/web/public/robots.txt`
- Create: `glowos/apps/web/middleware.ts`

- [ ] **Step 1: Create `robots.txt`**

Create `glowos/apps/web/public/robots.txt` with:

```
User-agent: *
Disallow: /embed/
```

- [ ] **Step 2: Create `middleware.ts`**

Create `glowos/apps/web/middleware.ts` with:

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

- [ ] **Step 3: Build check**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/glowos/apps/web
pnpm tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm
git add glowos/apps/web/public/robots.txt glowos/apps/web/middleware.ts
git commit -m "feat(web): allow framing on /embed/* and disallow crawling"
```

---

## Task 4: Create `/embed/[slug]` page

**Files:**
- Create: `glowos/apps/web/app/embed/[slug]/page.tsx`

- [ ] **Step 1: Study the existing `/{slug}/page.tsx` data-fetching pattern**

Open `glowos/apps/web/app/[slug]/page.tsx` and note:
- `export const dynamic = 'force-dynamic';` at the top
- The server-side fetch of merchant/services/staff data via `apiFetch`
- The shape of the data passed to `<BookingWidget merchant={...} services={...} staff={...} slug={slug} />`

The embed page reuses the same fetch and the same BookingWidget component. Only the surrounding JSX changes.

- [ ] **Step 2: Create the embed page**

Create `glowos/apps/web/app/embed/[slug]/page.tsx` with:

```tsx
import type { Metadata } from 'next';
import { apiFetch } from '../../lib/api';
import BookingWidget from '../../[slug]/BookingWidget';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface SalonData {
  merchant: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    logoUrl: string | null;
    coverPhotoUrl: string | null;
    phone: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    postalCode: string | null;
    timezone: string;
    paymentEnabled?: boolean;
    operatingHours?: Record<string, { open: string; close: string; closed: boolean }> | null;
  };
  services: Array<{
    id: string;
    name: string;
    description: string | null;
    durationMinutes: number;
    priceSgd: string;
    category: string;
    slotType: 'standard' | 'consult' | 'treatment';
    requiresConsultFirst: boolean;
    discountPct: number | null;
    discountShowOnline: boolean;
    firstTimerDiscountPct: number | null;
    firstTimerDiscountEnabled: boolean;
  }>;
  staff: Array<{
    id: string;
    name: string;
    photoUrl: string | null;
    title: string | null;
    specialty: string | null;
  }>;
}

export default async function EmbedPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let data: SalonData | null = null;
  try {
    data = (await apiFetch(`/booking/${slug}`)) as SalonData;
  } catch {
    data = null;
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center p-4">
        <p className="text-sm text-gray-500">Booking is temporarily unavailable.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent">
      <div className="max-w-2xl mx-auto px-2 py-4">
        <BookingWidget
          merchant={data.merchant}
          services={data.services}
          staff={data.staff}
          slug={slug}
          embedded
        />
      </div>
      <footer className="py-3 text-center">
        <span className="text-[11px] text-gray-400">Powered by GlowOS</span>
      </footer>
    </div>
  );
}
```

Notes:
- `metadata.robots` also emits `<meta name="robots" content="noindex, nofollow">` — belt-and-braces alongside `robots.txt`.
- The import path `../../[slug]/BookingWidget` crosses the `embed/` directory up to `app/`, then into `[slug]/`. If Next.js complains about path resolution, use an absolute-ish path like `'@/app/[slug]/BookingWidget'` only if the project has a `tsconfig.json` path alias — otherwise the relative path above is correct.
- The `embedded` prop is defined in Task 5 below. Adding it here before Task 5 will trigger a type error — that's expected and resolved once Task 5 lands. Commit this file anyway; Task 5 clears it.
- The `apiFetch(`/booking/${slug}`)` call uses whatever endpoint `/{slug}/page.tsx` currently uses to load salon data. If that path is different (e.g., `/booking/${slug}/info` or similar), copy it verbatim from the existing page.

- [ ] **Step 3: Build check**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/glowos/apps/web
pnpm tsc --noEmit
```

Expected: ONE error about the `embedded` prop not existing on `BookingWidget`. This is resolved by Task 5. If you see OTHER errors, stop and report them.

- [ ] **Step 4: Commit**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm
git add "glowos/apps/web/app/embed/[slug]/page.tsx"
git commit -m "feat(web): /embed/[slug] route — minimal iframe-friendly booking view"
```

---

# M3: BookingWidget prop + source threading

## Task 5: Add `embedded` prop and source override to BookingWidget

**Files:**
- Modify: `glowos/apps/web/app/[slug]/BookingWidget.tsx`

- [ ] **Step 1: Add `embedded` to the `BookingWidgetProps` interface**

Find the props interface for `BookingWidget` (grep for `interface BookingWidgetProps` or `type BookingWidgetProps`). Add:

```ts
embedded?: boolean;
```

Mark it optional. In the function signature, destructure it with a default:

```tsx
export default function BookingWidget({
  merchant,
  services,
  staff,
  slug,
  embedded = false,
}: BookingWidgetProps) {
```

- [ ] **Step 2: Derive the booking source**

Near the top of the component body, after the `useState` declarations, add:

```ts
const bookingSource = embedded ? 'embedded_widget' : 'direct_widget';
```

- [ ] **Step 3: Thread into the `/confirm` POST body**

Find `handleConfirmBooking` (around line 640). In the `apiFetch('/booking/${slug}/confirm', { ... })` POST body, add `booking_source: bookingSource` to the JSON:

```ts
body: JSON.stringify({
  lease_id: leaseId,
  client_name: clientName.trim(),
  client_phone: clientPhone.trim(),
  client_email: clientEmail.trim() || undefined,
  client_id: authClient?.id || undefined,
  payment_method: 'cash',
  verification_token: verificationToken ?? undefined,
  booking_source: bookingSource,
}),
```

- [ ] **Step 4: Thread into the `/create-payment-intent` POST body**

Find the `/create-payment-intent` POST (around line 1414). In its body, also include `booking_source`:

```ts
body: JSON.stringify({
  lease_id: leaseId,
  service_id: selectedService.id,
  client_name: clientName,
  client_email: clientEmail || undefined,
  client_phone: clientPhone,
  client_id: authClient?.id || undefined,
  verification_token: verificationToken ?? undefined,
  booking_source: bookingSource,
}),
```

(Match the existing field set. Don't remove any existing fields.)

- [ ] **Step 5: Minor layout tightening when `embedded`**

Find the outermost wrapper JSX of the widget (usually a `<div className="...">`). If it has a max-width or sticky-nav style, conditionally loosen it when embedded. The simplest tweak: if the root wrapper contains anything like `className="min-h-screen bg-gray-50 …"`, change the background rule to be transparent in embed mode. Specifically, look for background-color classes on the outermost div and conditionally apply `bg-transparent` when `embedded`.

If the widget's top-level render is already wrapped in a neutral background (e.g., `className="space-y-4"` with no bg), NO change is needed — the embed page's parent div already handles layout. In that case, skip this step.

Use judgment: the goal is that the widget rendered inside an iframe does not have a conflicting full-page background color that overrides the transparent parent.

- [ ] **Step 6: Build check**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/glowos/apps/web
pnpm tsc --noEmit
```

Expected: NO errors. The Task 4 error should now be resolved.

- [ ] **Step 7: Commit**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm
git add "glowos/apps/web/app/[slug]/BookingWidget.tsx"
git commit -m "feat(web): BookingWidget embedded prop + booking_source wiring"
```

---

## Task 6: Smoke test M1–M3 end-to-end locally

**Files:** None (verification only)

- [ ] **Step 1: Run the web app locally**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/glowos/apps/web
pnpm dev
```

Wait for `Local: http://localhost:3000`.

- [ ] **Step 2: Open `/embed/abc`**

Navigate to `http://localhost:3000/embed/abc` in a browser. Verify:
- Widget renders
- No merchant header block (logo/name/address/description) above the widget
- "Powered by GlowOS" appears in plain gray text at the bottom
- Background is not a full-page colored background

- [ ] **Step 3: Complete a booking on the embed route**

Pick any service, staff, time. Fill in the details (use a phone you control for OTP if needed, or a known test phone). Complete the booking (pay-at-appointment flow is easiest for testing).

- [ ] **Step 4: Verify `booking_source` in the DB**

```bash
DATABASE_URL="<production-or-dev-branch>" psql -c "SELECT id, created_at, booking_source FROM bookings ORDER BY created_at DESC LIMIT 3;"
```

(Or use a node one-liner with Drizzle if you prefer. Any Neon branch works — ideally a dev branch.)

Expected: the most recent booking has `booking_source = 'embedded_widget'`.

- [ ] **Step 5: Verify `/abc` (direct route) still tags `direct_widget`**

Repeat: complete a booking at `http://localhost:3000/abc`. Verify `booking_source = 'direct_widget'` in the DB.

If both checks pass, this is a git-safe commit point. No source changes in this task — commit a no-op trailer if desired, otherwise move on.

---

# M4: Admin Settings snippet section

## Task 7: Add "Embed on your website" section to Booking Page tab

**Files:**
- Modify: `glowos/apps/web/app/dashboard/settings/page.tsx` (around line 1709, the `{activeTab === 'booking-page' && (...)}` block)

- [ ] **Step 1: Locate the existing Booking Page tab render block**

Grep for `activeTab === 'booking-page'` in `settings/page.tsx`. Find the closing `)}` of that tab's JSX. Your new section is inserted at the end of that tab's content — just before the closing `)}`.

- [ ] **Step 2: Add state for the copy confirmation**

Near the other `useState` hooks at the top of the Settings component, add:

```ts
const [embedCopied, setEmbedCopied] = useState(false);
```

- [ ] **Step 3: Build the embed snippet string**

Near where you render the booking-page tab, compute the embed URL and snippet:

```ts
const baseUrl =
  typeof window !== 'undefined'
    ? window.location.origin
    : 'https://glowos-nine.vercel.app';
const embedSnippet = merchant?.slug
  ? `<iframe\n  src="${baseUrl}/embed/${merchant.slug}"\n  width="100%"\n  height="900"\n  style="border:0; max-width: 720px;"\n></iframe>`
  : '';
```

(Place this inside the component body above the render. `merchant` is the existing state that holds the loaded merchant info.)

- [ ] **Step 4: Add the section to the tab JSX**

Just before the closing `)}` of the booking-page tab block, append:

```tsx
{/* Embed on your website */}
<div className="bg-white rounded-2xl border border-gray-200 p-6 mt-6">
  <h3 className="text-base font-semibold text-gray-900">Embed on your website</h3>
  <p className="text-sm text-gray-500 mt-1">
    Paste this into your website&apos;s custom HTML block to show the booking
    widget inline.
  </p>
  <pre className="mt-4 rounded-lg bg-gray-50 border border-gray-200 p-4 text-xs text-gray-800 overflow-x-auto whitespace-pre">
{embedSnippet}
  </pre>
  <div className="mt-3 flex flex-wrap gap-2">
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(embedSnippet);
        setEmbedCopied(true);
        setTimeout(() => setEmbedCopied(false), 2000);
      }}
      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
    >
      {embedCopied ? 'Copied!' : 'Copy'}
    </button>
    {merchant?.slug && (
      <a
        href={`${baseUrl}/embed/${merchant.slug}`}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        Preview in new tab →
      </a>
    )}
  </div>
  <p className="mt-3 text-xs text-gray-400">
    Works with Wix, Squarespace, WordPress, Shopify, and most site builders.
    Adjust the height if your customers need more room.
  </p>
</div>
```

Style classes (rounded-2xl, border, etc.) should match what the existing tab sections already use. If your existing Booking Page tab cards use different class patterns (e.g., different padding, different heading sizes), adjust to match so the new section is visually consistent.

- [ ] **Step 5: Build check**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm/glowos/apps/web
pnpm tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 6: Manual smoke in the admin**

Restart `pnpm dev` if needed. Log into the merchant dashboard. Navigate to Settings → Booking Page tab. Scroll to the bottom.

Verify:
- The "Embed on your website" section appears
- The snippet shows the iframe tag with `https://localhost:3000/embed/<your-slug>` filled in
- "Copy" button copies the snippet to clipboard; shows "Copied!" for 2 seconds
- "Preview in new tab →" opens the embed route

- [ ] **Step 7: Commit**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm
git add glowos/apps/web/app/dashboard/settings/page.tsx
git commit -m "feat(web): 'Embed on your website' section in Booking Page tab"
```

---

# M5: Production verification

## Task 8: End-to-end production verification

**Files:** None (verification only)

- [ ] **Step 1: Deploy by merging to main + pushing**

If using a feature branch / worktree, merge and push:

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm
git checkout main
git merge --no-ff <feature-branch>
git push origin main
```

Railway redeploys the API; Vercel redeploys the web app. Wait ~2–3 min.

- [ ] **Step 2: Verify API health**

```bash
curl https://bookingcrm-production.up.railway.app/health
```

Expected: `{"status":"ok",...}`.

- [ ] **Step 3: Open `/embed/<your-slug>` in the browser**

Navigate to `https://glowos-nine.vercel.app/embed/<your-slug>`. Verify:
- Widget renders
- No merchant header card above widget
- "Powered by GlowOS" footer visible
- Complete a booking with a test phone

- [ ] **Step 4: Verify the new booking has `booking_source = 'embedded_widget'`**

```bash
DATABASE_URL="<production-connection-string>" \
  psql -c "SELECT id, created_at, booking_source FROM bookings ORDER BY created_at DESC LIMIT 3;"
```

Expected: latest row has `booking_source = 'embedded_widget'`.

- [ ] **Step 5: Iframe test from a third-party origin**

Create a throwaway HTML file anywhere (e.g., `/tmp/embed-test.html`):

```html
<!DOCTYPE html>
<html>
<head><title>Embed test</title></head>
<body style="background:#f0f0f0; padding:40px;">
  <h1>Test site</h1>
  <p>Below is the embedded booking widget:</p>
  <iframe
    src="https://glowos-nine.vercel.app/embed/<your-slug>"
    width="100%"
    height="900"
    style="border:0; max-width: 720px;"
  ></iframe>
</body>
</html>
```

Open the file in a browser (`open /tmp/embed-test.html` on Mac). Verify:
- The iframe loads the widget
- No console error about `X-Frame-Options` or `refused to display`
- The widget is functional inside the iframe (click through the steps)

- [ ] **Step 6: Verify direct route still works**

Open `https://glowos-nine.vercel.app/<your-slug>` — standard booking page unchanged. Complete a booking. Verify DB row has `booking_source = 'direct_widget'` (no regression).

- [ ] **Step 7: Verify admin snippet in production**

Log into the production dashboard (`/login`). Settings → Booking Page. Verify the new "Embed on your website" section appears and the snippet contains `https://glowos-nine.vercel.app/embed/<your-slug>`.

- [ ] **Step 8: Update progress.md**

Append a section for the embed feature to `progress.md` (Session 12 or extend Session 11). Commit:

```bash
git add progress.md
git commit -m "docs: embed booking widget shipped to production"
git push origin main
```

---

## Plan Self-Review Notes

- **Spec coverage:** Every section in the spec maps to a task.
  - Architecture / new route → Task 4
  - Format (inline iframe, fixed height) → implicit in Task 7 snippet
  - Embed view layout (transparent bg, no merchant header, Powered-by footer) → Task 4
  - BookingWidget `embedded` prop → Task 5
  - Missing-slug handling → Task 4 step 2 (catch block + inline message)
  - Admin snippet UI → Task 7
  - `booking_source = 'embedded_widget'` enum → Task 1 + Task 2
  - X-Frame-Options / CSP middleware → Task 3
  - `robots.txt` + meta robots → Task 3 + Task 4
  - Testing checklist → Task 6 (local) + Task 8 (prod)
  - Rollout order (backend first) → Tasks 1–2 ship before Task 5 wiring
- **Placeholder scan:** no `TBD` / `TODO` / "implement later" markers.
- **Type consistency:** `embedded?: boolean` + `booking_source: "embedded_widget"` are used consistently across Tasks 1, 2, 4, 5.
- **Explicitly out of scope (deferred):** postMessage auto-resize, popup/modal embed variant, theme/color customization, domain whitelist, white-label footer, embed-specific analytics dashboard.
