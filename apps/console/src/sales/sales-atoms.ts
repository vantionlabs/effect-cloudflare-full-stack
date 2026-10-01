/**
 * The sales page's data and actions, all over the console's RPC. Both queries carry a `serializationKey`, so the
 * page's server function can dehydrate them (`atoms/dehydrate.ts`), and a `reactivityKey`, so each mutation below
 * refreshes exactly the list it changed.
 */
import { Api } from "@/rpc"

export const PRODUCTS_KEY = "sales-products"
export const QUOTES_KEY = "sales-quotes"
export const CHANGES_KEY = "sales-changes"

export const productsAtom = Api.query("Sales.products", { includeInactive: true }, {
  serializationKey: "sales-products",
  reactivityKeys: [PRODUCTS_KEY]
})

export const quotesAtom = Api.query("Sales.quotes", {}, {
  serializationKey: "sales-quotes",
  reactivityKeys: [QUOTES_KEY]
})

export const changesAtom = Api.query("Sales.changes", {}, {
  serializationKey: "sales-changes",
  reactivityKeys: [CHANGES_KEY]
})

export const upsertProductAtom = Api.mutation("Sales.upsertProduct")
export const proposeChangesAtom = Api.mutation("Sales.proposeChanges")
export const applyChangeAtom = Api.mutation("Sales.applyChange")
export const rejectChangeAtom = Api.mutation("Sales.rejectChange")
export const draftQuoteAtom = Api.mutation("Sales.draftQuote")
export const approveQuoteAtom = Api.mutation("Sales.approveQuote")
export const discardQuoteAtom = Api.mutation("Sales.discardQuote")
export const sendQuoteAtom = Api.mutation("Sales.sendQuote")
export const respondToQuoteAtom = Api.mutation("Sales.respondToQuote")
