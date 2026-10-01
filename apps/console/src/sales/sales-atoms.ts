/**
 * The sales page's data and actions, all over the console's RPC. Both queries carry a `serializationKey`, so the
 * page's server function can dehydrate them (`atoms/dehydrate.ts`), and a `reactivityKey`, so each mutation below
 * refreshes exactly the list it changed.
 */
import { dehydrateAtoms } from "@/atoms/dehydrate"
import { Api } from "@/rpc"
import { createServerFn } from "@tanstack/react-start"

export const PRODUCTS_KEY = "sales-products"
export const QUOTES_KEY = "sales-quotes"

export const productsAtom = Api.query("Sales.products", { includeInactive: true }, {
  serializationKey: "sales-products",
  reactivityKeys: [PRODUCTS_KEY]
})

export const quotesAtom = Api.query("Sales.quotes", {}, {
  serializationKey: "sales-quotes",
  reactivityKeys: [QUOTES_KEY]
})

export const upsertProductAtom = Api.mutation("Sales.upsertProduct")
export const draftQuoteAtom = Api.mutation("Sales.draftQuote")
export const approveQuoteAtom = Api.mutation("Sales.approveQuote")
export const discardQuoteAtom = Api.mutation("Sales.discardQuote")
export const sendQuoteAtom = Api.mutation("Sales.sendQuote")

/** The page's SSR data. A GET server function, so it always runs on the server. */
export const loadSalesPage = createServerFn({ method: "GET" }).handler(() => dehydrateAtoms([productsAtom, quotesAtom]))
