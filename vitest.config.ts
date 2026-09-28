import { defineConfig } from "vitest/config"

/**
 * Two projects, split by what they need rather than by where they live.
 *
 * `@cloudflare/vitest-pool-workers` is deliberately NOT used: its latest release requires
 * vitest ^4.1, while `@effect/vitest` requires >=5 <6 — mutually exclusive. Worker tests
 * instead drive real `workerd` through wrangler's `createTestHarness`, which is arguably
 * higher fidelity anyway: the real Worker, real bindings, real Postgres, over real HTTP.
 */
export default defineConfig({
  test: {
    projects: [
      {
        // Pure domain and use-case tests. No bindings, no database, no network, no API key.
        // This is where most of the value is, and it is fast enough to run on every save.
        test: {
          name: "domain",
          include: [
            "packages/modules/*/domain/test/**/*.test.ts",
            "packages/modules/*/use-cases/test/**/*.test.ts",
            "packages/api/test/**/*.test.ts"
          ],
          environment: "node"
        }
      },
      {
        // Table tests: real Postgres, real RLS policies, real non-superuser role. Pure
        // domain tests stay in the `domain` project, which needs no infrastructure at all.
        test: {
          name: "tables",
          include: ["packages/modules/*/tables/test/**/*.test.ts"],
          environment: "node",
          testTimeout: 30_000,
          hookTimeout: 30_000
        }
      },
      {
        // Integration tests that boot a real Worker. Slower, needs the compose.yaml Postgres.
        test: {
          name: "worker",
          include: ["apps/worker/test/**/*.test.ts"],
          setupFiles: ["apps/worker/test/setup.ts"],
          environment: "node",
          testTimeout: 60_000,
          hookTimeout: 60_000
        }
      }
    ]
  }
})
