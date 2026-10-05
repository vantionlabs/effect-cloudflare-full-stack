# A customer's email becomes a draft quote

Status: resolved
Type: task

Cloudflare Email Routing delivers `offerte@<domain>` to the Worker's `email` handler; an agent per organization
turns the message into a draft quote with the existing `DraftQuote` (verbatim pointers, prices from the price
list), and it waits in Sales for approval like any other draft. On approval the reply goes back in the same thread.
Needs: a domain on Cloudflare with Email Routing, an address→organization mapping, and refusal of unknown senders.

## Answer

Built (uncommitted at the time of writing). **Owner: the Worker and Queues, not an agent** — ADR-0025: an agent owns
interaction, and turning an email into a draft is durable execution, which Queues retry and dead-letter for us.

- Address per organization: `<token>@<INBOUND_EMAIL_DOMAIN>`, token random (≈50 bits), rotatable by owner/admin;
  `inbound_addresses` (migration 0036). Settings → "E-mail voor offerteaanvragen".
- `email()` handler (`apps/worker/src/platform/EmailHandler.ts`): unknown/disabled token and >1 MB are bounced
  (`setReject`); auto-replies and the 51st message in an hour are recorded as refused, not bounced. Token lookup is
  `unscopedForAuth` with the "organization is the answer" marker. MIME via `postal-mime` 4.0.2 (MIT-0).
- `inbound_messages` (dedupe on organization + Message-ID), then `quote.draft-from-email` on the event engine
  (migration 0037 widens `events_type_check`). The consumer runs the same `draftQuoteFor` a person uses; the envelope
  sender is the customer's address; one draft per message (partial unique index); message and draft commit together.
- Sending such a quote replies `Re: <subject>` with `In-Reply-To`/`References` (Email port gained `headers`; Resend
  passes them).
- Sales → "Binnengekomen e-mails": every message, refused ones included; a dead-lettered draft shows as failed.

Switching it on per environment: a domain on the Cloudflare account, Email Routing enabled, a catch-all (or
`*@offerte.<domain>`) route to the API Worker, and `INBOUND_EMAIL_DOMAIN` set in that environment's vars.
