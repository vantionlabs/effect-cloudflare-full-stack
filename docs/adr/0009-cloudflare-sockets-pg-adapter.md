# ADR-0009 — `@effect/sql-pg` on Workers via a `cloudflare:sockets` Duplex

**Status:** accepted, verified by execution 2026-09-28
**Closes:** risk R2 (the plan's only unverified-by-execution dependency)

## Context

`@effect/sql-pg` v4 has zero runtime dependencies and implements the Postgres wire
protocol itself, dialling with `node:net` / `node:tls` directly. No vendor or library
claims Cloudflare Workers support, so this was the plan's single blocking unknown.

## Decision

Use the driver's public `stream?: () => Duplex` escape hatch. It bypasses `Net.connect`
entirely, so workerd's `node:net` shim is never involved:

```ts
const socket = connect({ hostname, port }, { secureTransport: "off", allowHalfOpen: false })
Duplex.fromWeb({ readable: socket.readable, writable: socket.writable })
```

**Set `ssl: false` on the client.** Reading `PgConnection.ts` showed that when
`config.stream` is supplied the driver begins the protocol immediately instead of waiting
for a `"connect"` event, and with `ssl: false` it never calls `Tls.connect` at all. That
removes every workerd `node:tls` gap from the path — `rejectUnauthorized: false` throws
there, and `key`/`cert` are silently ignored (workerd#7201). Hyperdrive terminates TLS to
the origin itself, so encrypting the Worker→Hyperdrive hop would be redundant work inside
Cloudflare's own network.

## Verification

`wrangler dev` in real workerd, against a Hyperdrive binding with a `localConnectionString`
pointing at the local pgvector container — so the full
Worker → Hyperdrive binding → Postgres path is exercised with nothing provisioned:

```json
{
  "ok": true,
  "postgres": "PostgreSQL 17.11",
  "pgvector": "0.8.6",
  "dutchStemMatches": true,
  "dutchStem": "'verplicht':1",
  "cosineDistance": 1
}
```

`dutchStemMatches: true` is `to_tsvector('dutch','verplichting')` equalling
`to_tsvector('dutch','verplichtingen')` — both stem to `verplicht`. **Risk R4a (no Dutch
stemming) is closed** through the real stack, not just in psql.

## Consequences

- The adapter is ~15 lines and lives in `apps/worker/src/platform/CloudflareSocket.ts`.
- Six simultaneous outgoing connections per invocation remains the TCP limit.
- `prepare` stays on (default), which is correct on Hyperdrive's **Direct** connection
  string. Behind a transaction-mode pooler it must be `false`.
- Revisit if Cloudflare ships a first-party Postgres driver, or if `@effect/sql-pg` gains
  a documented Workers path.

## API corrections found by running it

| Assumed                                 | Actual at `4.0.0-rc.118`                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| `Effect.catchAllCause`                  | **`Effect.catchCause`**                                                           |
| `password: string`                      | **`Redacted.Redacted`** — a plain string dies with "Unable to get redacted value" |
| `Duplex.fromWeb` unavailable in workerd | **available and working**                                                         |
