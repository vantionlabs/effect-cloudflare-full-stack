/**
 * The bridge that makes `@effect/sql-pg` work on Cloudflare Workers.
 *
 * `@effect/sql-pg` v4 implements the Postgres wire protocol itself and dials with
 * `node:net` / `node:tls` directly. Rather than rely on workerd's `node:net` shim, we
 * use the driver's public `stream?: () => Duplex` escape hatch and hand it a Duplex
 * wrapping `connect()` from `cloudflare:sockets` — the first-party TCP API.
 *
 * Two things make this simpler than it looks:
 *
 * 1. When `stream` is supplied the driver skips waiting for a `"connect"` event and
 *    begins the protocol immediately, which suits `connect()`'s eager semantics.
 * 2. With `ssl: false` the driver never calls `Tls.connect`, so none of workerd's
 *    `node:tls` gaps apply (`rejectUnauthorized: false` throws there, and `key`/`cert`
 *    are silently ignored — workerd#7201). Hyperdrive terminates TLS to the origin
 *    itself, so the Worker→Hyperdrive hop needs no TLS of its own.
 *
 * The driver requires a full Node Duplex: `on`/`once`/`off` for "data" | "error" |
 * "close", `write`, `end`, `destroy`, a `writable` flag, and `pause`/`resume` for
 * streaming backpressure. `Duplex.fromWeb` gives us all of it from the Web streams
 * `connect()` returns.
 */
import { connect } from "cloudflare:sockets"
import { Redacted } from "effect"
import { Duplex } from "node:stream"

/** The shape of a Hyperdrive binding we actually depend on. */
export interface HyperdriveLike {
  readonly host: string
  readonly port: number
  readonly user: string
  readonly password: string
  readonly database: string
}

/**
 * Opens a TCP socket through `cloudflare:sockets` and presents it as a Node Duplex.
 *
 * `secureTransport: "off"` is deliberate and pairs with `ssl: false` on the client:
 * Hyperdrive is the TLS terminator, so encrypting this hop would be redundant work
 * inside Cloudflare's own network.
 */
export const cloudflareDuplex = (options: {
  readonly host: string
  readonly port: number
}): Duplex => {
  const socket = connect(
    { hostname: options.host, port: options.port },
    { secureTransport: "off", allowHalfOpen: false }
  )
  // `Duplex.fromWeb` is typed against `node:stream/web`'s ReadableStream/WritableStream,
  // while `@cloudflare/workers-types` supplies the global Web stream types. They describe
  // the *same* runtime objects — workerd has one implementation — but are nominally
  // distinct, so TypeScript rejects the assignment on unrelated BYOB-reader variance.
  // The cast is confined to this one call and the runtime path is verified end to end by
  // the probe recorded in ADR-0009.
  return Duplex.fromWeb(
    { readable: socket.readable, writable: socket.writable } as unknown as Parameters<
      typeof Duplex.fromWeb
    >[0]
  )
}

/** Config for `PgClient.layer` that routes through a Hyperdrive binding. */
export const pgConfigFor = (hyperdrive: HyperdriveLike) => ({
  host: hyperdrive.host,
  port: hyperdrive.port,
  username: hyperdrive.user,
  // The driver requires a Redacted so a password cannot land in a log line or a
  // stringified config by accident.
  password: Redacted.make(hyperdrive.password),
  database: hyperdrive.database,
  // Hyperdrive terminates TLS; see the module docstring.
  ssl: false as const,
  stream: () => cloudflareDuplex({ host: hyperdrive.host, port: hyperdrive.port })
})
