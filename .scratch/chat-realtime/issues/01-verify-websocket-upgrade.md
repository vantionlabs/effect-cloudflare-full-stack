# Verify `HttpServerRequest.upgrade` under workerd

Status: ready-for-agent
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
