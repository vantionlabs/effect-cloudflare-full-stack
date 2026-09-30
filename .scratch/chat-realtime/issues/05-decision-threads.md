# Feature B — threads on a decision

Status: done
Blocked by: 04

A conversation attached to a queue item, so the argument about why something was approved lives next to the
decision instead of in Slack — which is the same claim the citations make, applied to the humans.

## Shape

- `decision_comments` in Postgres: the usual `organization_id` column, written through `Db.scoped`, no new
  scoping mechanism. Ordering authority is the database's identity, not a counter in the room.
- Send over the existing RPC; the Worker persists, then hands the **already-persisted** message to the room
  to broadcast. Nothing is broadcast that is not durable, so there is no window where a client has seen a
  message that a reload would lose.
- Catch-up on reconnect is "everything after seq N", from Postgres. Deliberately **not** a ring buffer in
  the room: that is a second copy with its own eviction rule, and the failure is a reconnecting client
  seeing a different history from a reloading one.
- The client merges by message id, idempotently, because a reconnect can overlap a live broadcast.

## Done looks like

- Two browsers, one thread, messages appearing in both in order.
- Kill the socket mid-conversation, reconnect, and the history is identical to a full reload — the test
  that actually justifies the no-ring-buffer decision.
- A tenancy case: org A cannot post to or read a thread on org B's decision, even holding a valid id.

## Comments

**2026-09-30 — shipped.** `messages` (migration 0016), `Message.list` / `Message.post` on `RpcV1`, and a
`MessagePosted` frame. Seven table tests against real Postgres, two worker tests for the write-then-announce
loop including the cross-tenant absence.

Three decisions worth recording, because each differs from what this file assumed:

- **No `seq` column.** Ids are UUIDv7 and therefore time-ordered, so `order by id` is chronological and
  `id >` is the cursor. A sequence would leave gaps on rollback that a catch-up query would read as lost
  messages; a `max(seq)+1` read-then-write would be a contention point on a chat's hottest path.
- **No per-decision room.** `MessagePosted` is broadcast into the ORGANIZATION's room with the subject inside
  the frame, so there is one socket per person and no subscribe protocol. The cost is that every member hears
  about every thread — which doubles as the notification everybody wants first. The trigger to split is in
  `MessagePosted`'s docstring.
- **The frame carries the message, unlike `QueueChanged`.** A thread is append-only so the frame _is_ the
  delta and nothing about a posted message changes afterwards. The client still invalidates rather than
  appends, so the thread's contents come from one place; the message is in the frame for a future optimistic
  render. If editing arrives, this becomes a nudge like the other.

**Not built, deliberately:** editing, deletion, reactions, read receipts, @-mentions. Each is its own issue
with its own reason to exist, per R8.
