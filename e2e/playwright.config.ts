/**
 * End-to-end tests: a real browser, against the real pair of Workers.
 *
 * What this tier exists to catch is everything the other four cannot. The unit suites run the domain and
 * the stores; the `worker` suite boots the API and asserts on responses. None of them can observe the thing
 * the console's auth actually rests on — that a cookie set by one Worker is read by another on the next
 * request, that a redirect thrown in `beforeLoad` happens before any HTML is sent, and that what arrives in
 * the browser contains what it should and nothing more. Those are properties of the deployed TOPOLOGY, and
 * the only honest way to check them is to drive a browser through it.
 *
 * Every failure this suite is written against has already happened here at least once: a 403
 * INVALID_ORIGIN on a deployed sign-up, a session cookie without `Secure`, and a console whose service
 * binding was simply absent locally.
 */
import { defineConfig, devices } from "@playwright/test"

/**
 * Where to point the browser.
 *
 * Unset means the local stack, which this config starts itself. Set means somewhere already running —
 * `E2E_BASE_URL=https://effect-ai-console-staging.ishak-f45.workers.dev` runs the same specs against
 * staging after a deploy, which is the one place the real cookie attributes (`__Secure-` and `Secure` over
 * https) can be observed at all. The specs are written to pass in both, so nothing here is local-only.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173"

export default defineConfig({
  testDir: "./tests",
  /*
   * Serial, deliberately, against a shared Postgres.
   *
   * These tests sign users up, and the API is one database with one `user` table. Running them in parallel
   * would be fine today and would rot the moment a spec asserts on a list — which is the direction this
   * suite grows (a queue with fixture decisions in it). A four-test suite has nothing to gain from the
   * concurrency and everything to lose from a race that only shows up in CI.
   */
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  /*
   * No retries, including in CI.
   *
   * The conventional `retries: 2` is wrong for this suite specifically: there is no external network here
   * and nothing is slow, so the realistic flake is a genuine race in exactly the sequence under test —
   * sign in, set a cookie, resolve the session on the next request. A retry would turn the one bug this
   * suite is best placed to find into a green run with a note nobody reads.
   */
  retries: 0,
  /*
   * 90 s a test in CI, against Playwright's 30 s default — and the budget is for a COLD DEV SERVER, not for
   * slow code.
   *
   * The suite runs against `vite dev`, which compiles each route the first time it is visited and then
   * server-renders it in workerd. So the first visit to `/`, to `/chat` and to `/login` each pay a one-off
   * cost that no later visit pays. Two separate specs hit the 30 s default in CI within an hour: the first
   * `signIn` took 8.7 s against a 5 s expect default, and the chat spec — which opens TWO tabs on a route
   * nothing had compiled yet — timed out with the Create button still `disabled`, meaning hydration had not
   * finished.
   *
   * That second symptom is worth reading carefully rather than treating as slowness: `disabled={!hydrated}`
   * exists so a click before hydration cannot be a silent no-op, and Playwright's actionability wait turns
   * it into something a test waits ON. The gate working as designed is what surfaced here; the budget was
   * simply smaller than a cold compile.
   *
   * Raised rather than papered over with `waitForTimeout`, which AGENTS.md forbids here — a fixed sleep is
   * how the original hydration race got masked. Local runs keep the default, because a developer's dev
   * server is usually warm and a 90 s ceiling would make a genuine hang feel like a slow test.
   */
  ...(process.env.CI === undefined ? {} : { timeout: 90_000 }),
  reporter: process.env.CI !== undefined ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL,
    // On the first failure only. A trace per run is a large artifact for a suite that usually passes.
    trace: "retain-on-failure"
  },
  /*
   * Chromium alone. This suite tests a topology, not rendering: cookies, redirects and what the SSR
   * payload contains behave identically across engines, so a second browser would triple the runtime to
   * re-assert the same three facts. Add one when a spec is about layout or an engine-specific API.
   */
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  /*
   * Boots the console's dev server, which boots the API as an auxiliary Worker — one command for both,
   * and the same service-binding topology as the deploy.
   *
   * Skipped entirely when `E2E_BASE_URL` is set, because then the target is already running.
   *
   * Two prerequisites, and both fail loudly rather than quietly: the compose Postgres must be up (the API
   * refuses to start without a local Hyperdrive connection string), and `CLOUDFLARE_API_TOKEN` must be
   * present in a non-interactive environment, because the API's `ai` binding has no local emulation and
   * forces wrangler into a remote runtime. That second one is why CI gates this suite, exactly as it gates
   * the `worker` vitest project.
   */
  /*
   * SPREAD rather than `webServer: undefined`.
   *
   * `exactOptionalPropertyTypes` is on, so an explicitly-undefined optional property is a type error and
   * not a synonym for an absent one — which is the point of the flag: "no dev server" and "a dev server I
   * could not describe" should not be the same value.
   */
  ...(process.env.E2E_BASE_URL === undefined
    ? {
      webServer: {
        command: "bun run --filter @ea/console dev",
        url: baseURL,
        // A cold start compiles the console and boots two workerd instances; 60s is not generous.
        timeout: 120_000,
        // Locally, reuse whatever is already on the port instead of fighting it for the socket.
        reuseExistingServer: process.env.CI === undefined,
        stdout: "pipe" as const,
        stderr: "pipe" as const
      }
    }
    : {})
})
