# Notifications outside the app

Status: needs-triage

A mention is recorded and a badge is counted; nothing leaves the browser. Somebody named in a thread while
they are not looking at the console finds out when they next open it.

## Why it is not built

Because delivery is the hard part, not detection. `message_mentions` already answers "what mentioned me", and
the index on `(organization_id, user_id)` exists for exactly that query.

## What it needs before building

- A channel: email via Resend, or web push. Email needs a provider decision and a per-client data-residency
  answer, which `docs/runbooks/ProviderProfiles.md` is the right home for — the same EU question the model
  providers already raised.
- Batching, and a rule for it. One email per mention is how a product gets muted; the interval is the decision
  and it belongs next to the code, not in a config file nobody reads.
- The outbox pattern, reused rather than reinvented: no transaction spans a Postgres write and an email send,
  which is the same gap the `events` table and its sweeper already cover.
- A read model for "unread mentions", which `ListRooms` deliberately does not compute today — it counts
  messages, not mentions.
