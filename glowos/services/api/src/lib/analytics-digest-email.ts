import type { DigestMetrics } from "./analytics-aggregator.js";
import type { UtilizationResult } from "./utilization.js";

/**
 * Renders the Analytics Digest email body. PR 1 ships numeric content
 * only — no AI prose. The HTML is intentionally inline-styled (matches
 * the rest of glowos/services/api/src/lib/email.ts) so it survives
 * Gmail / Outlook stripping. No markdown, no external CSS.
 *
 * Structure follows the business panel's phone-first guidance:
 *   1. Hero: one verdict + the 3 most-mover KPIs with deltas
 *   2. Mini KPI grid (the rest)
 *   3. Highlights (best day / quietest day / top service)
 *   4. Footer with date range + dashboard link
 */

export type DigestFrequency = "weekly" | "monthly" | "yearly";

interface Args {
  merchantName: string;
  frequency: DigestFrequency;
  metrics: DigestMetrics;
  dashboardUrl: string;
  unsubscribeNote?: string;
  // For yearly + monthly we render the date range as e.g. "April 2026"
  // or "2026" for compactness. Computed in the worker so timezone is
  // applied uniformly.
  periodLabel: string;
  // Optional AI-generated suggestions block. When omitted (Gemini key
  // missing, generation failed, or guardrails rejected the output) the
  // email renders cleanly without the section — numeric content stays
  // self-contained.
  aiProseMd?: string;
  // Capacity utilization for the period. When the headline is null
  // (no usable capacity data) the row is omitted from the email.
  utilization?: UtilizationResult;
}

interface Delta {
  label: string;
  arrow: "▲" | "▼" | "—";
  pct: string;
  tone: "good" | "bad" | "neutral";
}

const COLOURS = {
  ink: "#1a2313",
  surface: "#ffffff",
  surfaceWarm: "#f7f5f0",
  sage: "#456466",
  grey60: "#6b7771",
  grey45: "#9ca3a1",
  grey15: "#e3e6e1",
  grey5: "#f3f4f1",
  warn: "#a86a2c",
  danger: "#a13b3b",
} as const;

function toneColour(tone: Delta["tone"]): string {
  if (tone === "good") return COLOURS.sage;
  if (tone === "bad") return COLOURS.danger;
  return COLOURS.grey60;
}

function fmtSgd(n: number): string {
  if (n >= 100000) return `S$${(n / 1000).toFixed(0)}k`;
  if (n >= 10000) return `S$${(n / 1000).toFixed(1)}k`;
  return `S$${Math.round(n).toLocaleString("en-SG")}`;
}

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function fmtDateLong(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function deltaPct(current: number, prior: number): {
  pct: string;
  arrow: "▲" | "▼" | "—";
} {
  if (prior === 0 && current === 0) return { pct: "—", arrow: "—" };
  if (prior === 0) return { pct: "new", arrow: "▲" };
  const diff = ((current - prior) / prior) * 100;
  const abs = Math.abs(diff);
  if (abs < 0.5) return { pct: "—", arrow: "—" };
  return {
    pct: `${abs.toFixed(abs < 10 ? 1 : 0)}%`,
    arrow: diff > 0 ? "▲" : "▼",
  };
}

function frequencyHeading(f: DigestFrequency): string {
  if (f === "weekly") return "Weekly digest";
  if (f === "monthly") return "Monthly digest";
  return "Annual digest";
}

/**
 * One-sentence verdict at the top. Looks at the biggest mover among
 * revenue / bookings / no-show rate and frames it in plain language.
 */
function verdict(m: DigestMetrics): string {
  const revD = deltaPct(m.revenueSgd, m.prior.revenueSgd);
  const noShowD = deltaPct(m.noShowRate, m.prior.noShowRate);
  if (revD.arrow === "▲" && (revD.pct === "new" || parseFloat(revD.pct) >= 5)) {
    return `Solid period — revenue up ${revD.pct}.`;
  }
  if (revD.arrow === "▼" && parseFloat(revD.pct) >= 5) {
    return `Revenue softened ${revD.pct} vs prior period.`;
  }
  if (noShowD.arrow === "▲" && m.noShowRate > 0.08) {
    return `No-show rate climbing — review your reminder cadence.`;
  }
  if (m.bookingsCount === 0) {
    return `No bookings recorded this period.`;
  }
  return `Steady period — minor movement only.`;
}

function deltaCell(d: { pct: string; arrow: "▲" | "▼" | "—" }, goodIfUp: boolean): string {
  const tone: Delta["tone"] =
    d.arrow === "—"
      ? "neutral"
      : d.arrow === "▲"
        ? goodIfUp
          ? "good"
          : "bad"
        : goodIfUp
          ? "bad"
          : "good";
  return `<span style="color:${toneColour(tone)};font-size:11px;font-weight:600">${d.arrow} ${d.pct}</span>`;
}

function heroCard(label: string, value: string, deltaHtml: string): string {
  return `
    <td style="background:${COLOURS.grey5};border-radius:8px;padding:14px 16px;text-align:left;width:33%;vertical-align:top">
      <div style="color:${COLOURS.grey60};font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">${label}</div>
      <div style="color:${COLOURS.ink};font-size:22px;font-weight:700;margin-bottom:2px;line-height:1.1">${value}</div>
      <div>${deltaHtml}</div>
    </td>
  `.trim();
}

function gridRow(label: string, value: string, deltaHtml: string): string {
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${COLOURS.grey15};color:${COLOURS.grey60};font-size:13px">${label}</td>
      <td style="padding:10px 0;border-bottom:1px solid ${COLOURS.grey15};color:${COLOURS.ink};font-size:13px;font-weight:600;text-align:right">${value}</td>
      <td style="padding:10px 0;border-bottom:1px solid ${COLOURS.grey15};text-align:right;width:64px">${deltaHtml}</td>
    </tr>
  `.trim();
}

function highlightLine(emoji: string, text: string): string {
  return `<div style="padding:8px 0;font-size:13px;color:${COLOURS.ink}"><span style="margin-right:6px">${emoji}</span>${text}</div>`;
}

/**
 * Convert the Gemini-generated markdown (with `Suggestions:` and `Wins:`
 * sections plus dash-prefixed bullets) into safe inline-styled HTML. We
 * intentionally do not pull in a markdown library — the input format is
 * narrow and any HTML in the model output should be escaped, not
 * rendered, to defuse prompt-injection attempts that try to embed
 * `<script>` or off-domain links inside the email body.
 */
function renderAiBlock(markdown: string, frequency: DigestFrequency): string {
  const heading = frequency === "weekly"
    ? "Suggestions for the week ahead"
    : frequency === "monthly"
      ? "Strategy questions for the month"
      : "Themes for the year ahead";

  // Split into sections by their heading lines.
  const sectionMatch = (label: string): string[] => {
    const re = new RegExp(`${label}\\s*:?\\s*\\n([\\s\\S]*?)(?=\\n\\s*(?:Suggestions|Wins)\\s*:|$)`, "i");
    const m = markdown.match(re);
    if (!m) return [];
    return m[1]!
      .split(/\n+/)
      .map((line) => line.trim().replace(/^[-*•]\s+/, ""))
      .filter((line) => line.length > 0);
  };

  const suggestions = sectionMatch("Suggestions");
  const wins = sectionMatch("Wins");

  if (suggestions.length === 0 && wins.length === 0) return "";

  const renderList = (items: string[]) =>
    items.map((it) => `<li style="margin:4px 0">${escapeHtml(it)}</li>`).join("");

  const suggestionsBlock = suggestions.length === 0 ? "" : `
    <div style="margin-top:8px">
      <div style="font-size:12px;font-weight:600;color:${COLOURS.ink};margin-bottom:4px">Suggestions</div>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:${COLOURS.ink};line-height:1.5">
        ${renderList(suggestions)}
      </ul>
    </div>`;

  const winsBlock = wins.length === 0 ? "" : `
    <div style="margin-top:12px">
      <div style="font-size:12px;font-weight:600;color:${COLOURS.sage};margin-bottom:4px">Wins to repeat</div>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:${COLOURS.ink};line-height:1.5">
        ${renderList(wins)}
      </ul>
    </div>`;

  return `
    <div style="margin-top:24px;padding:16px;background:${COLOURS.surface};border:1px solid ${COLOURS.grey15};border-radius:8px">
      <div style="color:${COLOURS.grey60};font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">${heading}</div>
      ${suggestionsBlock}
      ${winsBlock}
      <div style="margin-top:12px;font-size:10px;color:${COLOURS.grey45}">Generated by AI from the numbers above. Always cross-check before acting.</div>
    </div>
  `;
}

function utilizationValueHtml(headline: NonNullable<UtilizationResult["headline"]>): string {
  const raw = headline.utilizationPct;
  const display = Math.min(100, Math.round(raw));
  const overflow = raw > 100
    ? ` <sup style="color:${COLOURS.grey45};font-weight:400;font-size:9px">100%+</sup>`
    : "";
  return `${display}%${overflow}`;
}

function utilizationDeltaHtml(pp: number | null): string {
  if (pp === null) return "";
  const abs = Math.abs(pp);
  if (abs < 0.5) return deltaCell({ pct: "—", arrow: "—" }, true);
  return deltaCell(
    { pct: `${abs.toFixed(1)}pp`, arrow: pp > 0 ? "▲" : "▼" },
    true,
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderDigestEmail(args: Args): { subject: string; html: string } {
  const { merchantName, frequency, metrics: m, dashboardUrl, periodLabel } = args;

  const revD = deltaPct(m.revenueSgd, m.prior.revenueSgd);
  const bkD = deltaPct(m.bookingsCount, m.prior.bookingsCount);
  const nsD = deltaPct(m.noShowRate, m.prior.noShowRate);
  const ratingDelta =
    m.averageRating !== null && m.prior.averageRating !== null
      ? deltaPct(m.averageRating, m.prior.averageRating)
      : { pct: "—", arrow: "—" as const };

  // Subject line surfaces the single biggest mover, per the business panel.
  const subjectLead = (() => {
    if (revD.arrow !== "—" && (revD.pct === "new" || parseFloat(revD.pct) >= 1)) {
      return `Revenue ${revD.arrow} ${revD.pct}`;
    }
    if (bkD.arrow !== "—" && parseFloat(bkD.pct) >= 1) {
      return `Bookings ${bkD.arrow} ${bkD.pct}`;
    }
    if (m.noShowRate > 0.08) {
      return `No-shows at ${fmtPct(m.noShowRate)}`;
    }
    return `${m.bookingsCount} bookings · ${fmtSgd(m.revenueSgd)}`;
  })();
  const subject = `Analytics Digest · ${periodLabel} — ${subjectLead}`;

  const heroRow = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0">
      <tr>
        ${heroCard("Revenue", fmtSgd(m.revenueSgd), deltaCell(revD, true))}
        ${heroCard("Bookings", String(m.bookingsCount), deltaCell(bkD, true))}
        ${heroCard("No-show rate", fmtPct(m.noShowRate), deltaCell(nsD, false))}
      </tr>
    </table>
  `;

  const grid = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:16px">
      ${gridRow(
        "First-timer return rate",
        m.firstTimerReturnRatePct === null
          ? `— <span style="color:${COLOURS.grey45};font-weight:400;font-size:11px">(${m.firstTimerSampleSize} new)</span>`
          : `${m.firstTimerReturnRatePct}% <span style="color:${COLOURS.grey45};font-weight:400;font-size:11px">(${m.firstTimerSampleSize} new)</span>`,
        m.prior.firstTimerReturnRatePct !== null && m.firstTimerReturnRatePct !== null
          ? deltaCell(deltaPct(m.firstTimerReturnRatePct, m.prior.firstTimerReturnRatePct), true)
          : "",
      )}
      ${args.utilization?.headline ? gridRow(
        "Capacity utilization",
        utilizationValueHtml(args.utilization.headline),
        utilizationDeltaHtml(args.utilization.headline.deltaVsPriorPp),
      ) : ""}
      ${gridRow(
        "Reviews",
        m.averageRating === null
          ? `${m.reviewsCount} new`
          : `${m.averageRating.toFixed(1)} ★ <span style="color:${COLOURS.grey45};font-weight:400;font-size:11px">(${m.reviewsCount} new)</span>`,
        m.averageRating !== null && m.prior.averageRating !== null
          ? deltaCell(ratingDelta, true)
          : "",
      )}
      ${gridRow(
        "Cancellations",
        String(m.cancelledCount),
        deltaCell(deltaPct(m.cancelledCount, m.prior.cancelledCount), false),
      )}
    </table>
  `;

  const highlights: string[] = [];
  if (m.highlights.busiestDay) {
    highlights.push(
      highlightLine(
        "🚀",
        `Best day: <strong>${fmtDateLong(m.highlights.busiestDay.date)}</strong> with ${m.highlights.busiestDay.bookings} bookings`,
      ),
    );
  }
  if (m.highlights.quietestDay && m.highlights.busiestDay && m.highlights.quietestDay.date !== m.highlights.busiestDay.date) {
    highlights.push(
      highlightLine(
        "💤",
        `Quietest day: <strong>${fmtDateLong(m.highlights.quietestDay.date)}</strong> with ${m.highlights.quietestDay.bookings} booking${m.highlights.quietestDay.bookings === 1 ? "" : "s"}`,
      ),
    );
  }
  if (m.highlights.topServiceByRevenue) {
    highlights.push(
      highlightLine(
        "💰",
        `Top service: <strong>${m.highlights.topServiceByRevenue.name}</strong> — ${fmtSgd(m.highlights.topServiceByRevenue.revenueSgd)}`,
      ),
    );
  }

  const highlightsBlock = highlights.length === 0
    ? ""
    : `
      <div style="margin-top:24px;padding:16px;background:${COLOURS.surfaceWarm};border-radius:8px">
        <div style="color:${COLOURS.grey60};font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Highlights</div>
        ${highlights.join("")}
      </div>
    `;

  const aiBlock = args.aiProseMd ? renderAiBlock(args.aiProseMd, frequency) : "";

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:${COLOURS.surfaceWarm};margin:0;padding:0;color:${COLOURS.ink}">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">
    <div style="background:${COLOURS.surface};border-radius:12px;padding:28px 24px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
      <div style="text-align:left;margin-bottom:20px">
        <div style="color:${COLOURS.grey60};font-size:11px;text-transform:uppercase;letter-spacing:1px">${frequencyHeading(frequency)} · ${periodLabel}</div>
        <h1 style="color:${COLOURS.ink};margin:6px 0 0;font-size:20px;font-weight:700">${merchantName}</h1>
        <p style="color:${COLOURS.grey60};margin:8px 0 0;font-size:14px;line-height:1.4">${verdict(m)}</p>
      </div>

      ${heroRow}

      ${grid}

      ${highlightsBlock}

      ${aiBlock}

      <div style="margin-top:28px;text-align:center">
        <a href="${dashboardUrl}" style="display:inline-block;padding:11px 22px;background:${COLOURS.ink};color:${COLOURS.surface};text-decoration:none;border-radius:8px;font-weight:600;font-size:13px">View full dashboard →</a>
      </div>
    </div>

    <p style="text-align:center;color:${COLOURS.grey45};font-size:11px;margin-top:16px;line-height:1.6">
      Sent on behalf of ${merchantName}. ${args.unsubscribeNote ?? "Owners can change recipients in Settings → Analytics Digest."}
    </p>
  </div>
</body>
</html>`;

  return { subject, html };
}

/**
 * Format a period range as a compact label suited to the email subject
 * and header. Weekly: "21–27 Apr 2026". Monthly: "April 2026".
 * Yearly: "2026".
 */
export function formatPeriodLabel(args: {
  frequency: DigestFrequency;
  periodStart: Date;
  periodEnd: Date;
}): string {
  const { frequency, periodStart, periodEnd } = args;
  if (frequency === "weekly") {
    const startDay = periodStart.toLocaleDateString("en-SG", {
      day: "numeric",
      month: "short",
    });
    const endDay = periodEnd.toLocaleDateString("en-SG", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return `${startDay}–${endDay}`;
  }
  if (frequency === "monthly") {
    return periodStart.toLocaleDateString("en-SG", {
      month: "long",
      year: "numeric",
    });
  }
  return periodStart.toLocaleDateString("en-SG", { year: "numeric" });
}
