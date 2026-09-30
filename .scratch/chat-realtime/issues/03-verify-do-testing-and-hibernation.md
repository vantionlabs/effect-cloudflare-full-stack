# Verify `runInDurableObject` and that a room actually hibernates

Status: ready-for-agent
Type: research
Blocked by: 01

Two things, because they are the same test harness.

**Testing.** `vitest-pool-workers` exposes `runInDurableObject` for reaching inside an instance. The
`worker` project already boots a real Worker and is gated on `CLOUDFLARE_API_TOKEN` (the `ai` binding forces
a remote runtime), so confirm a DO test runs there and note whether it needs the token too.

**Hibernation.** The design's whole cost argument is that a room hibernates. Confirm the two claims that
matter, by observation rather than by reading:

- a socket accepted with `ctx.acceptWebSocket()` survives the instance leaving memory, and
  `ctx.getWebSockets()` returns it afterwards;
- an outbound `connect()` keeps the instance resident — the 15-minute rule in `docs/references.md` — which
  is the fact that forbids `PgClient` in a room. If this cannot be observed locally, say so in the row
  rather than asserting it.

## Done looks like

A test file that survives being read by somebody sceptical, plus rows in `docs/references.md`. If
hibernation cannot be observed under miniflare at all, that itself is the finding, and R1's mitigation
becomes entirely static (the `dep:check` rule) rather than partly empirical.

## Comments

**Half of this is answered; recording which half so it is not redone.**

Answered: how to test a Durable Object here. Not with `runInDurableObject` — `apps/worker/test/Room.test.ts`
drives the room through `createTestHarness`, i.e. through the real upgrade route as a client, which is what
made the second-organization property testable at all. And `setWebSocketAutoResponse` is verified: the test
at `Room.test.ts:153` asserts a ping is answered **without a frame reaching the application**, which is the
observable half of "it does not wake the room".

Still open: whether hibernation itself can be OBSERVED under miniflare — that a room actually leaves memory
and that a socket's attachment survives the return. The design already assumes it (nothing is kept on the
instance; the viewer list is derived from `deserializeAttachment` every time), so a negative finding would
not change the code — it would move R1's mitigation to being entirely static, which is the issue's own
stated alternative.

Worth keeping because the cost of being wrong is an invoice rather than a bug.
