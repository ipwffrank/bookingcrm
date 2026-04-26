# Landing Page Redesign — Design Brief (WIP)

**Status:** Brainstorming paused 2026-04-21 · To be revisited
**Target file:** `glowos/apps/web/app/page.tsx`
**Existing page:** Hero video + bento features + concierge + dark CTA + 3-tier pricing + footer

---

## Decisions made

| Question | Decision |
|---|---|
| Scope | Full rethink from scratch |
| Landing-page audience framing | Ultra-luxury multi-service (Aman / Four Seasons tier) |
| Positioning strategy | **Aspirational** — landing punches upmarket to make SME Malaysian wellness buyers *feel* premium (Apple-style). Real buyer remains SME; pricing stays $499 / $1,299 / Bespoke. |
| Primary CTA | **Book a private walkthrough** (concierge sales motion, no self-serve) |
| Visual direction | **Modern Minimal** — Linear-meets-Loro-Piana. Clean sans display, generous whitespace, subtle sage accent, ink primary. Less heritage, more right-now. |
| Structural approach | **Editorial Story** — ~9 sections. Layered credibility before the call. Magazine-feature rhythm. |
| Video / motion | **Animated product demo** as the centerpiece (HTML/CSS/JS — no real mp4). Shows WhatsApp enquiry at 11:47pm → AI drafts reply → calendar fills → VIP profile updates. |

---

## Palette

| Role | Value | Usage |
|---|---|---|
| Surface | `#ffffff` | Default background |
| Surface warm | `#f7f4ef` | Alternating warm-sand sections |
| Outline | `#e8e4de` | Borders, dividers |
| Primary (ink) | `#0a0a0a` | Text, dark inverted sections, primary CTA |
| Muted text | `#666` / `#888` | Body and secondary text |
| Accent (sage) | `#6b8e5a` | Status pill, highlights, ambient glow |
| Gilt (optional) | `#8a7556` | Editorial labels only |

Typography:
- **Display / body:** Inter (or `-apple-system`) — display weight 500, tight tracking (-0.03em)
- **Editorial:** Georgia / Playfair (italic accents only, not the workhorse)
- Current page uses serif as primary — this redesign **flips** that: sans workhorse, serif italic for editorial moments only.

---

## Page structure (9 sections)

Alternating surface rhythm: ivory → sand → ink → ivory → sand → ivory → sand → ivory → ink

1. **Nav** — fixed, blurred glass. Logo left · 3 links center (Platform, Concierge, Membership) · "Book a walkthrough" CTA right.

2. **Hero** *(ivory)*
   - Sage accent pill: "Now accepting founding members"
   - H1: "Your front desk, / minus the front desk." (sans, 500 weight, muted second line)
   - Sub: "The quiet operating system behind wellness houses who treat hospitality as a craft. Booking, billing, follow-up — handled, before your morning coffee."
   - Primary CTA: "Book a private walkthrough →" · Secondary: "See the product"

3. **Problem framing** *(warm sand)* — "The Quiet Revenue Leak"
   - Editorial sub: "A missed booking isn't one lost sale. It's the client, her friend, and five more visits she would've made this year."
   - Three animated stats: **RM 47K/mo leak** · **38% of bookings after 8pm** · **5.2 hrs/week reception admin per chair**

4. **Animated product demo** *(ink black — centerpiece)*
   - "Watch what happens at 11:47pm on a Tuesday."
   - Looped sequence: message bubble in → AI drafts → confirmation sent → calendar entry populates → VIP profile updates → deposit collected
   - Label: "Live — no screen recording." Signal that this is the actual product UI.

5. **Case study №01** *(ivory)*
   - Pull quote + 4-stat grid: **+31% revenue**, **−64% no-shows**, **4.2× repeat rate**, **0 receptionists**
   - Placeholder client: "The Aura Wellness House, KL — Aisha R., Founder"

6. **Concierge / AI** *(warm sand)*
   - "Your front desk, minus the front desk."
   - 2-3 feature list: Intelligent Routing, Automated Follow-Up, VIP Recognition

7. **Membership / Pricing** *(ivory)* — keep existing Studio / Estate / Institutional tiers
   - Estate remains featured ("Most Popular")

8. **Trust row** *(ivory-warm)* — placeholder wellness-house wordmarks + press mentions row

9. **FAQ** *(ivory)* — minimal accordion, 6-8 Qs. Starters:
   - How is this different from Mindbody / Fresha?
   - What's the onboarding process?
   - Do you integrate with Reserve with Google?
   - Can my team migrate from an existing system?
   - What happens if the AI replies incorrectly?
   - Is my client data mine?

10. **Final CTA** *(ink, ambient sage glow)*
    - "The businesses that win don't work harder. They stop losing."
    - Single CTA: "Book a private walkthrough →"

11. **Footer** *(warm-sand)* — minimal, current structure retained

---

## Animated demo — storyboard (for later)

Frame 1 (0.0s): Clock reads "11:47 PM". Calendar view dim.
Frame 2 (1.2s): WhatsApp bubble appears bottom-left: "Hi, any availability tomorrow?"
Frame 3 (2.4s): AI status pulses "drafting…" in sage.
Frame 4 (3.6s): Outgoing bubble appears: "Good evening, Hannah. I have 3pm open — shall I confirm?"
Frame 5 (4.8s): Incoming "Yes please." · Deposit collected badge fades in.
Frame 6 (6.0s): Calendar row for Tuesday 3pm slides in with Hannah Tan name.
Frame 7 (7.2s): Right rail VIP profile updates — "Last visit: Mar 14 · Prefers: quiet room · Therapist: Rachel."
Frame 8 (8.4s): Dashboard revenue counter ticks +RM 420.
Frame 9 (9.6s): Fade out → loop.

Implementation: single React component, `requestAnimationFrame` or Framer Motion. No external video file.

---

## Open questions (for next session)

- [ ] Hero imagery decision — keep text-only, or add a static photo (hands, spa detail) to the right half?
- [ ] Case study — fabricate placeholder or wait for a real client willing to be featured?
- [ ] Trust row — do we have any real logos/press, or all placeholders for now?
- [ ] Reserve-with-Google integration story — called out in hero badge, or only in FAQ?
- [ ] Mobile treatment for the animated demo — simplified sequence, or static stills?
- [ ] Accessibility — animation must respect `prefers-reduced-motion`; confirm pattern.
- [ ] Analytics events — which CTA clicks need tracking (walkthrough booked, demo seen, pricing viewed)?

---

## Next steps when resuming

1. Review this doc, confirm/adjust decisions above
2. Walk through remaining section designs (hero detail, animated-demo detail, case study detail)
3. Finalize copy deck
4. Spec self-review → user review → writing-plans skill → implementation

## Reference artifacts

Visual mockups generated during this session (if preserved):
`.superpowers/brainstorm/21079-1776719890/content/` — visual-direction.html, page-structure.html
