# Attachments on messages

Status: needs-triage

Files on a message. The pieces already exist — R2 is bound, `intake` already puts documents in it with a
tenant key prefix — so this is mostly a second use of that path plus a join table.

## Why it is not built

No decision needed it yet. The threads that matter are on decisions, and a decision already HAS its document;
attaching a second one is a different act than discussing the first.

## What it needs before building

- A `message_attachments` table, or a column — decide which by whether a message can carry several.
- The same tenant key prefix as `intake/domain/Document`, reused rather than reinvented; a second prefixing
  scheme is how one tenant reads another's blobs.
- A size and type policy. `UnsupportedDocument` exists for intake and refuses a scanned PDF with a typed
  error; attachments want the same refusal shape rather than a silent truncation.
- An answer to deletion: redacting a message body is cheap, deleting a blob is not idempotent, and R2 has no
  transaction with Postgres. The likely shape is the outbox pattern already used for the enqueue gap.
