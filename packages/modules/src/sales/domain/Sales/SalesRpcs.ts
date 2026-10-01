/**
 * The sales contract the console uses: the price list, and quotes from request to customer.
 *
 * Every transition is its own procedure with its own typed refusals, so the console can tell "someone else already
 * approved this" (`QuoteNotInState`) from "this quote has no address to send to" (`QuoteHasNoRecipient`) from "the
 * mail provider refused" (`EmailNotSent`) — three situations with three different things for a person to do.
 */
import { AuthenticatedRpc } from "@ea/domain/Identity"
import { EmailNotSent } from "@ea/modules/shared/domain/Errors"
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { ProposalRun, ProposedChange } from "../Change/Change.ts"
import { ChangeIsStale } from "../Errors/ChangeIsStale.ts"
import { ChangeNotFound } from "../Errors/ChangeNotFound.ts"
import { ChangeNotPending } from "../Errors/ChangeNotPending.ts"
import { InvalidProduct } from "../Errors/InvalidProduct.ts"
import { InvoiceAlreadyPaid } from "../Errors/InvoiceAlreadyPaid.ts"
import { InvoiceNotFound } from "../Errors/InvoiceNotFound.ts"
import { JobNotFound } from "../Errors/JobNotFound.ts"
import { JobNotInState } from "../Errors/JobNotInState.ts"
import { QuoteHasNoRecipient } from "../Errors/QuoteHasNoRecipient.ts"
import { QuoteNotFound } from "../Errors/QuoteNotFound.ts"
import { QuoteNotInState } from "../Errors/QuoteNotInState.ts"
import { Product, Unit } from "../Product/Product.ts"
import { Quote, QuoteStatus } from "../Quote/Quote.ts"
import { Invoice, Job } from "../Work/Work.ts"

const QuoteRef = { quoteId: Schema.String }

export const SalesRpcs = RpcGroup.make(
  Rpc.make("Sales.products", {
    payload: { includeInactive: Schema.optional(Schema.Boolean) },
    success: Schema.Array(Product)
  }),
  Rpc.make("Sales.upsertProduct", {
    payload: {
      sku: Schema.String,
      name: Schema.String,
      unit: Unit,
      /** Cents, excluding VAT. */
      unitPrice: Schema.Int,
      /** Per mille: 0, 90 or 210. */
      vat: Schema.Int,
      active: Schema.Boolean
    },
    success: Product,
    error: InvalidProduct
  }),
  Rpc.make("Sales.quotes", {
    payload: { status: Schema.optional(QuoteStatus) },
    success: Schema.Array(Quote)
  }),
  /** Reads a customer's request and drafts a priced quote for a person to check. Never sends anything. */
  Rpc.make("Sales.draftQuote", {
    payload: { request: Schema.String },
    success: Quote
  }),
  Rpc.make("Sales.approveQuote", {
    payload: QuoteRef,
    success: Quote,
    error: Schema.Union([QuoteNotFound, QuoteNotInState])
  }),
  Rpc.make("Sales.discardQuote", {
    payload: QuoteRef,
    success: Quote,
    error: Schema.Union([QuoteNotFound, QuoteNotInState])
  }),
  Rpc.make("Sales.sendQuote", {
    payload: QuoteRef,
    success: Quote,
    error: Schema.Union([QuoteNotFound, QuoteNotInState, QuoteHasNoRecipient, EmailNotSent])
  }),
  /** Turns an instruction into PROPOSED price-list changes. Writes proposals only; never a product. */
  Rpc.make("Sales.proposeChanges", {
    payload: { instruction: Schema.String },
    success: ProposalRun
  }),
  Rpc.make("Sales.changes", {
    payload: {},
    success: Schema.Array(ProposedChange)
  }),
  Rpc.make("Sales.applyChange", {
    payload: { changeId: Schema.String },
    success: ProposedChange,
    error: Schema.Union([ChangeNotFound, ChangeNotPending, ChangeIsStale])
  }),
  Rpc.make("Sales.rejectChange", {
    payload: { changeId: Schema.String },
    success: ProposedChange,
    error: Schema.Union([ChangeNotFound, ChangeNotPending])
  }),
  /** The customer's answer to a sent quote, recorded by a person. Accepting creates the job. */
  Rpc.make("Sales.respondToQuote", {
    payload: { quoteId: Schema.String, accepted: Schema.Boolean },
    success: Quote,
    error: Schema.Union([QuoteNotFound, QuoteNotInState])
  }),
  Rpc.make("Sales.jobs", { payload: {}, success: Schema.Array(Job) }),
  Rpc.make("Sales.completeJob", {
    payload: { jobId: Schema.String },
    success: Job,
    error: Schema.Union([JobNotFound, JobNotInState])
  }),
  Rpc.make("Sales.invoiceJob", {
    payload: { jobId: Schema.String },
    success: Job,
    error: Schema.Union([JobNotFound, JobNotInState])
  }),
  Rpc.make("Sales.invoices", { payload: {}, success: Schema.Array(Invoice) }),
  Rpc.make("Sales.recordPayment", {
    payload: { invoiceId: Schema.String },
    success: Invoice,
    error: Schema.Union([InvoiceNotFound, InvoiceAlreadyPaid])
  })
).middleware(AuthenticatedRpc)
