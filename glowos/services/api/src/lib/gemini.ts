import { GoogleGenerativeAI } from "@google/generative-ai";
import crypto from "node:crypto";
import { config } from "./config.js";
import type { DigestMetrics } from "./analytics-aggregator.js";
import type { DigestFrequency } from "./analytics-digest-email.js";

/**
 * Gemini integration for the Analytics Digest email.
 *
 * Numbers stay in the deterministic email template (no LLM hallucination
 * on KPIs). The model only generates a short prose block — 2-3 actionable
 * suggestions + 1-2 wins to repeat — that gets rendered between the
 * highlights and the dashboard CTA.
 *
 * Free tier (Gemini 1.5 Flash):
 *   - 1500 requests / day
 *   - 15 requests / minute
 *   - 1M-token context
 * Pilot scale (~50 merchants × weekly cadence) sits well under any limit.
 *
 * Failure modes degrade gracefully — every caller treats `null` as "no
 * AI prose this round" and falls back to numeric-only.
 */

const PROMPT_VERSION = "digest-prose-v1";
// Google has rolled the default lineage twice in 2026: `gemini-1.5-flash`
// was removed from v1beta first, then `gemini-2.0-flash` became "no longer
// available to new users" for projects enabled later in the year (404 on
// generateContent for those projects). `gemini-2.5-flash` is the current
// stable id available to all billed projects.
const MODEL_NAME = "gemini-2.5-flash";
const REQUEST_TIMEOUT_MS = 30_000;

// Lazy singleton — constructed on first call so the SDK doesn't sit in
// memory when the API key isn't configured.
let _client: GoogleGenerativeAI | null = null;
function getClient(): GoogleGenerativeAI | null {
  if (!config.geminiApiKey) return null;
  if (!_client) _client = new GoogleGenerativeAI(config.geminiApiKey);
  return _client;
}

export interface DigestAiResult {
  /** Plain markdown — bullet lists under "Suggestions:" / "Wins:" headings. */
  aiOutputMd: string;
  /** sha256 of the input — used by callers to dedupe identical reruns. */
  inputHash: string;
  /** "gemini-2.5-flash" today; future model upgrades land under new ids. */
  provider: string;
  /** Bumped whenever the prompt template changes. Lets future migrations
   *  invalidate stale cached output if the prompt evolves. */
  promptVersion: string;
}

/**
 * Returns null in any failure case (missing API key, timeout, model error,
 * output validation failure). Callers MUST treat null as "send the
 * numeric-only email and move on" — never fail a digest because of AI.
 */
export async function generateDigestSuggestions(args: {
  merchantName: string;
  merchantCategory: string | null;
  frequency: DigestFrequency;
  periodLabel: string;
  metrics: DigestMetrics;
}): Promise<DigestAiResult | null> {
  const client = getClient();
  if (!client) {
    console.log("[gemini] GEMINI_API_KEY not set — skipping AI prose");
    return null;
  }

  const inputHash = hashInput(args);
  const prompt = buildPrompt(args);

  try {
    const model = client.getGenerativeModel({ model: MODEL_NAME });
    const result = await withTimeout(
      model.generateContent(prompt),
      REQUEST_TIMEOUT_MS,
      `Gemini request timed out after ${REQUEST_TIMEOUT_MS}ms`,
    );

    const raw = result.response.text().trim();
    const validated = validateOutput(raw);
    if (!validated) {
      console.warn(
        "[gemini] output rejected by guardrails — falling back to numeric-only",
        { merchant: args.merchantName, period: args.periodLabel },
      );
      return null;
    }

    return {
      aiOutputMd: validated,
      inputHash,
      provider: MODEL_NAME,
      promptVersion: PROMPT_VERSION,
    };
  } catch (err) {
    console.error("[gemini] generation failed — falling back to numeric-only", {
      error: err instanceof Error ? err.message : String(err),
      merchant: args.merchantName,
    });
    return null;
  }
}

// ─── Hashing for cache lookup ─────────────────────────────────────────

/**
 * Hash includes everything that could change the model's output: the
 * prompt-affecting metrics, the frequency, the period, and the prompt
 * version itself. Two runs with the same hash produce equivalent prose,
 * so callers can reuse cached output.
 */
function hashInput(args: {
  merchantName: string;
  frequency: DigestFrequency;
  periodLabel: string;
  metrics: DigestMetrics;
}): string {
  const m = args.metrics;
  // Stable JSON serialization — pin specific fields rather than
  // JSON.stringify-ing the whole object so future metric additions don't
  // silently invalidate every cached entry.
  const stable = JSON.stringify([
    PROMPT_VERSION,
    args.merchantName,
    args.frequency,
    args.periodLabel,
    m.revenueSgd, m.bookingsCount,
    m.noShowRate, m.noShowsCount, m.cancelledCount,
    m.firstTimerReturnRatePct, m.firstTimerSampleSize,
    m.reviewsCount, m.averageRating,
    m.prior.revenueSgd, m.prior.bookingsCount,
    m.prior.noShowRate, m.prior.firstTimerReturnRatePct,
    m.prior.reviewsCount, m.prior.averageRating,
    m.highlights.busiestDay?.date ?? null, m.highlights.busiestDay?.bookings ?? null,
    m.highlights.quietestDay?.date ?? null, m.highlights.quietestDay?.bookings ?? null,
    m.highlights.topServiceByRevenue?.name ?? null,
    m.highlights.topServiceByRevenue?.revenueSgd ?? null,
  ]);
  return crypto.createHash("sha256").update(stable).digest("hex");
}

// ─── Prompt construction ──────────────────────────────────────────────

function buildPrompt(args: {
  merchantName: string;
  merchantCategory: string | null;
  frequency: DigestFrequency;
  periodLabel: string;
  metrics: DigestMetrics;
}): string {
  const m = args.metrics;
  const cat = args.merchantCategory ?? "appointment-based service";
  const horizon = args.frequency === "weekly"
    ? "tactical, this-week levers"
    : args.frequency === "monthly"
      ? "strategic, structural questions"
      : "year-in-review themes";

  // Format helpers — keep numbers concise so the prompt stays small.
  const fmt = (n: number) => Math.round(n).toLocaleString("en-SG");
  const fmtMoney = (n: number) => `S$${fmt(n)}`;
  const fmtPct = (rate: number) => `${(rate * 100).toFixed(1)}%`;
  const delta = (cur: number, prior: number) => {
    if (prior === 0) return cur > 0 ? "(new)" : "(flat)";
    const d = ((cur - prior) / prior) * 100;
    return `(${d >= 0 ? "+" : ""}${d.toFixed(1)}% vs prior)`;
  };

  return `You are an operations analyst writing a ${args.frequency} digest for a ${cat} business in Singapore/Malaysia. Output ${horizon}.

CONSTRAINTS — these are absolute, do not violate:
- Never recommend specific price changes, discount depths, or new pricing tiers.
- Never recommend hiring, firing, demotions, or schedule cuts for specific staff.
- Never make medical, clinical, or efficacy claims (regulatory risk in SG/MY).
- Skip any suggestion that depends on a KPI with sample size < 30 bookings or < 10 reviews.
- Reference specific days, services, or staff only if named in the data below.
- Plain ASCII markdown only. No headers (#), no horizontal rules. Use only the structure shown in the OUTPUT FORMAT.
- Total length: 80-150 words. No preamble, no closing line.

INPUT:
- Business: ${args.merchantName}
- Period: ${args.periodLabel} (${args.frequency})
- Revenue: ${fmtMoney(m.revenueSgd)} ${delta(m.revenueSgd, m.prior.revenueSgd)}
- Bookings: ${m.bookingsCount} ${delta(m.bookingsCount, m.prior.bookingsCount)}
- No-show rate: ${fmtPct(m.noShowRate)} (${m.noShowsCount} no-shows)
- Cancellations: ${m.cancelledCount}
- First-timer return rate: ${m.firstTimerReturnRatePct === null ? "n/a (sample too small)" : `${m.firstTimerReturnRatePct}%`} (cohort: ${m.firstTimerSampleSize})
- Reviews this period: ${m.reviewsCount} ${m.averageRating === null ? "" : `(avg ${m.averageRating.toFixed(1)}★)`}
- Busiest day: ${m.highlights.busiestDay ? `${m.highlights.busiestDay.date} (${m.highlights.busiestDay.bookings} bookings)` : "n/a"}
- Quietest day: ${m.highlights.quietestDay ? `${m.highlights.quietestDay.date} (${m.highlights.quietestDay.bookings} bookings)` : "n/a"}
- Top service by revenue: ${m.highlights.topServiceByRevenue ? `${m.highlights.topServiceByRevenue.name} (${fmtMoney(m.highlights.topServiceByRevenue.revenueSgd)})` : "n/a"}

OUTPUT FORMAT (exactly):
Suggestions:
- <one specific, actionable suggestion. Name a day, service, or cohort if you can.>
- <a second one>
- <optional third>

Wins:
- <one thing that worked, named>
- <optional second>`;
}

// ─── Output validation ────────────────────────────────────────────────

/**
 * Returns the cleaned output string if it passes all guardrails, else
 * null. This is belt-and-braces over the prompt's CONSTRAINTS — the
 * model occasionally violates them despite instructions.
 */
function validateOutput(raw: string): string | null {
  // Empty / suspiciously short
  if (raw.length < 30 || raw.length > 2000) return null;

  // Must have the expected structure
  if (!/Suggestions:/i.test(raw) || !/Wins:/i.test(raw)) return null;

  // Forbidden patterns. These regexes lean strict to err on the side of
  // dropping AI output rather than letting a violation through.
  //
  // No bare-currency regex here. The prompt feeds revenue figures to the
  // model (`Revenue: S$5,873`, `Top service: ... (S$3,880)`), and the
  // model legitimately echoes them in Suggestions / Wins. A `(S\$|RM)\d`
  // regex catches those data echoes and drops the whole AI section every
  // time. The prompt's CONSTRAINT block already forbids price changes;
  // `raise-price` + `discount-depth` cover the verb-form violations that
  // matter (raise/cut/drop/X% off). Pure new-price introductions slipping
  // through is acceptable at pilot stage — Frank sees every digest and
  // can iterate the prompt if it surfaces.
  const forbidden: Array<{ name: string; re: RegExp }> = [
    { name: "raise-price", re: /\b(?:raise|increase|cut|drop|lower)\s+(?:the\s+)?price/i },
    { name: "discount-depth", re: /\b\d{1,2}\s?%\s+(?:off|discount)/i }, // "20% off", "15 % discount"
    { name: "fire-staff", re: /\b(?:fire|let\s+go|terminate|sack|dismiss)\b/i },
    { name: "hire-staff", re: /\b(?:hire|recruit)\s+(?:more\s+)?(?:staff|therapist|clinician|stylist|technician)\b/i },
    { name: "schedule-cut", re: /\b(?:cut|reduce)\s+(?:hours|shifts|schedule)/i },
    { name: "medical-claim", re: /\b(?:cures?|treats?|heals?|prevents?)\s+\w/i },
    { name: "efficacy-claim", re: /\b(?:effective|guaranteed|proven)\s+(?:for|against|in)\b/i },
  ];

  for (const { name, re } of forbidden) {
    if (re.test(raw)) {
      console.warn(`[gemini] guardrail tripped: ${name}`, { snippet: raw.slice(0, 200) });
      return null;
    }
  }

  return raw;
}

// ─── Timeout helper ───────────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
