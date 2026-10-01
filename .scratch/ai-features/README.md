# AI features: five capabilities, built on this product's own data

Five AI capabilities this stack should demonstrate, each built inside the product on its own data model. There is
no external system behind any of them: where a feature needs business data (customers, products, quotes, work,
cash), the product models it.

| # | Feature                                                         | Builds on                                                     |
| - | --------------------------------------------------------------- | ------------------------------------------------------------- |
| 5 | An assistant over technical documentation — manuals, schematics | corpus indexing, the `knowledge` collection, grounded answers |
| 3 | Data on demand, plus weekly KPIs                                | the weekly report; then questions answered over product data  |
| 1 | Sales guided by AI: request -> priced quote -> approved -> sent | a `sales` slice: products, customers, quotes                  |
| 2 | Editing data by asking                                          | proposals a person approves before anything is written        |
| 4 | Work-in-progress and cash-flow planning                         | quotes and their outcomes, as the source of pipeline and cash |

**Order now: 2, then 4.** Sales comes first because it creates the business data the other three
operate on.

**The rule all of them share: the model proposes, code computes, a person approves.** A model never sets a price,
never computes a total, never writes a record and never sends anything to a customer. Prices come from the price
list, arithmetic is integer cents in code, and every outward or destructive step waits for a person — the same
shape the decide pipeline enforces with rails.

## #5 — done

- [x] Indexing on upload (`document.index`).
- [x] A `knowledge` collection, kept out of invoice-decision retrieval.
- [x] `ask` scoped to a collection, with a prompt that never states an unquoted value.
- [x] Console `/ask`, server-rendered through Effect Atom hydration, ask and upload over RPC.
- [x] Citations naming the document and section, taken from retrieval rather than the model.

## #3 — done

- [x] Weekly figures by email every Monday to owners and admins, once per week.
- [x] Data on demand (`/insights`): read-only, tenant-scoped tools — never text-to-SQL — and an answer shown only
      when every figure in it is traceable to what the tools returned; the data itself is always shown beneath.

## #1 — done

- [x] A price list: products with unit, price in cents and VAT (0/9/21%), deactivated rather than deleted.
- [x] Draft a quote from a customer's request: the model reads the request and picks catalogue items; quantities
      must be quoted verbatim from the request; prices and totals are computed in code; anything uncertain is flagged.
- [x] A person approves; only an approved quote can be sent; sending emails the customer, atomically with marking it
      sent, so it is never marked sent unsent and never sent twice.
- [x] Console `/sales`, server-rendered through Effect Atom hydration, every action an RPC mutation.
- [ ] Customers as records of their own (today a quote carries the name and email read from the request).
- [ ] Quote from an uploaded document (a PDF or email file), not only pasted text.
