# A customer's email becomes a draft quote

Status: needs-triage
Type: task

Cloudflare Email Routing delivers `offerte@<domain>` to the Worker's `email` handler; an agent per organization
turns the message into a draft quote with the existing `DraftQuote` (verbatim pointers, prices from the price
list), and it waits in Sales for approval like any other draft. On approval the reply goes back in the same thread.
Needs: a domain on Cloudflare with Email Routing, an address→organization mapping, and refusal of unknown senders.
