# Run the browser suite against a build, not a cold dev server

Status: ready-for-agent

## Why this is logged rather than fixed

Two CI timeouts in one hour, each in a different spec, each fixed by raising a different budget:

| spec        | symptom                                                                | raise                              |
| ----------- | ---------------------------------------------------------------------- | ---------------------------------- |
| `auth.spec` | first `signIn` took 8.7 s against the 5 s expect default               | `toBeVisible({ timeout: 30_000 })` |
| `chat.spec` | `locator resolved to <button disabled>` — hydration unfinished at 30 s | CI-only `timeout: 90_000`          |

Both raises are defensible on their own and neither is the real fix. **If a third spec surfaces, the answer
is not a third raise.**

## The actual cause

`playwright.config.ts` runs `bun run --filter @ea/console dev`, and its own comment says a cold start
"compiles the console and boots two workerd instances". So:

- `vite dev` compiles each route the **first time it is visited**, and CI is always cold. The first visit to
  `/`, `/login` and `/chat` each pay a one-off cost no later visit pays.
- The suite is therefore paying a **dev-server** cost to test **production** behaviour. Nothing it asserts —
  cookies, redirects, SSR payload contents, the hydration gate — depends on the dev server.

Note what the chat failure actually showed: `disabled={!hydrated}` working exactly as designed. The gate
exists so a click before hydration cannot be a silent no-op, and Playwright's actionability wait turns
"hydrated" into something a test waits ON. That is the suite's most valuable property and it is the one most
sensitive to compile latency, which is the wrong thing for it to be sensitive to.

## What to do

`E2E_BASE_URL` already exists for exactly this: set it and the config omits `webServer` entirely (spread
rather than `webServer: undefined`, because `exactOptionalPropertyTypes` makes those different things). So:

1. In CI, `bun run --filter @ea/console build` (already a step), serve the output, and point `E2E_BASE_URL`
   at it. A built console compiles nothing on demand.
2. Then **drop both raises** and see whether the defaults hold. If they do, the budgets go back to being a
   statement about the product rather than about vite.
3. Keep the dev-server path for local runs, where a warm server is the normal case and `vite dev` is what a
   developer is actually editing against.

The open question is what serves the build — Workers Assets through `wrangler dev` is closest to production
and keeps the API on the same origin, which is the topology the suite is testing. Worth checking that the
built console's route tree and the API's `BASE_URL` agree before assuming it is a drop-in.

## Do not

Replace a wait with `waitForTimeout`. AGENTS.md is explicit: a fixed sleep is how the original hydration
race got masked, and the gate is both the cure and the test signal.
