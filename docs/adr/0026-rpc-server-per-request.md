# ADR-0026 — The RPC server is built per request, not mounted with `RpcServer.layerHttp`

**Status:** accepted · **Date:** 2026-10-05 · **Amends** [ADR-0012](0012-api-package-and-rpc.md)

## Context

ADR-0012 mounted `RpcV1` with `RpcServer.layerHttp({ protocol: "http" })`, on the same router as the HTTP API.
In an isolate whose **first request was not an RPC call and did no I/O**, every RPC call afterwards failed: workerd
cancelled it as hung, within a few milliseconds, and answered 500. The rest of the API kept working.

Reported first in `whatsapp-lead-agent-demo`, a fork of this template. Reproduced here on 2026-10-05 under
`wrangler dev` (effect 4.0.0, wrangler 4.143.0, compatibility date 2026-09-26), fresh process per run, with a
scripted `RpcClient` against `RpcV1`:

| First request                         | Then                         | Result                                                  |
| ------------------------------------- | ---------------------------- | ------------------------------------------------------- |
| `GET /api/v1/openapi.json`            | `Usage.report` ×2            | both `POST /api/rpc/v1/ 500` in 3–6 ms, "code had hung" |
| `GET /nope` (404), `GET /api/v1/docs` | `Usage.report` ×2            | same                                                    |
| `GET /api/v1/openapi.json`            | health, get-session, RPC     | health and get-session 200, the RPC call 500            |
| `GET /api/v1/health`                  | `Usage.report` ×2            | 200, 200                                                |
| `GET /api/auth/get-session`           | `Usage.report` ×2            | 200, 200                                                |
| sign-up                               | `Usage.report`, `Ask.stream` | 200 throughout                                          |
| an RPC call (control)                 | health, RPC                  | 200 throughout                                          |

The runtime's message for the failures was:

```
Uncaught Error: The Workers runtime canceled this request because it detected that your Worker's code had hung
and would never generate a response.
```

**Why it hid here and not in the fork.** This template's `/api/v1/health` queries Postgres, and so does better-auth's
session route. That I/O kept the first request alive for a few milliseconds, which was enough. The fork's health
route answered synchronously, so the bug showed on the most common first request there is.

## What was established, and how

**Proven, by temporarily instrumenting the installed `effect` (`dist/rpc/Utils.js`, `dist/Scheduler.js`), since
reverted:**

1. **The RPC server never started.** `layerHttp` is `layer(group)` over `layerProtocolHttp`, and `layer` is
   `Layer.effectDiscard(Effect.forkScoped(make(group)))`. The protocol buffers incoming messages until the server's
   loop calls `run` (`rpc/Utils.ts`, `withRun`). After an `openapi.json` first request, every RPC message landed in
   that buffer (`buffer=1`, `2`, then `3`, `4` on the next call) and the loop was never installed. After a health
   first request, the loop was installed during the first request (`draining buffer=0`).
2. **A scheduler timer from the first request never fired.** A forked fiber does not start on the spot:
   `forkUnsafe` queues `child.evaluate` on the PARENT fiber's dispatcher, and `MixedScheduler` flushes that queue
   with `setTimeout(0)`. At the time of the RPC call, 1.5 s after the first request, exactly one dispatcher had a
   `setTimeout(0)` armed during the first request that had never fired, holding one task.

**Inferred, not separately proven:** that the stranded task is the server fiber's start, and that workerd dropped
the timer because the request that armed it had already returned its response. Both fit everything above, and
nothing else was found stranded, but the probe did not label the task.

What the RPC handler then does explains the symptom exactly: it writes the request and `Eof` into the buffer and
waits on a response queue that only the server fills. With nothing pending, workerd sees a request that can never
complete and cancels it.

## Decision

**Each RPC POST builds its own server, with `RpcServer.toHttpEffect`, forked into that request's scope.**
`apps/worker/src/platform/RpcHttp.ts` does it in one line:

```ts
HttpRouter.add("POST", path, Effect.flatten(RpcServer.toHttpEffect(group)))
```

Every fiber the server starts belongs to the request that is waiting on it, so there is no long-lived fiber whose
next step can be scheduled in a request that has ended. It is the same rule as the database connection
(`HyperdriveConnect.ts`): nothing that schedules work may outlive the request that created it.

**The request's own scope, not `Effect.scoped`.** `whatsapp-lead-agent-demo` used `Effect.scoped`, which closes
the server when the handler returns. That is before a streamed body is read, and `document-chat-demo` worked around
it with its own scope closed from a `TransformStream`. Neither is needed here: `HttpEffect.toWebHandler` already
transfers the request scope to a streamed body (`scopeTransferToStream`), so the server shuts down when the last
frame is written or the client goes away. Checked by switching both ends to NDJSON temporarily: `Ask.stream`'s
progress frames arrived after the response headers, over several hundred milliseconds, and the next call worked.
With the JSON serialization used today the question does not arise, because the HTTP protocol collects a stream's
chunks before it answers.

**Composition consequence.** The handlers (`RpcEdges`), the serialization and the RPC middleware
(`SessionRpcLive`, which provides `AuthenticatedRpc`) are read per request, so `Main.ts` merges them with
`provideMerge` instead of consuming them with `provide`. Leaving one as `provide` is a compile error at the
per-request door, which is how `SessionRpcLive` was found.

## Consequences

- **A server per call.** A handler map, a protocol and a few fibers per POST. Measured locally: `Usage.report`
  answered in 18–50 ms before and after, dominated by the session lookup and the connection.
- **Nothing is shared between RPC requests.** Batching still works within one POST; nothing relied on more.
- **`apps/worker/test/RpcFirstRequest.test.ts`** boots its own Worker and opens with `/api/v1/openapi.json`, then
  calls a unary and a streaming procedure, unauthenticated and with a session. It failed with a 500 before the
  change. It must keep its own file: a Worker shared with another RPC test would pass whichever ran first.
- **The `protocol: "http"` trap in ADR-0012 no longer applies to this code**, since `layerHttp` is gone, but it
  still applies to anyone who brings it back.

## Revisit when

Effect starts a forked fiber without a timer (or `RpcServer.layer` gains `startImmediately`) **and** workerd
guarantees that work scheduled by one request may resume in another — both, because a server that started would
still have to be woken later by timers armed in requests that may already have ended. Until then, per request.
