# Verify `HttpServerRequest.upgrade` under workerd

Status: done
Type: research
Blocks: nothing — informational, see below

`RpcServer.layerProtocolWebsocket({ path })` registers a GET route whose body is
`const socket = yield* Effect.orDie(request.upgrade)` (verified in the vendored source, rc.118 —
`docs/references.md`). Under `workerd` an upgrade is performed by returning a **101 response carrying a
`webSocket`**, not by upgrading a request object in place, so whether `request.upgrade` resolves at all on
the web-handler path is unknown.

This is the same shape of question as ADR-0009's `cloudflare:sockets` one, and it gets the same treatment:
prove it by execution in a real Worker before anything is designed on top of it.

## Done looks like

- A throwaway route in `apps/worker` that upgrades and echoes one frame, exercised from the `worker` vitest
  project (real `workerd`) — not from Node.
- A row in `docs/references.md` with the date and the verdict either way.
- If it does **not** hold: a note recording what `request.upgrade` did instead (rejected? hung? died?), so
  the fallback is chosen against evidence rather than a guess.

## No longer blocking, and why it is kept anyway

An earlier version of the spec had chat riding the existing `RpcGroup` over this socket, so this question
gated everything. It does not any more: a room upgrades with `ctx.acceptWebSocket()` — a Durable Object API
— because that is what hibernation requires, and Effect's socket protocol holds an in-memory session per
connection, which is precisely what hibernation destroys. So the room gets `Schema`-encoded frames
regardless of the answer here.

Worth knowing anyway, for one future case: an RPC stream terminating in the **Worker** rather than in a
room, where a fiber is alive for the request anyway. If `request.upgrade` works there, a live subscription
that does not need cross-client fan-out can be an ordinary streaming rpc. Answer it, record it, do not
block on it.

## Comments

Done, and by better evidence than the issue asked for. It wanted a throwaway upgrade route exercised from
the `worker` project; what exists is the REAL route, `packages/realtime/src/Server/RealtimeUpgrade.ts`,
asserted by `apps/worker/test/Room.test.ts` in real `workerd`: a 101 with a live socket, a welcome frame,
fan-out to a second socket, and a second organization hearing nothing. A throwaway route would have proved
less, because the thing that could fail is the composition, not the call.

`docs/references.md` carries the verdict, replacing the paragraph that still called it an open question.

One finding the issue did not anticipate: `request.upgrade` resolves, but the RPC protocol over that socket
could not be used, because **a `WebSocket` cannot cross a Durable Object stub boundary** (`DataCloneError`).
So the fallback this issue described — a hand-rolled pair with Schema-encoded frames — was taken anyway, for
a platform reason rather than an Effect one. ADR-0020 records it.
