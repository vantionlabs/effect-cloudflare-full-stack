# ADR-0020 — The socket is push-only and carries Schema frames, not RPC

**Status:** accepted · **Date:** 2026-09-30

## Context

Everything else in this codebase speaks Effect RPC: the console is typed from `RpcV1`, the same value the
server types its handlers against (ADR-0012). rc.118 _does_ have WebSocket RPC —
`RpcServer.layerProtocolWebsocket` registers a route that upgrades and attaches the socket to the protocol —
so the obvious plan, and what the original chat spec said, was that chat would join the existing `RpcGroup`
over a socket.

That plan is incompatible with hibernation, which is the thing that makes rooms affordable.

## Decision

**The socket is one-way — server to client — and carries self-contained `Schema`-encoded frames.** Durable
actions go over the existing HTTP RPC path. The only client-to-server frames are _ephemeral per-connection_
state: the keepalive `ping`, and `Viewing` (which decision you have open).

**Why RPC cannot ride this socket.** Hibernation is _defined_ by the room leaving memory while its sockets stay
connected: delivery becomes callback-based and stateless per message, and the socket set is recovered from
`ctx.getWebSockets()`. But a protocol session is per-connection in-memory state — that is what
`makeSocketProtocol` is — and a streaming rpc additionally holds a **server fiber** for the subscription's
lifetime. Anything held in memory per connection forces `accept()` over `acceptWebSocket()`, which bills
wall-clock for every second every client is connected. It cannot be patched with `serializeAttachment`, which
holds a small value per socket, not a protocol handshake.

**Why the split is a rule rather than a judgement.** Durable things need the database connection, error
handling and a response a caller can act on — all of which the RPC path has. Ephemeral things need none of it
and would pay a request each. So: if losing it is acceptable, it may ride the socket; otherwise it may not.
`send` drops rather than queues when the socket is closed, which is the same decision expressed in code.

`Schema` still gives one definition for both ends, which was RPC's real attraction. What is lost is the
request/response ergonomics — and nothing needs them here.

## Consequences

- **Two channels**, asymmetric: HTTP for actions, a socket for pushes. More moving parts than one transport,
  and the price of hibernation.
- **`PubSub` and `Queue` are out of a room**, not for style: `PubSub` is per-isolate memory, so a publish would
  reach a subset of subscribers and report success, and both need a resident subscriber fiber.
- **`Stream` and `Sink` keep their place elsewhere** — the AI chat is a streaming rpc over HTTP, where a fiber
  is alive for the request anyway and Workers bill CPU rather than wall-clock.
- **The `request.upgrade` question stops being blocking** (issue 01). A room upgrades with
  `ctx.acceptWebSocket()` either way.

## Revisit when

- **Hibernation stops being the constraint** — a resident room becomes affordable, or the platform gains a way
  to carry protocol state across hibernation. Then WebSocket RPC is simply better and this should go.
- **A frame needs a reply.** One request/response over the socket is the signal that the split above is
  being fought rather than followed; the answer is almost certainly an RPC call.
