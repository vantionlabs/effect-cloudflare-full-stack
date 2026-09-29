# Feature C — one room per org: live queue and presence

Status: ready-for-agent
Blocked by: 01, 02, 03

The smallest useful realtime feature, and the one that proves the whole topology with no persistence
question in the way: a room per organization that broadcasts "the queue changed" and "who is looking at
this decision". It stores nothing.

It also fixes something real. Today two reviewers can open the same invoice and one of them approves it
while the other is reading it; the loser finds out from a CAS failure. Presence is the cheap half of that.

## Shape

- `RoomDurableObject`, `storage: "sqlite"` (the only backend for new namespaces), no storage used.
- Name built server-side as `org:<orgId>` from `resolveIdentity` on the upgrade — **never** from anything
  the client sends. A client that can name its room can read another tenant's.
- `ctx.acceptWebSocket()`, not `accept()`: the latter bills for the entire connection.
- `setWebSocketAutoResponse` for keepalive. No `setInterval`, no alarm — either prevents hibernation.
- A bounded socket lifetime (start at 30 minutes) so a revoked session stops streaming, with the reason
  written next to the number.
- The Worker notifies the room after it has already written; the room only fans out.

## Done looks like

- The queue updates without a refresh when another user approves something.
- An e2e spec with **two browser contexts** asserting fan-out, and asserting that a second organization's
  socket receives nothing — a property no unit test can see (ADR-0017).
- A `dep:check` rule forbidding any database import from the DO module, so R1 is a build failure rather
  than an invoice.
- ADR-0018 and ADR-0019 written, because the reasons are freshest now.
