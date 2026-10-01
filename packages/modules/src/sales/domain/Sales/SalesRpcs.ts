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
import { InvalidProduct } from "../Errors/InvalidProduct.ts"
import { QuoteHasNoRecipient } from "../Errors/QuoteHasNoRecipient.ts"
import { QuoteNotFound } from "../Errors/QuoteNotFound.ts"
import { QuoteNotInState } from "../Errors/QuoteNotInState.ts"
import { Product, Unit } from "../Product/Product.ts"
import { Quote, QuoteStatus } from "../Quote/Quote.ts"

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
  })
).middleware(AuthenticatedRpc)
