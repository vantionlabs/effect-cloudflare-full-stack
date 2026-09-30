# effect-ai

## Documentation

Start at [`docs/README.md`](docs/README.md) — it indexes the plan, the ADRs, the service inventory and the
dated external references, and it lists what is _not_ written down yet.

Two files carry most of what an agent needs before changing anything:

- [`docs/services.md`](docs/services.md) — every service, Cloudflare-native or not, and why. Read it before
  adding a dependency or a binding.
- [`docs/references.md`](docs/references.md) — external facts with the date they were checked. **Add a row
  here rather than asserting a version or a provider behaviour inline**, so a stale claim can be told from
  a wrong one.

ADRs end in **Revisit when**. If you find yourself arguing against a decision, check whether its trigger
has fired — and if a reason turns out to be wrong, withdraw it in place rather than editing it out
(ADR-0014 is the worked example).

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature-slug>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, using the default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## The Effect source is vendored at `repos/effect`

`git subtree`, pinned to the tag this repo runs — `effect@4.0.0-rc.118`, the same version as the `catalog:`
entry. Added because v4 RC documentation is thin and reading the source is faster and more reliable than
guessing: several APIs in this repo were settled by reading it (`Result` uses `.success`, not `.value`;
`Schema.toStandardSchemaV1` exists so no form adapter is needed; `createStartHandler` is all the default
server entry does).

**READ-ONLY. Never import from it.** The installed `effect` in `node_modules` is what runs; `repos/effect`
is documentation that happens to compile. An import from it would typecheck and then fail at runtime, which
is why `.vscode/settings.json` excludes it from auto-import suggestions — the one way that mistake happens
by accident rather than on purpose.

It is excluded from dprint, oxlint, knip and secretlint, and no tsconfig or vitest project includes it. If a
tool starts reporting 1652 findings, it is missing an exclude rather than telling you something new.

**Updating it** means moving the pin deliberately, alongside the `catalog:` bump:

```sh
git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git effect@<new-tag> --squash
```

Pinned to a tag rather than `main` on purpose. Tip-of-main would show APIs the installed version does not
have, and an agent reading source that disagrees with the lockfile is worse off than one reading nothing —
it would be confidently wrong instead of uncertain.

**It costs 54 MB and 4311 files.** That is the trade: a slower clone and a larger checkout, for a local
copy of the answers.

## Filename conventions

**`packages/` and `apps/worker/`: PascalCase, filename = exported symbol. No dots.** Concept folders are
PascalCase, rings are lowercase.

```
decision/domain/Decision/Decision.ts          the concept's own types
decision/domain/Decision/Rails.ts             exports applyRails + RailedDecision
decision/domain/Decision/DecisionRpcs.ts      the RpcGroup
decision/tables/Decision/DecisionTable.ts     exports DecisionTable
decision/use-cases/Decision/DecideDocument.ts a named operation
iam/server/Session/SessionLive.ts             the implementation
iam/server/Session/SessionStore.ts            the port
api/v1/Decision/DecisionRpcLive.ts            the transport edge
```

**There used to be a closed facet-suffix vocabulary** — `.model` `.table` `.wire` `.rpc` `.rails`
`.errors` `.parser` `.http` — and it is gone (ADR-0010, revised). The greppability it bought
(`rg --files -g '*.table.ts'`) was real but was never what the checks actually used: `dep:check` keys on
**ring directories** (`/tables/`, `/domain/`, `/server/`), which is more robust because a file cannot lie
about which directory it is in. Dropping the suffixes cost nothing and removed a second thing to keep in
step.

**Errors live in a per-slice `Errors/` folder, one file per error.** `shared/domain/Errors/EventNotFound.ts`,
`intake/domain/Errors/UnsupportedDocument.ts`, `decision/domain/Errors/DocumentBlobMissing.ts`. A folder
rather than one `Errors.ts` because an error is part of a contract — it is named in a `catchTag`, in a wire
schema, and in the terminal-versus-retryable classification — so `rg --files packages/modules/*/domain/Errors`
is the vocabulary, and adding one is a new file in a diff rather than a line inside a list.

Two rules that follow:

- **Define an error in the slice it belongs to, not where it is raised.** Three were defined inside the
  Worker's queue dispatch; they moved to `decision/domain/Errors` because the Worker is a composition root
  and a slice's failures should be readable without opening a deployment target.
- **`shared/domain/Errors/Terminal.ts` names other slices' tags as STRINGS.** Deliberately: importing
  `UnsupportedDocument` into `shared` would invert the dependency direction the whole layout rests on. The
  cost is that a renamed tag silently stops being terminal, which is why the list carries a comment per entry
  saying which slice it came from.

Keep one concept per folder and one primary export per file. When a file has several exports, name it for
the primary one (`Rule.ts` exports `AutoApproveRule` and `RuleFacts`) or for what they collectively are
(`EventErrors.ts`).

**`apps/console/`: kebab-case.** The browser ring follows React ecosystem convention — `queue-grid.tsx`,
not `QueueGrid.tsx` — because that is what every contributor coming from the React side will expect, and a
console is where such a contributor is most likely to start. The two conventions meet at a package
boundary, which is the only place a convention change is cheap to notice.

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

**`bun run preflight` does NOT include the retrieval gate, on purpose.**
`bun run evals:retrieval` is a separate command because it needs Workers AI credentials and real embedding
calls, and CI runs it conditionally on `CLOUDFLARE_AI_TOKEN` with a loud warning when skipped. Putting it
inside `preflight` made `preflight` permanently red while the Workers AI account has no neurons — a gate
nobody can pass stops being read. Run it deliberately, and treat a failure as a retrieval-quality finding
rather than a broken build.

**`preflight` does not include `test:e2e` either**, for the related reason that it needs a running Postgres
container and a Cloudflare token — `preflight` should stay runnable on a laptop with nothing started. Run it
when you touch the console's auth, routing or forms, which is precisely where it has already earned its
keep.

**Three things made the gates pass locally and fail on a clean machine, and all three had the same
shape: a developer machine holds state a fresh one does not.** A green `bun run preflight` is therefore
evidence about this machine, not about the code. The three were a generated file that was already on disk,
a `node_modules` link left by an earlier install, and cached `wrangler login` credentials. When a gate
disagrees with CI, suspect local state before suspecting CI.

**The `worker` vitest project cannot run without `CLOUDFLARE_API_TOKEN`.**
It boots a real Worker from `apps/worker/wrangler.jsonc`, which has an `ai` binding, and Workers AI has
no local emulation — so wrangler starts a _remote_ runtime and refuses non-interactively without a token.
Locally it works because `wrangler login` cached OAuth credentials, so this is invisible until CI. It is
not conditional in the test file: CI gates the step and prints a warning when it is skipped, because a
suite that quietly skips itself is worse than one that visibly does not run.

**`bun run check` passes locally and fails in a fresh clone.**
`apps/console/src/routeTree.gen.ts` is generated by the TanStack router Vite plugin and gitignored, but
`tsc -b` needs it — without it `main.tsx` cannot resolve the module and every `createFileRoute("/")`
argument narrows to `undefined`, so the error blames your route file rather than the missing one. It is on
your disk because you ran `vite` at some point, which is exactly why local green means nothing here. Run
`bun run --filter @ea/console build` first; CI does, before `check`, for this reason. Found when the first
push to the remote failed CI on a tree whose `preflight` had just passed.

**`bun run db:migrate` and `bun run test` target DIFFERENT databases by default.** `migrate` prefers
`DATABASE_URL`, which `apps/worker/.env` sets to the **dev Neon** project; the test suites read the `PG*`
variables and hit the **compose container**. So "I applied the migration" and "the tests see the new column"
are two different claims, and a suite that fails with `column … does not exist` right after a successful
migration is this, not a broken migration.

The script prints the host it is about to migrate as its first line, which is the mitigation — and piping it
through `tail` defeats that, which is how this was found. To migrate the container:

```sh
# The URL is spelled out in apps/worker/.env.example — user effect_ai, password local_dev_only,
# localhost:55433, database effect_ai. Written as parts here because secretlint's connection-string rule
# cannot tell a throwaway local credential from a real one, and the rule is worth keeping armed repo-wide.
DATABASE_URL="$LOCAL_PG_URL" bun run db:migrate
```

Telling them apart afterwards is easy and worth knowing: `db:verify` reports **pgvector 0.8.5** for the
container (ADR-0015 pins it) and **0.8.6** for Neon.

**Anything a browser can do before hydration, it will — and the console's forms did all three.** The
server sends real, typeable, submittable HTML; for the window before the bundle runs, React is not
involved. Three distinct failures came out of that one window, and each looked like something else:

- **A typed value is discarded.** A controlled input takes its value from form state, so on hydration React
  re-renders it from a state that is still empty. Typing early means watching the field clear.
- **A submit leaks the password into the URL.** With no React handler to call `preventDefault`, the browser
  submits the form itself — and a form with no `method` submits as GET, so every field is appended to the
  URL, into history and into every access log in front of the app.
- **A button silently does nothing.** `Sign out` is an `onClick` and nothing else, so a click before
  hydration leaves somebody believing they signed out when they did not.

The fix is one hook, `useHydrated`, and disabling controls until it is true — plus `method="post"` on the
form as insurance that cannot be defeated by another entry point. Gate a control when its pre-hydration
behaviour is a _silent_ no-op with consequences; do not gate content, which would throw away the SSR.

**This is also why the e2e suite found them: Playwright types faster than a bundle loads.** The first
version raced hydration by accident and the symptom was a sign-in that did nothing at all, with no failed
request to look at. The gate is the cure and also the test signal: Playwright waits for a control to be
enabled, so `disabled={!hydrated}` turns "hydrated" into something a test waits on rather than sleeps
through. Never put a `waitForTimeout` in its place — it hides the bug and re-introduces the race.

**The browser suite has the same two prerequisites as `wrangler dev`:** the compose Postgres, and
`CLOUDFLARE_API_TOKEN` in a non-interactive environment, because it boots the API and the `ai` binding has
no local emulation. CI gates the job and prints a warning, for the same reason the `worker` project is
gated. `E2E_BASE_URL` points the same specs at a deployed environment instead.

**`Schema.TaggedError` is an `Error` whose `.message` is usually empty.** `failure.message` compiles and
records a blank string. Lead with `_tag`.
