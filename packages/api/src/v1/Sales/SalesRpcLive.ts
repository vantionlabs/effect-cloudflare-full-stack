/**
 * The sales procedures. Each calls one use case; the transport adds nothing but the tenant and the error mapping.
 *
 * `serveForTenant`: every use case here writes or reads within the caller's organization, and the ones that record
 * a person (`created_by`, `approved_by`) also need `CurrentUser`, which the RPC middleware supplies.
 */
import { AgentModel } from "@ea/modules/policy/domain/Ask"
import type { QuoteStatus } from "@ea/modules/sales/domain/Quote"
import { SalesRpcs } from "@ea/modules/sales/domain/Sales"
import {
  ApplyChange,
  changeToolkitFor,
  ListChanges,
  MAX_INSTRUCTION_LENGTH,
  ProposeChanges,
  RejectChange
} from "@ea/modules/sales/use-cases/Change"
import { GetInboundAddress, ListInboundMessages, RotateInboundAddress } from "@ea/modules/sales/use-cases/Inbound"
import type { UpsertProductInput } from "@ea/modules/sales/use-cases/Product"
import { ListProducts, UpsertProduct } from "@ea/modules/sales/use-cases/Product"
import { ApproveQuote, DiscardQuote, DraftQuote, ListQuotes, SendQuote } from "@ea/modules/sales/use-cases/Quote"
import {
  CompleteJob,
  InvoiceJob,
  ListCustomerTerms,
  ListInvoices,
  ListJobs,
  RecordPayment,
  RespondToQuote,
  SetCustomerTerms
} from "@ea/modules/sales/use-cases/Work"
import { Config, Effect, Option } from "effect"
import { LanguageModel } from "effect/ai"
import { serveForTenant } from "../Serve.ts"

/**
 * The deployment's receiving domain, if Email Routing is configured for one. Optional configuration, so an absent
 * value is `null`, never a failure: addresses still exist and can be tested before a domain is set up.
 */
const inboundDomain = Effect.map(
  Effect.orDie(Config.option(Config.String("INBOUND_EMAIL_DOMAIN"))),
  (domain) => Option.getOrNull(domain)
)

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
    "Sales.sendQuote": (payload: { readonly quoteId: string }) => serveForTenant(SendQuote(payload.quoteId)),
    "Sales.proposeChanges": (payload: { readonly instruction: string }) => {
      const instruction = payload.instruction.slice(0, MAX_INSTRUCTION_LENGTH)
      return serveForTenant(
        Effect.gen(function*() {
          // The agent's model (tool calling) under the plain tag the use case asks for, as `Data.ask` does; the
          // toolkit is built for THIS instruction, which every proposed value is checked against.
          const model = yield* AgentModel
          return yield* ProposeChanges(instruction).pipe(
            Effect.provide(changeToolkitFor(instruction)),
            Effect.provideService(LanguageModel.LanguageModel, model)
          )
        })
      ).pipe(Effect.catchTag("AiError", Effect.die))
    },
    "Sales.changes": () => serveForTenant(ListChanges),
    "Sales.applyChange": (payload: { readonly changeId: string }) => serveForTenant(ApplyChange(payload.changeId)),
    "Sales.rejectChange": (payload: { readonly changeId: string }) => serveForTenant(RejectChange(payload.changeId)),
    "Sales.respondToQuote": (payload: { readonly quoteId: string; readonly accepted: boolean }) =>
      serveForTenant(RespondToQuote(payload.quoteId, payload.accepted)),
    "Sales.jobs": () => serveForTenant(ListJobs),
    "Sales.completeJob": (payload: { readonly jobId: string }) => serveForTenant(CompleteJob(payload.jobId)),
    "Sales.invoiceJob": (payload: { readonly jobId: string }) => serveForTenant(InvoiceJob(payload.jobId)),
    "Sales.invoices": () => serveForTenant(ListInvoices),
    "Sales.recordPayment": (payload: { readonly invoiceId: string }) =>
      serveForTenant(RecordPayment(payload.invoiceId)),
    "Sales.inboundAddress": () => Effect.flatMap(inboundDomain, (domain) => serveForTenant(GetInboundAddress(domain))),
    "Sales.rotateInboundAddress": () =>
      Effect.flatMap(inboundDomain, (domain) => serveForTenant(RotateInboundAddress(domain))),
    "Sales.inboundMessages": () => serveForTenant(ListInboundMessages),
    "Sales.customerTerms": () => serveForTenant(ListCustomerTerms),
    "Sales.setCustomerTerms": (payload: { readonly customerEmail: string; readonly termsDays: number | null }) =>
      serveForTenant(SetCustomerTerms(payload.customerEmail, payload.termsDays))
  })
)
