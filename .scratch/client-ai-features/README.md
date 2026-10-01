# Client AI features: the five ideas from a manufacturing workshop

Source: a lead (a Groningen hydraulics and crane-equipment company) with a two-year-old Laravel internal tool
that runs the whole workshop and talks to an accounting package. He wants an AI layer BESIDE that tool, talking
to it over an API, and he wants to own the result rather than rent a SaaS. The user wants all five in this repo.

| # | Idea (his words, translated)                                                                                  | What it needs                                                                                                                    | Data dependency                 |
| - | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 5 | An assistant for mechanics: answer questions, including from technical documentation — schematics and manuals | corpus indexing on upload, a `knowledge` collection kept apart from `policy`, grounded answers with citations, a console surface | **his documents only**          |
| 3 | Data shown when needed, the way needed; plus weekly KPIs                                                      | read tools over his data, a scheduled weekly report (cron + `Email`)                                                             | his Laravel API                 |
| 1 | Sales guided by AI: opportunity -> calculation -> quote                                                       | the decide shape again: extract -> propose -> HUMAN approval before anything leaves                                              | his products, prices, customers |
| 2 | Editing data                                                                                                  | write tools that PROPOSE an edit and apply it only on approval                                                                   | his Laravel API                 |
| 4 | Work-in-progress and cash-flow planning                                                                       | his open work and the accounting package's receivables/payables                                                                  | his accounting integration      |

**Order: 5, then 3, 1, 2, 4** — by how much of his data each needs. #5 runs on documents alone and reuses most of
what exists (hybrid retrieval, `AskCorpus` refusing ungrounded citations, the assistant agent). The others need
an integration port to his Laravel API, which should be one adapter behind a port in `integrations/`, so the
features are buildable and testable against a fake before his API exists.

Human-in-the-loop is non-negotiable for 1, 2 and 4: nothing reaches a customer, a record or a payment without a
person approving it — the same rule the decide pipeline enforces with rails.

## #5 progress

- [x] **Indexing on upload** (`document.index`). Found missing while scoping: uploads to `policy` were stored and
      never indexed, so only tests and evals could populate the corpus.
- [x] A `knowledge` collection for technical documentation, kept out of invoice-decision retrieval.
- [x] `ask` scoped to a collection, with a mechanics' prompt that never states an unquoted value.
- [x] A console Ask page (`/ask`): server-rendered through Effect Atom hydration, ask and upload over RPC.
- [x] Citations that name the document and section (`pk23500.md · 2. Hydraulische druk`), taken from what
      retrieval returned rather than from the model's own labels.

## #3 progress

- [x] **Weekly figures by email** (`reporting` slice): every Monday 06:00 UTC, each organization active last week
      gets documents received, decisions by outcome with their shares, the review backlog and model tokens, sent to
      its owners and admins through the `Email` port, once per week (`report_deliveries` claim).
- [ ] The client's OWN figures — work in progress, invoicing — through an integration port to his Laravel API.
- [ ] Data on demand: the assistant answering questions over those figures, with the same grounding rules.
