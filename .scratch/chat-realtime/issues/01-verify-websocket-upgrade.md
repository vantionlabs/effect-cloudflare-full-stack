# Verify `HttpServerRequest.upgrade` under workerd

Status: ready-for-agent
Type: research

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

## Why it is first

Everything downstream branches on the answer: it decides whether chat rides the existing `RpcGroup` and
inherits the typed contract, or needs a hand-rolled `WebSocketPair` with `Schema`-encoded frames.
