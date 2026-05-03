import PDFDocument from "pdfkit";
import type { DigestMetrics } from "./analytics-aggregator.js";
import type { DigestFrequency } from "./analytics-digest-email.js";
import type { UtilizationResult } from "./utilization.js";
import type { CohortRetentionResult } from "./cohort-retention.js";
import type { RebookLagResult } from "./rebook-lag.js";
import type { GroupContext, PerBranchMetrics } from "./analytics-digest-email.js";

/**
 * PDF version of the Analytics Digest, attached to the email send. Mirrors
 * the email's content so a recipient can save / archive / forward the
 * digest as a single document.
 *
 * Implementation: pdfkit (Node-native, no Chromium). The output isn't
 * pixel-identical to the HTML email — it's a clean structured document
 * built from the same DigestMetrics + AI prose. Trade-off taken
 * deliberately: pdfkit adds ~5MB to the deploy vs puppeteer's ~150MB
 * Chromium binary, which matters on Railway's container size budget and
 * cold-start time.
 *
 * Returns a Buffer ready to base64-encode and attach to the SendGrid
 * payload (or write to disk).
 */

interface Args {
  merchantName: string;
  frequency: DigestFrequency;
  periodLabel: string;
  metrics: DigestMetrics;
  aiProseMd?: string;
  dashboardUrl: string;
  // Currency derived from merchant.country (MY → MYR, HK → HKD,
  // everything else → SGD). Optional for backward compat — defaults
  // to SGD, matching prior hard-coded behaviour.
  currency?: "SGD" | "MYR" | "HKD";
  utilization?: UtilizationResult;
  cohortRetention?: CohortRetentionResult;
  rebookLag?: RebookLagResult;
  groupContext?: GroupContext | null;
  perBranchMetrics?: PerBranchMetrics[] | null;
}

// ─── Colours (match the email palette) ────────────────────────────────
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

// Money formatter — name kept as `fmtSgd` for diff readability, but
// it now respects the passed currency. Default SGD for legacy callsites.
function fmtSgd(n: number, currency: "SGD" | "MYR" | "HKD" = "SGD"): string {
  const sym =
    currency === "MYR" ? "RM"
    : currency === "HKD" ? "HK$"
    : "S$";
  if (n >= 100000) return `${sym}${(n / 1000).toFixed(0)}k`;
  if (n >= 10000) return `${sym}${(n / 1000).toFixed(1)}k`;
  return `${sym}${Math.round(n).toLocaleString("en-SG")}`;
}

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function deltaPct(current: number, prior: number): { text: string; positive: boolean | null } {
  // ASCII-safe arrows — pdfkit's bundled Helvetica doesn't ship with the
  // Unicode triangle glyphs (▲▼), so they render as garbled fallback
  // characters in the PDF. Plain +/- prefix conveys the same direction
  // without needing custom font embedding.
  if (prior === 0 && current === 0) return { text: "-", positive: null };
  if (prior === 0) return { text: "new", positive: true };
  const diff = ((current - prior) / prior) * 100;
  const abs = Math.abs(diff);
  if (abs < 0.5) return { text: "-", positive: null };
  const sign = diff > 0 ? "+" : "-";
  return {
    text: `${sign}${abs.toFixed(abs < 10 ? 1 : 0)}%`,
    positive: diff > 0,
  };
}

function frequencyHeading(f: DigestFrequency): string {
  if (f === "weekly") return "Weekly digest";
  if (f === "monthly") return "Monthly digest";
  return "Annual digest";
}

function fmtDateLong(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * Verdict line — same heuristic as the email template's `verdict()`.
 */
function verdict(m: DigestMetrics): string {
  const revD = deltaPct(m.revenueSgd, m.prior.revenueSgd);
  const noShowD = deltaPct(m.noShowRate, m.prior.noShowRate);
  // deltaPct returns text like "+12%" / "-5%" / "new" / "-".
  const revAbs = parseFloat(revD.text.replace(/[^\d.]/g, ""));
  if (revD.positive === true && (revD.text === "new" || revAbs >= 5)) {
    return `Solid period - revenue up ${revD.text}.`;
  }
  if (revD.positive === false && revAbs >= 5) {
    return `Revenue softened ${revD.text} vs prior period.`;
  }
  if (noShowD.positive === true && m.noShowRate > 0.08) {
    return "No-show rate climbing - review your reminder cadence.";
  }
  if (m.bookingsCount === 0) return "No bookings recorded this period.";
  return "Steady period - minor movement only.";
}

/**
 * Parse the AI prose markdown into Suggestions + Wins lists, same as
 * the email template's renderAiBlock helper. Kept narrow to defuse
 * prompt-injection (no arbitrary HTML/markdown rendering).
 */
function parseAiProse(markdown: string): { suggestions: string[]; wins: string[] } {
  const sectionMatch = (label: string): string[] => {
    const re = new RegExp(`${label}\\s*:?\\s*\\n([\\s\\S]*?)(?=\\n\\s*(?:Suggestions|Wins)\\s*:|$)`, "i");
    const m = markdown.match(re);
    if (!m) return [];
    return m[1]!
      .split(/\n+/)
      .map((line) => line.trim().replace(/^[-*•]\s+/, ""))
      .filter((line) => line.length > 0);
  };
  return {
    suggestions: sectionMatch("Suggestions"),
    wins: sectionMatch("Wins"),
  };
}

/**
 * Render the digest as a PDF Buffer. Single-page where possible —
 * pdfkit handles overflow into a second page automatically.
 */
export async function renderDigestPdf(args: Args): Promise<Buffer> {
  const { merchantName, frequency, periodLabel, metrics: m, aiProseMd, dashboardUrl } = args;
  const currency = args.currency ?? "SGD";

  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    info: {
      Title: `${frequencyHeading(frequency)} — ${merchantName} — ${periodLabel}`,
      Author: "GlowOS",
      Subject: `Analytics Digest for ${periodLabel}`,
      Keywords: "analytics digest report",
    },
    bufferPages: true,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c as Buffer));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // ─── Header strip ──────────────────────────────────────────────────
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(9)
    .font("Helvetica")
    .text(`${frequencyHeading(frequency).toUpperCase()} · ${periodLabel.toUpperCase()}`, {
      characterSpacing: 1,
    });
  doc.moveDown(0.3);
  doc
    .fillColor(COLOURS.ink)
    .fontSize(20)
    .font("Helvetica-Bold")
    .text(merchantName);
  doc.moveDown(0.3);
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(11)
    .font("Helvetica")
    .text(verdict(m));
  doc.moveDown(1);

  // ─── Hero KPIs (3 columns) ─────────────────────────────────────────
  const heroY = doc.y;
  const heroCardWidth = (doc.page.width - 100 - 16) / 3; // 50px L+R margins, 8px gap × 2
  const heroCardHeight = 70;

  const revD = deltaPct(m.revenueSgd, m.prior.revenueSgd);
  const bkD = deltaPct(m.bookingsCount, m.prior.bookingsCount);
  const nsD = deltaPct(m.noShowRate, m.prior.noShowRate);

  drawHeroCard(doc, 50, heroY, heroCardWidth, heroCardHeight, "REVENUE", fmtSgd(m.revenueSgd, currency), revD, true);
  drawHeroCard(doc, 50 + heroCardWidth + 8, heroY, heroCardWidth, heroCardHeight, "BOOKINGS", String(m.bookingsCount), bkD, true);
  drawHeroCard(doc, 50 + 2 * (heroCardWidth + 8), heroY, heroCardWidth, heroCardHeight, "NO-SHOW RATE", fmtPct(m.noShowRate), nsD, false);

  doc.y = heroY + heroCardHeight + 16;

  // Per-branch table for group-scope digests.
  if (args.groupContext && args.perBranchMetrics && args.perBranchMetrics.length > 0) {
    drawPerBranchTable(doc, args.perBranchMetrics, m, currency);
    doc.moveDown(1);
  }

  // ─── KPI grid (3 rows) ─────────────────────────────────────────────
  doc.fillColor(COLOURS.ink).fontSize(11).font("Helvetica");
  drawGridRow(
    doc,
    "First-timer return rate",
    m.firstTimerReturnRatePct === null
      ? `— (${m.firstTimerSampleSize} new)`
      : `${m.firstTimerReturnRatePct}% (${m.firstTimerSampleSize} new)`,
    m.prior.firstTimerReturnRatePct !== null && m.firstTimerReturnRatePct !== null
      ? deltaPct(m.firstTimerReturnRatePct, m.prior.firstTimerReturnRatePct)
      : null,
    true,
  );
  if (args.utilization?.headline) {
    const h = args.utilization.headline;
    const display = Math.min(100, Math.round(h.utilizationPct));
    const valueText = h.utilizationPct > 100 ? `${display}% (raw)` : `${display}%`;
    const utilDelta = h.deltaVsPriorPp === null
      ? null
      : Math.abs(h.deltaVsPriorPp) < 0.5
        ? { text: "-", positive: null as boolean | null }
        : {
            text: `${h.deltaVsPriorPp > 0 ? "+" : "-"}${Math.abs(h.deltaVsPriorPp).toFixed(1)}pp`,
            positive: h.deltaVsPriorPp > 0,
          };
    drawGridRow(doc, "Capacity utilization", valueText, utilDelta, true);
  }
  if (args.cohortRetention?.headline) {
    const h = args.cohortRetention.headline;
    const valueText = `${h.retentionPct.toFixed(1)}% (cohort: ${h.cohortSize})`;
    const cohortDelta = h.deltaVsPriorCohortPp === null
      ? null
      : Math.abs(h.deltaVsPriorCohortPp) < 0.5
        ? { text: "-", positive: null as boolean | null }
        : {
            text: `${h.deltaVsPriorCohortPp > 0 ? "+" : "-"}${Math.abs(h.deltaVsPriorCohortPp).toFixed(1)}pp`,
            positive: h.deltaVsPriorCohortPp > 0,
          };
    doc.x = PAGE_LEFT;
    drawGridRow(doc, "60d cohort retention", valueText, cohortDelta, true);
  }
  if (args.rebookLag?.headline) {
    const h = args.rebookLag.headline;
    const valueText = h.medianDays === null
      ? `— (${h.returnedCount} returners)`
      : `${h.medianDays}d median (${h.returnedCount}/${h.cohortSize})`;
    const lagDelta = h.deltaVsPriorCohortDays === null
      ? null
      : Math.abs(h.deltaVsPriorCohortDays) < 1
        ? { text: "-", positive: null as boolean | null }
        : {
            text: `${h.deltaVsPriorCohortDays > 0 ? "+" : "-"}${Math.abs(h.deltaVsPriorCohortDays)}d`,
            // `positive` is the SIGN of the delta. The `goodIfUp=false`
            // arg below tells drawGridRow that "up is bad" for rebook lag
            // (slower rebook = warn, faster rebook = sage).
            positive: h.deltaVsPriorCohortDays > 0,
          };
    doc.x = PAGE_LEFT;
    drawGridRow(doc, "Rebook lag", valueText, lagDelta, /* goodIfUp */ false);
  }
  drawGridRow(
    doc,
    "Reviews",
    m.averageRating === null
      ? `${m.reviewsCount} new`
      : `${m.averageRating.toFixed(1)}★ (${m.reviewsCount} new)`,
    m.averageRating !== null && m.prior.averageRating !== null
      ? deltaPct(m.averageRating, m.prior.averageRating)
      : null,
    true,
  );
  drawGridRow(
    doc,
    "Cancellations",
    String(m.cancelledCount),
    deltaPct(m.cancelledCount, m.prior.cancelledCount),
    false,
  );

  doc.moveDown(1);

  // ─── Highlights ────────────────────────────────────────────────────
  if (
    m.highlights.busiestDay ||
    m.highlights.quietestDay ||
    m.highlights.topServiceByRevenue
  ) {
    drawSectionLabel(doc, "HIGHLIGHTS");
    if (m.highlights.busiestDay) {
      drawBullet(
        doc,
        "•",
        `Best day: ${fmtDateLong(m.highlights.busiestDay.date)} with ${m.highlights.busiestDay.bookings} bookings`,
      );
    }
    if (m.highlights.quietestDay && m.highlights.busiestDay && m.highlights.quietestDay.date !== m.highlights.busiestDay.date) {
      drawBullet(
        doc,
        "•",
        `Quietest day: ${fmtDateLong(m.highlights.quietestDay.date)} with ${m.highlights.quietestDay.bookings} booking${m.highlights.quietestDay.bookings === 1 ? "" : "s"}`,
      );
    }
    if (m.highlights.topServiceByRevenue) {
      drawBullet(
        doc,
        "•",
        `Top service: ${m.highlights.topServiceByRevenue.name} — ${fmtSgd(m.highlights.topServiceByRevenue.revenueSgd, currency)}`,
      );
    }
    doc.moveDown(1);
  }

  // ─── AI Suggestions ────────────────────────────────────────────────
  if (aiProseMd) {
    const { suggestions, wins } = parseAiProse(aiProseMd);

    const heading = frequency === "weekly"
      ? "SUGGESTIONS FOR THE WEEK AHEAD"
      : frequency === "monthly"
        ? "STRATEGY QUESTIONS FOR THE MONTH"
        : "THEMES FOR THE YEAR AHEAD";
    drawSectionLabel(doc, heading);

    if (suggestions.length > 0) {
      drawSubheading(doc, "Suggestions", COLOURS.ink);
      for (const s of suggestions) {
        drawBullet(doc, "•", s);
      }
      doc.moveDown(0.5);
    }

    if (wins.length > 0) {
      drawSubheading(doc, "Wins to repeat", COLOURS.sage);
      for (const w of wins) {
        drawBullet(doc, "•", w);
      }
      doc.moveDown(0.5);
    }

    doc.x = PAGE_LEFT;
    doc
      .fillColor(COLOURS.grey45)
      .fontSize(8)
      .font("Helvetica-Oblique")
      .text("Generated by AI from the numbers above. Always cross-check before acting.", PAGE_LEFT, doc.y, {
        width: doc.page.width - PAGE_LEFT - PAGE_RIGHT_PAD,
      });
    doc.moveDown(1);
  }

  // ─── Footer ────────────────────────────────────────────────────────
  doc.moveDown(2);
  doc.x = PAGE_LEFT;
  doc
    .fillColor(COLOURS.sage)
    .fontSize(9)
    .font("Helvetica")
    .text(`View full dashboard: ${dashboardUrl}`, PAGE_LEFT, doc.y, {
      width: doc.page.width - PAGE_LEFT - PAGE_RIGHT_PAD,
    });
  doc.moveDown(0.5);
  doc
    .fillColor(COLOURS.grey45)
    .fontSize(8)
    .font("Helvetica")
    .text(
      `Generated by GlowOS for ${merchantName} on ${new Date().toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" })}`,
      PAGE_LEFT,
      doc.y,
      { width: doc.page.width - PAGE_LEFT - PAGE_RIGHT_PAD },
    );

  doc.end();
  return finished;
}

// ─── Drawing helpers ──────────────────────────────────────────────────

function drawHeroCard(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  value: string,
  delta: { text: string; positive: boolean | null },
  goodIfUp: boolean,
): void {
  doc.save();
  doc.roundedRect(x, y, width, height, 6).fill(COLOURS.grey5);

  doc
    .fillColor(COLOURS.grey60)
    .fontSize(8)
    .font("Helvetica")
    .text(label, x + 12, y + 10, { width: width - 24, characterSpacing: 0.5 });

  doc
    .fillColor(COLOURS.ink)
    .fontSize(18)
    .font("Helvetica-Bold")
    .text(value, x + 12, y + 24, { width: width - 24 });

  // Delta text colour: sage for "good", danger for "bad", grey for neutral
  const tone =
    delta.positive === null
      ? COLOURS.grey60
      : (delta.positive ? goodIfUp : !goodIfUp)
        ? COLOURS.sage
        : COLOURS.danger;
  doc
    .fillColor(tone)
    .fontSize(9)
    .font("Helvetica-Bold")
    .text(delta.text, x + 12, y + 50, { width: width - 24 });

  doc.restore();
}

function drawGridRow(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  delta: { text: string; positive: boolean | null } | null,
  goodIfUp: boolean,
): void {
  const startY = doc.y;
  const labelX = PAGE_LEFT;
  // Three columns from left to right: label (flexible), value (100px),
  // delta (50px). We anchor the rightmost column at the page right
  // margin and walk back so they never overlap (PR fix: was overlapping
  // by 50px and rendering as e.g. "new1" mashed together).
  const deltaWidth = 50;
  const valueWidth = 100;
  const colGap = 8;
  const deltaX = doc.page.width - PAGE_RIGHT_PAD - deltaWidth;
  const valueX = deltaX - colGap - valueWidth;

  doc
    .fillColor(COLOURS.grey60)
    .fontSize(11)
    .font("Helvetica")
    .text(label, labelX, startY, { width: valueX - labelX });

  doc
    .fillColor(COLOURS.ink)
    .fontSize(11)
    .font("Helvetica-Bold")
    .text(value, valueX, startY, { width: valueWidth, align: "right" });

  if (delta) {
    const tone =
      delta.positive === null
        ? COLOURS.grey60
        : (delta.positive ? goodIfUp : !goodIfUp)
          ? COLOURS.sage
          : COLOURS.danger;
    doc
      .fillColor(tone)
      .fontSize(9)
      .font("Helvetica-Bold")
      .text(delta.text, deltaX, startY + 1, { width: deltaWidth, align: "right" });
  }

  doc.y = startY + 18;
  doc
    .moveTo(PAGE_LEFT, doc.y)
    .lineTo(doc.page.width - PAGE_RIGHT_PAD, doc.y)
    .strokeColor(COLOURS.grey15)
    .lineWidth(0.5)
    .stroke();
  doc.y += 6;
}

// Page-flow helpers all reset doc.x to the left margin first. Without
// this, the previous helper's absolute-positioned draw (drawHeroCard,
// drawGridRow) leaves doc.x at the right edge of its last text output.
// Subsequent text() calls then receive a near-zero or negative width,
// and pdfkit responds by wrapping every character onto its own line.

const PAGE_LEFT = 50;
const PAGE_RIGHT_PAD = 50;

function drawSectionLabel(doc: PDFKit.PDFDocument, label: string): void {
  doc.x = PAGE_LEFT;
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(8)
    .font("Helvetica-Bold")
    .text(label, PAGE_LEFT, doc.y, {
      width: doc.page.width - PAGE_LEFT - PAGE_RIGHT_PAD,
      characterSpacing: 0.5,
    });
  doc.moveDown(0.3);
}

function drawBullet(doc: PDFKit.PDFDocument, marker: string, text: string): void {
  const startY = doc.y;
  const lineWidth = doc.page.width - PAGE_LEFT - PAGE_RIGHT_PAD;
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(10)
    .font("Helvetica")
    .text(marker, PAGE_LEFT, startY, { width: 10 });
  doc
    .fillColor(COLOURS.ink)
    .fontSize(10)
    .font("Helvetica")
    .text(text, PAGE_LEFT + 14, startY, {
      width: lineWidth - 14,
      lineGap: 2,
    });
  doc.x = PAGE_LEFT;
  doc.moveDown(0.2);
}

function drawSubheading(doc: PDFKit.PDFDocument, label: string, color: string): void {
  doc.x = PAGE_LEFT;
  doc
    .fillColor(color)
    .fontSize(10)
    .font("Helvetica-Bold")
    .text(label, PAGE_LEFT, doc.y, {
      width: doc.page.width - PAGE_LEFT - PAGE_RIGHT_PAD,
    });
  doc.moveDown(0.3);
}

/**
 * Compose a sensible filename for the attachment based on merchant + period.
 * Slugifies the merchant name to keep the filename portable across mail
 * clients that don't handle non-ASCII filenames well.
 */
export function digestPdfFilename(args: {
  merchantName: string;
  periodLabel: string;
}): string {
  const slug = args.merchantName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const period = args.periodLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}-digest-${period}.pdf`;
}

function drawPerBranchTable(
  doc: PDFKit.PDFDocument,
  perBranch: PerBranchMetrics[],
  groupTotal: DigestMetrics,
  currency: "SGD" | "MYR" | "HKD",
): void {
  const sorted = [...perBranch].sort((a, b) => b.metrics.revenueSgd - a.metrics.revenueSgd);
  const topRevenueId = sorted[0]?.merchantId;

  doc.x = PAGE_LEFT;
  const startY = doc.y;
  const colWidths = [200, 90, 70, 70];
  const headerHeight = 18;
  const rowHeight = 16;

  doc.fillColor(COLOURS.grey60).fontSize(9).font("Helvetica-Bold");
  doc.text("BRANCH", PAGE_LEFT, startY, { width: colWidths[0], lineBreak: false });
  doc.text("REVENUE", PAGE_LEFT + colWidths[0], startY, { width: colWidths[1], align: "right", lineBreak: false });
  doc.text("BOOKINGS", PAGE_LEFT + colWidths[0] + colWidths[1], startY, { width: colWidths[2], align: "right", lineBreak: false });
  doc.text("NO-SHOW", PAGE_LEFT + colWidths[0] + colWidths[1] + colWidths[2], startY, { width: colWidths[3], align: "right", lineBreak: false });

  doc.moveTo(PAGE_LEFT, startY + headerHeight - 4)
     .lineTo(PAGE_LEFT + colWidths.reduce((a, b) => a + b, 0), startY + headerHeight - 4)
     .strokeColor(COLOURS.grey15)
     .stroke();

  doc.font("Helvetica").fontSize(10);
  let y = startY + headerHeight;
  for (const branch of sorted) {
    const isTopRevenue = branch.merchantId === topRevenueId;
    const noShowColour = branch.metrics.noShowRate >= 0.10 ? COLOURS.warn : COLOURS.ink;
    const revenueColour = isTopRevenue ? COLOURS.sage : COLOURS.ink;

    doc.fillColor(COLOURS.ink).text(branch.merchantName, PAGE_LEFT, y, { width: colWidths[0], lineBreak: false });
    doc.fillColor(revenueColour).text(fmtSgd(branch.metrics.revenueSgd, currency), PAGE_LEFT + colWidths[0], y, { width: colWidths[1], align: "right", lineBreak: false });
    doc.fillColor(COLOURS.ink).text(String(branch.metrics.bookingsCount), PAGE_LEFT + colWidths[0] + colWidths[1], y, { width: colWidths[2], align: "right", lineBreak: false });
    doc.fillColor(noShowColour).text(fmtPct(branch.metrics.noShowRate), PAGE_LEFT + colWidths[0] + colWidths[1] + colWidths[2], y, { width: colWidths[3], align: "right", lineBreak: false });

    y += rowHeight;
  }

  doc.moveTo(PAGE_LEFT, y + 2)
     .lineTo(PAGE_LEFT + colWidths.reduce((a, b) => a + b, 0), y + 2)
     .strokeColor(COLOURS.ink)
     .lineWidth(1.5)
     .stroke();
  doc.lineWidth(1);

  y += 8;
  doc.font("Helvetica-Bold").fillColor(COLOURS.ink);
  doc.text("Group total", PAGE_LEFT, y, { width: colWidths[0], lineBreak: false });
  doc.text(fmtSgd(groupTotal.revenueSgd, currency), PAGE_LEFT + colWidths[0], y, { width: colWidths[1], align: "right", lineBreak: false });
  doc.text(String(groupTotal.bookingsCount), PAGE_LEFT + colWidths[0] + colWidths[1], y, { width: colWidths[2], align: "right", lineBreak: false });
  doc.text(fmtPct(groupTotal.noShowRate), PAGE_LEFT + colWidths[0] + colWidths[1] + colWidths[2], y, { width: colWidths[3], align: "right", lineBreak: false });

  doc.x = PAGE_LEFT;
  doc.y = y + rowHeight + 8;
  doc.font("Helvetica").fillColor(COLOURS.ink).fontSize(11);
}
