# Meter OCR pages and the assistant's model calls

Status: needs-triage

Metering v1 covers documents ingested, decisions completed, and the decide pipeline's model tokens. Two real
costs are not yet counted:

- **Mistral OCR pages.** Billed per page by Mistral ($4 / 1,000). The response carries `usage_info.pages_processed`.
  The parser is an intake `server` adapter with no transaction in hand, so this wants `recordModelUsage`'s shape:
  its own short write, keyed on nothing (it is cost).
- **The assistant's tool loop.** `AskCorpus` makes several model calls per question. Same helper; needs a new
  billable meter (`assistant.questions`) if questions are to be sold, which is a `Meter` + `check` change.

No account has a Mistral key yet, so OCR metering cannot be verified by execution today.
