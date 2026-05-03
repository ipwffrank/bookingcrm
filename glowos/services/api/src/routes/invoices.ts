/**
 * Invoice routes — slice 1 (universal receipt generator).
 *
 * Endpoints:
 *   POST /merchant/invoices/from-booking/:bookingId
 *        → create an invoice from a paid booking. Idempotency at the
 *          caller's discretion: re-issuing creates a fresh invoice with
 *          a new sequential number; the UI is expected to show the
 *          existing one and offer "Re-issue" only when needed.
 *
 *   GET  /merchant/invoices/:invoiceId
 *        → fetch invoice metadata (issuer, buyer, totals, line items)
 *
 *   GET  /merchant/invoices/:invoiceId/pdf
 *        → download the receipt as a PDF (application/pdf)
 *
 *   GET  /merchant/clients/:profileId/invoices  (mounted separately)
 *        → list invoices for a client — implemented in slice 2
 *
 * Auto-fire on booking payment completion + WhatsApp/email delivery
 * are slice 2.
 */

import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  invoices,
  merchants,
} from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import {
  createInvoiceFromBooking,
  getInvoiceById,
  getInvoiceLineItems,
  findExistingInvoiceForBooking,
  InvoiceError,
} from "../lib/invoice.js";
import { renderInvoicePdf, invoicePdfFilename } from "../lib/invoice-pdf.js";
import type { AppVariables } from "../lib/types.js";

const invoicesRouter = new Hono<{ Variables: AppVariables }>();
invoicesRouter.use("*", requireMerchant);

// Owner + manager + clinician only. Receipts are operational, not
// patient-clinical, so we don't require the clinician-or-owner gate
// the clinical-records router uses — managers can issue receipts too.
invoicesRouter.use("*", async (c, next) => {
  const role = c.get("userRole");
  if (role !== "owner" && role !== "manager" && role !== "clinician") {
    return c.json(
      {
        error: "Forbidden",
        message: "Issuing receipts requires owner, manager, or clinician role.",
      },
      403,
    );
  }
  await next();
});

// ─── POST /merchant/invoices/from-booking/:bookingId ─────────────────────

invoicesRouter.post("/from-booking/:bookingId", async (c) => {
  const merchantId = c.get("merchantId")!;
  const userId = c.get("userId")!;
  const bookingId = c.req.param("bookingId")!;

  // Idempotency hint: surface existing invoice so the UI can display it
  // rather than blindly issuing a duplicate.
  const existing = await findExistingInvoiceForBooking({ merchantId, bookingId });
  if (existing) {
    return c.json(
      {
        already_issued: true,
        invoice_id: existing.id,
        invoice_number: existing.internalInvoiceNumber,
        issued_at: existing.issuedAt,
      },
      200,
    );
  }

  try {
    const { invoiceId, invoiceNumber } = await createInvoiceFromBooking({
      merchantId,
      bookingId,
      issuedByUserId: userId,
    });
    return c.json({ invoice_id: invoiceId, invoice_number: invoiceNumber }, 201);
  } catch (err) {
    if (err instanceof InvoiceError) {
      const status = err.code === "merchant_not_found" || err.code === "booking_not_found"
        ? 404
        : err.code === "booking_not_payable"
          ? 409
          : 400;
      return c.json({ error: err.code, message: err.message }, status);
    }
    throw err;
  }
});

// ─── GET /merchant/invoices/:invoiceId ───────────────────────────────────

invoicesRouter.get("/:invoiceId", async (c) => {
  const merchantId = c.get("merchantId")!;
  const invoiceId = c.req.param("invoiceId")!;

  const inv = await getInvoiceById({ merchantId, invoiceId });
  if (!inv) {
    return c.json({ error: "Not Found", message: "Invoice not found." }, 404);
  }
  const items = await getInvoiceLineItems(invoiceId);
  return c.json({
    invoice: {
      id: inv.id,
      invoice_number: inv.internalInvoiceNumber,
      booking_id: inv.bookingId,
      client_id: inv.clientId,
      document_type: inv.documentType,
      submission_status: inv.submissionStatus,
      issued_at: inv.issuedAt,
      currency: inv.currency,
      issuer: {
        name: inv.issuerName,
        email: inv.issuerEmail,
        phone: inv.issuerPhone,
        address_line1: inv.issuerAddressLine1,
        address_line2: inv.issuerAddressLine2,
        postal_code: inv.issuerPostalCode,
        country: inv.issuerCountry,
        tax_registration_number: inv.issuerSstRegistrationNumber,
      },
      buyer: {
        name: inv.buyerName,
        email: inv.buyerEmail,
        phone: inv.buyerPhone,
        address_line1: inv.buyerAddressLine1,
        address_line2: inv.buyerAddressLine2,
        postal_code: inv.buyerPostalCode,
        country: inv.buyerCountry,
      },
      totals: {
        subtotal: inv.subtotalAmount,
        discount: inv.discountAmount,
        tax: inv.taxAmount,
        total: inv.totalAmount,
        tax_breakdown: inv.taxBreakdown,
      },
      payment_mode: inv.paymentMode,
      line_items: items.map((it) => ({
        line_number: it.lineNumber,
        description: it.description,
        quantity: it.quantity,
        unit_of_measure: it.unitOfMeasure,
        unit_price: it.unitPrice,
        subtotal: it.subtotal,
        discount: it.discountAmount,
        tax_category: it.taxCategory,
        tax_rate_pct: it.taxRatePct,
        tax_amount: it.taxAmount,
        total: it.totalAmount,
      })),
    },
  });
});

// ─── GET /merchant/invoices/:invoiceId/pdf ──────────────────────────────

invoicesRouter.get("/:invoiceId/pdf", async (c) => {
  const merchantId = c.get("merchantId")!;
  const invoiceId = c.req.param("invoiceId")!;

  const inv = await getInvoiceById({ merchantId, invoiceId });
  if (!inv) {
    return c.json({ error: "Not Found", message: "Invoice not found." }, 404);
  }
  const items = await getInvoiceLineItems(invoiceId);

  // Pull merchant's customizable footer text.
  const [merchant] = await db
    .select({ invoiceFooterText: merchants.invoiceFooterText })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  const pdf = await renderInvoicePdf({
    invoice: inv,
    lineItems: items,
    footerText: merchant?.invoiceFooterText ?? null,
    documentTitle: "RECEIPT",
  });

  // Hono's c.body() doesn't take Buffer cleanly across runtimes; building
  // a Response with the underlying ArrayBuffer view is the portable path.
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoicePdfFilename(inv)}"`,
    },
  });
});

// ─── GET /merchant/invoices  (list, latest first; basic pagination) ─────

invoicesRouter.get("/", async (c) => {
  const merchantId = c.get("merchantId")!;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);

  const rows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.internalInvoiceNumber,
      bookingId: invoices.bookingId,
      clientId: invoices.clientId,
      buyerName: invoices.buyerName,
      issuedAt: invoices.issuedAt,
      totalAmount: invoices.totalAmount,
      currency: invoices.currency,
      submissionStatus: invoices.submissionStatus,
    })
    .from(invoices)
    .where(eq(invoices.merchantId, merchantId))
    .orderBy(desc(invoices.issuedAt))
    .limit(limit);

  return c.json({ invoices: rows });
});

export { invoicesRouter };
