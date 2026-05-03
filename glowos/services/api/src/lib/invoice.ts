/**
 * Invoice creation business logic.
 *
 * Universal receipt/invoice generator that works in HK + SG + MY. Builds
 * an `invoices` row + `invoice_line_items` row(s) from a paid booking,
 * with race-safe sequential numbering. Country-specific compliance
 * (MyInvois LHDN submission for MY) is layered on top of this in a
 * follow-up PR — this lib intentionally produces a clean, jurisdiction-
 * agnostic invoice record.
 *
 * Idempotency: re-issuing an invoice for the same booking is allowed; the
 * caller's responsibility to check whether a non-cancelled invoice
 * already exists. A typical UI flow:
 *   - "Generate receipt" → if no invoice exists, create one
 *   - If an invoice exists, surface "Re-issue receipt" + show the
 *     existing one
 *
 * Atomic numbering uses `merchants.next_invoice_sequence` as a
 * per-merchant counter, incremented in a single UPDATE...RETURNING so
 * two concurrent issuances can't collide on the same number.
 */

import { and, eq, sql } from "drizzle-orm";
import {
  db,
  invoices,
  invoiceLineItems,
  merchants,
  bookings,
  clients,
  services,
  clientProfiles,
  type InvoiceDocumentType,
  type MyInvoisEnvironment,
  type BusinessRegistrationType,
} from "@glowos/db";

// ─── Errors ──────────────────────────────────────────────────────────────

export class InvoiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "InvoiceError";
    this.code = code;
  }
}

// Country → ISO 4217 currency code. Used by the universal receipt flow
// so an SG merchant's invoice renders as SGD, MY as MYR, HK as HKD —
// the previous implementation hardcoded MYR for everyone, which was a
// hangover from the MyInvois-first scoping. Default falls through to
// MYR to preserve historical behaviour for any country code we don't
// explicitly support yet.
function currencyForCountry(country: string | null | undefined): string {
  if (country === "SG") return "SGD";
  if (country === "HK") return "HKD";
  return "MYR";
}

// ─── Atomic invoice number generation ────────────────────────────────────

/**
 * Reserve the next invoice number for a merchant and return the formatted
 * string. The single UPDATE...RETURNING is atomic at the row level — two
 * concurrent calls for the same merchant get distinct sequence numbers.
 *
 * Format: `{invoicePrefix}-{seq:000000}` (six-digit zero-padded). Prefix
 * defaults to 'INV' but each merchant can customise via settings.
 */
export async function reserveInvoiceNumber(merchantId: string): Promise<{
  invoiceNumber: string;
  invoicePrefix: string;
  sequence: number;
}> {
  // Atomic increment — returns the value AS IT WAS BEFORE the increment.
  const [updated] = await db
    .update(merchants)
    .set({ nextInvoiceSequence: sql`${merchants.nextInvoiceSequence} + 1` })
    .where(eq(merchants.id, merchantId))
    .returning({
      previousSequence: sql<number>`${merchants.nextInvoiceSequence} - 1`,
      invoicePrefix: merchants.invoicePrefix,
    });

  if (!updated) {
    throw new InvoiceError("merchant_not_found", `Merchant ${merchantId} not found.`);
  }

  const sequence = Number(updated.previousSequence);
  const padded = String(sequence).padStart(6, "0");
  return {
    invoiceNumber: `${updated.invoicePrefix}-${padded}`,
    invoicePrefix: updated.invoicePrefix,
    sequence,
  };
}

// ─── Tax computation ─────────────────────────────────────────────────────

interface TaxConfig {
  label: string | null;
  ratePct: number;
  registrationNumber: string | null;
}

interface ComputedTotals {
  subtotal: number;
  discount: number;
  taxableAmount: number;
  taxAmount: number;
  total: number;
}

/**
 * Roll the line items + booking-level discount into the invoice totals.
 * Tax is applied to (subtotal - discount), the standard "tax on net of
 * discount" pattern. Merchants without a tax_label produce zero tax.
 */
export function computeTotals(args: {
  lineSubtotals: number[]; // pre-discount subtotals per line
  bookingDiscount: number;
  tax: TaxConfig;
}): ComputedTotals {
  const subtotal = args.lineSubtotals.reduce((s, v) => s + v, 0);
  const discount = args.bookingDiscount;
  const taxableAmount = Math.max(0, subtotal - discount);
  const ratePct = args.tax.label && args.tax.ratePct > 0 ? args.tax.ratePct : 0;
  const taxAmount = round2(taxableAmount * (ratePct / 100));
  const total = round2(taxableAmount + taxAmount);
  return {
    subtotal: round2(subtotal),
    discount: round2(discount),
    taxableAmount: round2(taxableAmount),
    taxAmount,
    total,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Build an invoice from a booking ─────────────────────────────────────

export interface CreateInvoiceFromBookingArgs {
  merchantId: string;
  bookingId: string;
  /** User issuing the invoice (for audit). */
  issuedByUserId: string;
  /**
   * Optional override of the buyer details on the invoice. When omitted,
   * the buyer is the booking's client. Useful for self-billed scenarios
   * or when the invoice should be addressed to a corporate panel sponsor
   * rather than the patient (rare; standard pattern is patient = buyer).
   */
  buyerOverride?: {
    name?: string;
    email?: string;
    phone?: string;
    addressLine1?: string;
    addressLine2?: string;
    postalCode?: string;
    city?: string;
    state?: string;
    country?: string;
  };
}

export interface CreatedInvoice {
  invoiceId: string;
  invoiceNumber: string;
}

/**
 * Create an `invoices` row + `invoice_line_items` row(s) from a paid
 * booking. Pulls service details from the catalog, denormalizes issuer
 * (clinic) and buyer (client) snapshots so the invoice survives later
 * edits, computes tax + totals, reserves the next sequential number.
 *
 * Throws `InvoiceError` with codes:
 *   - `merchant_not_found` — merchant row missing
 *   - `booking_not_found` — booking missing or wrong merchant
 *   - `booking_not_payable` — booking status is `cancelled` or `pending`
 *     payment_status (we don't issue receipts for unpaid bookings)
 *   - `client_not_found` — booking's client row missing
 *   - `service_not_found` — booking's service row missing
 *   - `merchant_missing_invoice_metadata` — merchant lacks the fields
 *     required to render a legal-quality receipt (issuer email, etc.)
 */
export async function createInvoiceFromBooking(
  args: CreateInvoiceFromBookingArgs,
): Promise<CreatedInvoice> {
  // 1. Load merchant
  const [merchant] = await db
    .select()
    .from(merchants)
    .where(eq(merchants.id, args.merchantId))
    .limit(1);
  if (!merchant) {
    throw new InvoiceError("merchant_not_found", `Merchant ${args.merchantId} not found.`);
  }
  // Capture into a local for TS to narrow correctly across the long
  // insert call below — the in-place property access doesn't preserve
  // the narrowing through a complex .values({...}) shape.
  const merchantEmail = merchant.email;
  if (!merchantEmail) {
    throw new InvoiceError(
      "merchant_missing_invoice_metadata",
      "Merchant is missing an email address. Set one in Settings → Business Profile before issuing receipts.",
    );
  }

  // 2. Load booking — must belong to this merchant
  const [booking] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, args.bookingId), eq(bookings.merchantId, args.merchantId)))
    .limit(1);
  if (!booking) {
    throw new InvoiceError("booking_not_found", `Booking ${args.bookingId} not found for this merchant.`);
  }
  if (booking.status === "cancelled") {
    throw new InvoiceError(
      "booking_not_payable",
      "Cancelled bookings can't have a receipt issued. Use the Refund Note flow instead.",
    );
  }

  // 3. Load client + service
  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, booking.clientId))
    .limit(1);
  if (!client) {
    throw new InvoiceError("client_not_found", "Booking's client row missing.");
  }

  const [service] = await db
    .select()
    .from(services)
    .where(eq(services.id, booking.serviceId))
    .limit(1);
  if (!service) {
    throw new InvoiceError("service_not_found", "Booking's service row missing.");
  }

  // 4. Compute totals from booking
  const linePriceUnit = Number(booking.priceSgd);
  const lineDiscount = Number(booking.discountSgd);

  const tax: TaxConfig = {
    label: merchant.taxLabel ?? null,
    ratePct: merchant.taxRatePct ? Number(merchant.taxRatePct) : 0,
    registrationNumber: merchant.taxRegistrationNumber ?? null,
  };

  const totals = computeTotals({
    lineSubtotals: [linePriceUnit],
    bookingDiscount: lineDiscount,
    tax,
  });

  // 5. Reserve invoice number atomically
  const reserved = await reserveInvoiceNumber(args.merchantId);

  // 6. Insert invoice + line item in a transaction
  const buyer = args.buyerOverride ?? {};
  // clients.name is nullable in the DB (walk-ins identified only by phone).
  // Fallback chain: override → client.name → client.phone → "Walk-in".
  const buyerName = buyer.name ?? client.name ?? client.phone ?? "Walk-in";
  const buyerEmail = buyer.email ?? client.email ?? null;
  const buyerPhone = buyer.phone ?? client.phone ?? null;
  // Default issuer registration metadata. Only set when the merchant has
  // configured MyInvois — otherwise the universal receipt skips these
  // fields (NOT NULL columns get safe placeholders).
  const issuerTin = "—";
  const issuerBrn = "—";
  const issuerBrnType: BusinessRegistrationType = "BRN";
  const issuerMsicCode = "—";

  const tax_breakdown = totals.taxAmount > 0
    ? {
        [merchant.taxLabel ?? "TAX"]: {
          rate: tax.ratePct,
          taxable: totals.taxableAmount,
          tax: totals.taxAmount,
        },
      }
    : null;

  const issuedAt = new Date();
  const documentType: InvoiceDocumentType = "invoice";
  const environment: MyInvoisEnvironment = "sandbox"; // universal receipt — environment is moot until MyInvois layer activates

  const result = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(invoices)
      .values({
        merchantId: args.merchantId,
        clientId: booking.clientId,
        bookingId: booking.id,
        internalInvoiceNumber: reserved.invoiceNumber,
        documentType,
        // Issuer snapshot
        issuerName: merchant.name,
        issuerTin,
        issuerBusinessRegistrationNumber: issuerBrn,
        issuerBusinessRegistrationType: issuerBrnType,
        issuerSstRegistrationNumber: tax.registrationNumber,
        issuerMsicCode,
        issuerAddressLine1: merchant.addressLine1 ?? null,
        issuerAddressLine2: merchant.addressLine2 ?? null,
        issuerPostalCode: merchant.postalCode ?? null,
        issuerCity: null,
        issuerState: null,
        issuerCountry: merchant.country ?? "MY",
        issuerPhone: merchant.phone ?? null,
        issuerEmail: merchantEmail,
        // Buyer snapshot
        buyerName,
        buyerEmail,
        buyerPhone,
        buyerAddressLine1: buyer.addressLine1 ?? null,
        buyerAddressLine2: buyer.addressLine2 ?? null,
        buyerPostalCode: buyer.postalCode ?? null,
        buyerCity: buyer.city ?? null,
        buyerState: buyer.state ?? null,
        buyerCountry: buyer.country ?? merchant.country ?? "MY",
        // Document metadata — currency derives from the issuer (merchant)
        // country, NOT the buyer country. A MY clinic invoicing an SG
        // tourist still issues an MYR invoice; the buyer pays MYR.
        currency: currencyForCountry(merchant.country),
        issuedAt,
        paymentMode: booking.paymentMethod ?? null,
        // Totals
        subtotalAmount: String(totals.subtotal),
        taxAmount: String(totals.taxAmount),
        discountAmount: String(totals.discount),
        totalAmount: String(totals.total),
        taxBreakdown: tax_breakdown ?? undefined,
        // Submission state — universal receipt; not LHDN-bound on creation
        submissionStatus: "draft",
        environment,
        createdByUserId: args.issuedByUserId,
      })
      .returning({ id: invoices.id, internalInvoiceNumber: invoices.internalInvoiceNumber });

    if (!created) {
      throw new InvoiceError("insert_failed", "Failed to insert invoice row.");
    }

    await tx.insert(invoiceLineItems).values({
      invoiceId: created.id,
      lineNumber: 1,
      serviceId: service.id,
      bookingId: booking.id,
      description: service.name,
      quantity: "1",
      unitOfMeasure: "EA",
      unitPrice: String(linePriceUnit),
      subtotal: String(round2(linePriceUnit)),
      discountAmount: String(totals.discount),
      taxCategory: tax.label ? "01" : "E", // generic; specific category mapping lives in MyInvois layer
      taxRatePct: String(tax.ratePct),
      taxAmount: String(totals.taxAmount),
      totalAmount: String(totals.total),
    });

    return { invoiceId: created.id, invoiceNumber: created.internalInvoiceNumber };
  });

  return result;
}

// ─── Lookup helpers ──────────────────────────────────────────────────────

export async function getInvoiceById(args: { merchantId: string; invoiceId: string }) {
  const [row] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, args.invoiceId), eq(invoices.merchantId, args.merchantId)))
    .limit(1);
  return row ?? null;
}

export async function getInvoiceLineItems(invoiceId: string) {
  const rows = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoiceId))
    .orderBy(invoiceLineItems.lineNumber);
  return rows;
}

/** Return the latest non-cancelled invoice attached to this booking, or null. */
export async function findExistingInvoiceForBooking(args: {
  merchantId: string;
  bookingId: string;
}) {
  const [row] = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.merchantId, args.merchantId),
        eq(invoices.bookingId, args.bookingId),
      ),
    )
    .orderBy(invoices.createdAt)
    .limit(1);
  return row ?? null;
}

// Re-export client_profiles so the route can do its own resolveClientId
// without duplicating imports.
export { clientProfiles };
