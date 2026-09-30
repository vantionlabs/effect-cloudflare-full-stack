# Cost control, before it is a surprise

Status: ready-for-agent
Blocked by: 04

The free plan allows **100,000 Durable Object requests per day** and exceeding it makes further operations
of that type **fail** rather than throttle, resetting at 00:00 UTC. WebSocket messages count as requests at
a **1/20 ratio** (`docs/references.md`).

So a per-keystroke typing indicator with ten people in a room is a way to take the demo down mid-afternoon,
and none of this shows up in a test.

## Done looks like

- Broadcasts batched where batching is honest (50–100 ms), and not where it would make the UI lie.
- `setWebSocketAutoResponse` doing keepalive, verified not to wake the room.
- A recorded decision about typing indicators, either way, with the arithmetic next to it.
- One documented number: roughly how many concurrent reviewers this design supports on the free plan before
  the daily request budget is the binding constraint.

## Comments

One bullet is done, and it is the one with a platform trap in it: `setWebSocketAutoResponse` does the
keepalive, and `apps/worker/test/Room.test.ts:153` asserts the ping is answered **without a frame reaching
the application**. The client sends the bare string `ping` for this reason, and the provider comment in
`socket-provider.tsx` records that JSON would wake the room on every keepalive.

Still open: broadcast batching, the typing-indicator decision with its arithmetic, and the one documented
number — roughly how many concurrent reviewers the design supports before the daily Durable Object request
budget binds. That number is the reason to keep this issue: without it, the free plan's 100,000 requests a
day is a limit nobody has compared anything to.
