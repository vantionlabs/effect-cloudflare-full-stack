/**
 * The RPC endpoint must answer in an isolate whose FIRST request was not an RPC call.
 *
 * A regression test for ADR-0026. With the server mounted by `RpcServer.layerHttp`, the server's fiber was forked
 * while the first request built the layer, and its start was queued behind a `setTimeout(0)`. When that request
 * finished synchronously (`/api/v1/openapi.json`, `/api/v1/docs`, a 404), workerd dropped the timer with the
 * request, the server never started, and every later RPC call in the isolate waited on it until the runtime gave
 * up: "code had hung", 500, in a few milliseconds.
 *
 * Its own file, and therefore its own harness, because the bug is about the isolate's first request: a file that
 * shared a Worker with any other RPC test would pass whichever order the tests ran in. `/api/v1/health` is NOT the
 * opener on purpose — it queries Postgres, and that I/O kept the first request alive long enough for the timer to
 * fire, which is why the bug went unnoticed here while it reproduced in a fork with a synchronous health route.
 */
import { RPC_V1_PATH } from "@ea/api/v1"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type Harness, startHarness } from "./Harness.ts"

let harness: Harness

beforeAll(async () => {
  harness = await startHarness()
})

afterAll(async () => {
  await harness?.dispose()
})

const call = (tag: string, payload: unknown, cookie?: string) =>
  harness.fetch(RPC_V1_PATH, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: harness.origin,
      ...(cookie === undefined ? {} : { cookie })
    },
    body: JSON.stringify([{ _tag: "Request", id: "1", tag, payload, headers: [] }])
  })

describe("an isolate whose first request is not RPC", () => {
  it("still serves RPC calls, unary and streaming, with and without a session", async () => {
    // Synchronous: no I/O, so the request ends in the same turn the layer is built in.
    const opener = await harness.fetch("/api/v1/openapi.json")
    expect(opener.status).toBe(200)

    const anonymous = await call("Identity.me", null)
    expect(anonymous.status).toBe(200)
    expect(await anonymous.text()).toContain("Unauthenticated")

    // A streaming procedure goes through the same server; refused by the middleware before any model call.
    const stream = await call("Ask.stream", { question: "Is this covered?" })
    expect(stream.status).toBe(200)
    expect(await stream.text()).toContain("Unauthenticated")

    // And the authorized path, through the session middleware and a database connection.
    const { cookie, organizationId } = await harness.signedInWithOrg()
    const me = await call("Identity.me", null, cookie)
    expect(me.status).toBe(200)
    expect(await me.text()).toContain(organizationId)

    // A second call on the same isolate, after a request that ended: no state is carried between them.
    const usage = await call("Usage.report", {}, cookie)
    expect(usage.status).toBe(200)
    expect(await usage.text()).toContain("\"_tag\":\"Success\"")
  })
})
