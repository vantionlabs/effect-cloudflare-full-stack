/**
 * The sales procedures. Each calls one use case; the transport adds nothing but the tenant and the error mapping.
 *
 * `serveForTenant`: every use case here writes or reads within the caller's organization, and the ones that record
 * a person (`created_by`, `approved_by`) also need `CurrentUser`, which the RPC middleware supplies.
 */
import type { QuoteStatus } from "@ea/modules/sales/domain/Quote"
import { SalesRpcs } from "@ea/modules/sales/domain/Sales"
import type { UpsertProductInput } from "@ea/modules/sales/use-cases/Product"
import { ListProducts, UpsertProduct } from "@ea/modules/sales/use-cases/Product"
import { ApproveQuote, DiscardQuote, DraftQuote, ListQuotes, SendQuote } from "@ea/modules/sales/use-cases/Quote"
import { Effect } from "effect"
import { serveForTenant } from "../Serve.ts"

export const SalesRpcLive = SalesRpcs.toLayer(
  Effect.succeed({
    "Sales.products": (payload: { readonly includeInactive?: boolean | undefined }) =>
      serveForTenant(ListProducts(payload)),
    "Sales.upsertProduct": (payload: UpsertProductInput) => serveForTenant(UpsertProduct(payload)),
    "Sales.quotes": (payload: { readonly status?: QuoteStatus | undefined }) => serveForTenant(ListQuotes(payload)),
    "Sales.draftQuote": (payload: { readonly request: string }) =>
      // A provider failure is a defect here, as on the ask path: there is nothing for the person to correct.
      serveForTenant(DraftQuote(payload)).pipe(Effect.catchTag("AiError", Effect.die)),
    "Sales.approveQuote": (payload: { readonly quoteId: string }) => serveForTenant(ApproveQuote(payload.quoteId)),
    "Sales.discardQuote": (payload: { readonly quoteId: string }) => serveForTenant(DiscardQuote(payload.quoteId)),
    "Sales.sendQuote": (payload: { readonly quoteId: string }) => serveForTenant(SendQuote(payload.quoteId))
  })
)
