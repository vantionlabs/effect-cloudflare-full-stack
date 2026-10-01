# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Staff at small and mid-sized Dutch businesses (service and industrial), on desktop during the working day:

- office and sales staff who turn customer requests into quotes, keep the price list, track jobs and invoices, and
  watch expected cash;
- technicians and service staff who ask the company's own manuals and schematics a question and need the passage the
  answer came from;
- reviewers who decide on documents the system could not decide on its own;
- managers who ask questions about the business's own figures and receive a weekly summary.

Confirmed 2026-10-01.

## Product Purpose

effect-ai puts AI to work on a business's own records without letting it act alone. The model proposes — a draft
quote, a price change, an answer — code computes every figure, and a person approves anything that leaves the
building or changes a record. Success is staff doing routine work faster while every number and every citation can
be traced to its source.

## Positioning

The model proposes, code computes, a person approves. Figures in an answer must appear in the data the tools
returned or the answer is withheld; citations are located from what retrieval actually served, never from the model.
Refusing or escalating is a designed outcome, not an error.

## Operating Context

- Areas: review queue, sales (quotes, price list, price changes by asking, payment terms per customer), planning
  (jobs, invoices, expenses, a twelve-week cash forecast), asking the documentation, insights over the business's own
  data, chat, usage, and team settings.
- Multi-tenant: every person acts inside one organization; members are invited by email.
- Money is euros, integer cents end to end, shown in Dutch notation (`€ 1.234,50`).
- Documents and questions are typically in Dutch.

## Capabilities and Constraints

- Web console (TanStack Start) served from Cloudflare Workers, server-rendered, then hydrated; controls are disabled
  until hydration so nothing is silently lost.
- **Interface language: Dutch.** Confirmed 2026-10-01. AI answers follow the language of the question.
- Design system: Beautiful UI (beautifului.dev) tokens and a small set of its components; see AGENTS.md.

## Brand Commitments

- The product name is **effect-ai**, shown as such. Confirmed 2026-10-01.

## Evidence on Hand

No customer logos, testimonials, case studies or benchmarks exist. Do not invent any.

## Product Principles

1. Every figure and citation is traceable to where it came from; show the source next to the claim.
2. The AI proposes and a person decides — make the decision point obvious and the consequence clear.
3. Withholding or escalating is a legitimate result and must read as one, never as a failure.
4. Daily-use speed over spectacle: scanable, consistent, keyboard-friendly.
5. Plain Dutch, in the words the staff already use for their work.
