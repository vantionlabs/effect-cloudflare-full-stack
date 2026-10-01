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

**Every package keeps its source under `src/`, with `test/` beside it.** So `packages/domain/src/Identity/`,
`packages/api/src/v1/`, `packages/modules/src/chat/`. The exports map is `"./*": "./src/*/index.ts"`, which
keeps the import path unchanged — `@ea/domain/Identity`, never `@ea/domain/src/Identity` — so `src/` is a
layout fact and not something a caller has to know.

Two places tests live, and the rule is which code they sit beside:

- **A package-level `test/`, beside `src/`**, when the package is one thing: `packages/realtime/test/`,
  `packages/domain/test/`, `packages/api/test/`.
- **Nested inside the ring**, when the package holds many slices: `packages/modules/src/chat/tables/test/`.
  A ring is the unit that gets tested, so the tests travel with it rather than being hoisted away from it.

`tsconfig.src.json` includes `src/**/*.ts` and excludes `**/test/**`; `tsconfig.test.json` includes
`**/test/**/*.ts`, which catches both shapes without naming either. **`rootDir` stays the package**, not
`src`, because both trees live under it.

One consequence worth knowing before editing `scripts/boundaries.ts`: its rules key on the package prefix
(`packages/modules/`) so they still cover `test/`, but `sliceOf` and `ringOf` read POSITIONAL segments, so
they carry a `SRC` offset. That offset is the only place in the script that knows `src/` exists.

**`packages/` and `apps/worker/`: PascalCase, filename = exported symbol. No dots.** Concept folders are
PascalCase, rings are lowercase. Paths below are shown relative to a package's `src/`.

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

### How `apps/console/src` is organised

```
routes/              THIN. createFileRoute + guard/loader + <HydrationBoundary><FeaturePage/></…>. No markup.
features/<feature>/  everything one area of the product needs, and nothing another area needs
  api/               RPC atoms (`*-atoms.ts`) and SSR loaders (`load-*-page.ts`)
  components/        the feature's own pieces, one component per file
  <feature>-page.tsx the page, composed from its components and the shared ones below
components/
  layout/            app-shell, app-sidebar, page (Page, PageHeader, PageSection, Panel)
  data/              data-table, stat, status-pill
  feedback/          notice
  ui/                shadcn primitives (input, label, field, card, separator) — vendored
  atoms/, primitives/ Beautiful UI — vendored, see below
lib/                 format (money, quantities, days), failure (tagged error → sentence), utils (cn)
hooks/  rpc/  realtime/  styles/
```

**A feature never imports another feature**, with one exception: `features/auth/api` is the session, which the
shell and hooks need. Something two features share moves to `components/` or `lib/` — that is the signal it is
shared, not a reason to reach sideways.

**Loaders import atoms DYNAMICALLY**, inside the server function's handler. A static import of the atom or RPC
graph from a `createServerFn` module makes the TanStack compiler fail with "could not load module info for
src/rpc/client.ts" on a cold dev server — the hydration failures that were blamed on Vite's optimizer.

**Beautiful UI** (`https://www.beautifului.dev`, MIT) is the design system: its tokens in `app/beautifui/foundation.css`
and the components in `components/atoms` and `components/primitives`, installed with
`bunx shadcn add @beautifui/<name>` (the registry is named in `components.json`). Those files keep the registry's
PascalCase names and paths so `--overwrite` can update them; they are the one exception to kebab-case here. Two
things to know before adding more:

- Most of its components are showcase pieces with **fixed data shapes** (`RecordsTable` rows are a CRM record,
  `ChatComposer` replays scripted messages, `ToolChips` reveals steps on a timer and falls back to demo diffs). Use
  the ones whose shape fits honestly — today `Button`, `ValuePill`, `ContextCards` (citations) and `LoadingState` —
  and build tables and forms from `components/data` in the same style. Only what is imported is kept; add others
  with `shadcn add` when a screen needs them.
- `@beautifui/sidebar-nav` imports `@central-icons-react`, a **paid** icon set, and hardcodes a demo workspace.
  `components/layout/app-sidebar.tsx` is our own, with lucide.

`foundation.css` carries two LOCAL PATCHes (an orphaned `}` that broke the build, and a global `:focus-visible`
radius that squared off focused pills); re-check both after any `--overwrite`. `shadcn add` prompts before
overwriting it — answer no (`yes n | bunx shadcn add …`). Vendored components we changed carry `LOCAL CHANGE`
comments, and their optional props were widened with `| undefined` for `exactOptionalPropertyTypes`. The MIT notice
is `components/BEAUTIFUL-UI-LICENSE`; keep it.

**Their components ship demo data and timers — strip them before use.** The rule: the console never shows invented
content or invented steps. Delete module-level demo constants and make the prop required; delete any
`setTimeout`/`setInterval` that advances a state the server did not report; never let a default label carry a
number or a claim.

**Interface copy is Dutch** (`apps/console/PRODUCT.md`). Money and dates come from `lib/format` (nl-NL); every label,
button, empty state and error sentence is written in Dutch. AI answers follow the language of the question.

**Loading:** server-rendered pages arrive with their data. Anything the BROWSER fetches afterwards shows a skeleton
from `components/feedback/skeleton` shaped like the content — never "Loading…" text and never a spinner in content.

**Motion** lives in `lib/motion` (`enter`, `popIn`, `superseded`), `components/motion` (`Collapsible`,
`RollingDigits`) and `hooks/use-stick-to-bottom`, taken from Beautiful UI's site: CSS keyframes, two curves, no
library. Motion conveys state (arrived, stale, opened); it never decorates a page at rest, and it starts from a
visible default so SSR content is never hidden waiting for JavaScript.

**Theme:** `lib/theme` — a head script sets `.dark` before first paint; the choice lives on the account page.

## What stays in `apps/worker`

The app is an entrypoint. Eight files, and each one is there for a reason that survives the question "could this
be a module?":

| File                            | Why it cannot move                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Main.ts`                       | the composition root. The only file that reads `env.*`                                                      |
| `platform/Bindings.ts`          | the `Env` declaration. Names adapters' binding TYPES, which is the inversion that lets them live in modules |
| `platform/CloudflareSocket.ts`  | imports `cloudflare:sockets`                                                                                |
| `platform/HyperdriveConnect.ts` | builds the driver over that socket and the Hyperdrive binding                                               |
| `platform/QueueHandler.ts`      | queue batch semantics — ack/retry per message, which is a platform contract                                 |
| `platform/DispatchEvent.ts`     | wiring: names every slice's handler                                                                         |
| `platform/WorkerPlatform.ts`    | the layer bundle                                                                                            |
| `RoomDurableObject.ts`          | a `DurableObject` subclass must be exported from the entry and declared in `exports`                        |

**The rule: platform glue stays, everything else moves.** Glue is code that needs a runtime global (`WebSocketPair`,
`DurableObjectState`) or a platform module (`cloudflare:sockets`), or that composes. An adapter that takes its
binding as a parameter is not glue — it is a `server`-ring implementation of a port, and it belongs in the slice
that owns the port. `packages/modules` compiles with `types: []` precisely so that platform globals cannot be
ambient there, which is what makes this line enforceable rather than a matter of taste.

Five adapters and a whole slice moved out under this rule: `CacheKv`, `IdsUuid`, `QueueBus` and `TelemetryOtlp` to
`shared/server`, `TelemetryAnalytics` to `decision/server` (it names that slice's port), and `GetHealth` to
`shared/use-cases` with its transport edge in `packages/api`. The last one needed a design fix first: the use case
returned `HealthV1`, a WIRE type, so it could only live in the app — `dep:check` forbids modules from importing
`@ea/api`. It returns a domain `HealthReport` now and the edge maps it, which is what every other slice does.

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

**`bun run preflight` does NOT include the retrieval gate — and the reason written here was wrong.**
`bun run evals:retrieval` is a separate command because it needs Workers AI credentials, real embedding calls
**and the compose Postgres**, and CI runs it conditionally on `CLOUDFLARE_AI_TOKEN` with a loud warning when
skipped. Run it deliberately, and treat a failure as a retrieval-quality finding rather than a broken build.

This note used to say it was excluded because "the Workers AI account has no neurons — a gate nobody can pass
stops being read". **Measured 2026-09-30: the retrieval gate is nearly free and it passes.** It imports no
language model at all — only `EmbedderWorkersAiRest` — and `@cf/baai/bge-m3` costs **0.02 neurons a call**:
52 embedder calls across the gateway's whole history total **0.05 neurons**, against a 10,000/day allocation.
It ran clean on the gold set: **lexical 84.6%, hybrid 100.0% at k=3**, beating or matching the LangChain
splitter at every chunk size and beating it badly above 150.

What IS expensive is `bun run evals`, the decision eval, which makes several language-model calls per case at
roughly **47 neurons an uncached call**. Conflating the two made a cheap gate look unpassable and left
retrieval quality unmeasured for longer than it needed to be. Numbers and dates in `docs/references.md`.

**`preflight` does not include `test:e2e` either**, for the related reason that it needs a running Postgres
container and a Cloudflare token — `preflight` should stay runnable on a laptop with nothing started. Run it
when you touch the console's auth, routing or forms, which is precisely where it has already earned its
keep.

**An undeclared workspace dependency resolves on your machine and fails in a fresh install.** Bun hoists
workspace packages to the root `node_modules`, so any package can import any other whatever its manifest says
— and nothing in `preflight` noticed: `tsc` follows the same hoisted paths, `knip` reports the opposite
direction (declared and unused), and `syncpack` checks versions rather than presence. It surfaced as a
**rolldown resolution error during the console build in CI**, where `apps/worker` imported `@ea/domain`
without declaring it. `bun run deps:workspace` is the check, and it is in `hygiene`.

**Four things made the gates pass locally and fail on a clean machine, and all four had the same
shape: a developer machine holds state a fresh one does not.** A green `bun run preflight` is therefore
evidence about this machine, not about the code. They were a generated file that was already on disk,
a `node_modules` link left by an earlier install, cached `wrangler login` credentials, and a workspace
dependency that only the hoisted layout satisfied. When a gate
disagrees with CI, suspect local state before suspecting CI.

**Everything emulates locally except Workers AI, and `env.dev` is the REMOTE target.**
Worth stating because the opposite is a reasonable guess, and because it decides where `env.dev` earns its
keep:

| product         | `wrangler dev`        | how                                                                             |
| --------------- | --------------------- | ------------------------------------------------------------------------------- |
| KV, R2, Queues  | emulated              | miniflare; the bound production ids are never touched                           |
| Durable Objects | real `workerd`        | locally, including the Agents SDK's                                             |
| Workflows       | emulated              | the local engine — a probe's `status()` answers with `__LOCAL_DEV_STEP_OUTPUTS` |
| Hyperdrive      | the compose container | `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_*` in `apps/worker/.env`         |
| **Workers AI**  | **NOT emulated**      | always remote, which is the trap below                                          |

So `bun run dev` plus `docker compose up` exercises the whole stack bar one binding, and the 92 tests in the
`worker` project are the proof rather than the claim.

**`bun run --filter @ea/worker dev:remote`** is `wrangler dev --remote --env dev`, and it is a different
thing: it runs against the REAL products with `env.dev`'s own throwaway resources — its Neon project, KV
namespace, R2 bucket and Hyperdrive pair. Reach for it when the question is "does this binding behave the way
the emulator says", which is the question `cloudflare:sockets` (ADR-0009) and the Workflows step memo were
both probed for. Plain `wrangler dev` binds the TOP-LEVEL config, which is production — harmless while
everything is emulated, and exactly why `--env dev` matters the moment `--remote` is involved.

One caution: `env.dev`'s Neon project is also what `DATABASE_URL` points at, so `bun run db:migrate` with no
override migrates THAT and not the container. See the trap about two databases below.

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

**CI builds the console with `cd apps/console && bun run build`, not `bun run --filter`, and the difference
is not style.** The `--filter` form failed once on the GitHub runner with a bare `error: FileNotFound` 30 ms
into the step, before vite printed a line, on a tree whose `preflight` had just passed locally — and the
identical step had passed on the commit before. The string is bun failing to open a file it did not name:
bun's own filter errors are descriptive, and a filtered child's output is always prefixed with the package
name, so an unprefixed error is not vite's. It reproduced nowhere — macOS, a Linux container on the same bun
build and the same package count, a fresh clone of the remote, the same environment variables. Four theories
were tested and discarded rather than shipped as a fix with a story: a grouping directory matched by
`packages/*` with no manifest (a minimal repro of exactly that shape passes ten times out of ten), a stale
workspace path in `bun.lock`, a dangling committed symlink, and the platform. **The cause is still unknown**,
and one green run does not prove `--filter` was at fault rather than something transient — so the step keeps
diagnostics that print if the bare error returns. `--filter` is fine locally and is used everywhere else.

**`bun run hygiene` now needs a built console**, because `bundle:check` reads emitted bytes rather than the
import graph — tree-shaking is the thing being verified, and only the output can answer whether it worked. CI
already builds the console before `check` for the route-tree reason, so the order is right there; locally, run
`bun run --filter @ea/console build` first or the check exits telling you to.

That check found a real leak on its first run: the `Db` seam and the migration manifest shared a barrel, so
`@ea/api`'s `Serve.ts` imported `Db`, the console imported `@ea/api`, and **the browser bundle contained every
`create table` statement in the repo**. The lesson generalises — a barrel is transitive, so a folder that holds
both a seam and something heavy exports the heavy thing to everyone who wants the seam.

**Deploys migrate the database before the code, and a migration must therefore be EXPAND-ONLY.**
`deploy.yml` runs `bun run db:migrate` against each environment's own `DATABASE_URL` secret (the Neon project's
direct connection string) before deploying its Worker — `dev` and `staging` on every green `main`, `production` on
dispatch. For the minutes between the two steps the OLD code runs against the NEW schema, so a migration may add
tables, columns, indexes and functions, but may not drop, rename or tighten anything the running code uses. A
removal is two deploys: stop using it, then drop it. Every migration so far is additive and `if not exists`.

`db:migrate` also refuses to report success unless `effect_sql_migrations` holds every migration in the build's
manifest, and in CI it never falls back to `apps/worker/.env`. Both exist because staging and production sat at
**15 of 25** behind green deploys — the smoke test calls `/health`, which touches none of the missing tables, so
API keys, chat and the Workflow handoff were broken in production with nothing red anywhere.

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
