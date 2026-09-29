# effect-ai

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature-slug>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, using the default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Traps in this codebase

Recorded because each has cost real debugging time more than once.

**Backticks inside a `sql` template literal.** Writing `` `events` `` in a prose comment _inside_ a
`` sql`...` `` template closes the template. The error surfaces as `TS1005: ';' expected` pointing at a line
of English, which is slow to recognise. Write `"events"` or bare `events` instead. This cannot be linted
usefully: reintroducing the mistake adds a balanced pair of backticks, so counting them does not detect it,
and any regex for the template body stops at the very backtick that caused the problem. `tsc` catches it
immediately — the fix is to recognise the error, not to add a check that implies coverage it does not have.

**`RpcServer.layerHttp` mounts a WebSocket when `protocol` is omitted.** Despite the name. A plain POST
gets a 404 with nothing in the logs. Always pass `protocol: "http"` explicitly.

**A superuser bypasses RLS whatever `FORCE` says.** The local Worker connects as the bootstrap user, so
`Db.scoped` issues `set local role effect_ai_app` inside its transaction. A tenancy test that connects as
the app role cannot discover that production does not.

**An empty `text[]` parameter fails to encode.** The driver infers the element type from the first element.
So a column like `rails_fired` breaks precisely when it is empty — the happy path breaks and the unhappy
path works. Use `textArray(sql, values)`.

**`Schema.TaggedError` is an `Error` whose `.message` is usually empty.** `failure.message` compiles and
records a blank string. Lead with `_tag`.
