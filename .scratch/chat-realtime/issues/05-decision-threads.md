# Feature B — threads on a decision

Status: ready-for-agent
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
