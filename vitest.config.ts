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
            "packages/modules/src/*/domain/test/**/*.test.ts",
            "packages/modules/src/*/use-cases/test/**/*.test.ts",
            "packages/api/test/**/*.test.ts",
            /*
             * The capability packages (ADR-0021). Their tests belong here rather than in `tables` because they
             * need nothing: `RoomProtocol` is arithmetic over attachments, tested against three-line fakes, which
             * is the whole reason that logic was lifted out of the Durable Object class.
             */
            "packages/{domain,database,realtime}/test/**/*.test.ts",
            "packages/integrations/*/test/**/*.test.ts"
          ],
          environment: "node"
        }
      },
      {
        // Table tests: real Postgres, real pgvector, real Dutch stemming, real SQL. Pure domain
        // tests stay in the `domain` project, which needs no infrastructure at all. (This used to
        // say "real RLS policies, real non-superuser role"; RLS was removed in ADR-0014, and the
        // tenant predicate is now enforced statically by `scripts/boundaries.ts` instead.)
        test: {
          name: "tables",
          include: ["packages/modules/src/*/tables/test/**/*.test.ts"],
          // Migrate once, before any file. Without this every database test depends on whichever file
          // happened to call `migrate` having sorted first — and the failure looks like a bad query.
          globalSetup: ["packages/modules/src/shared/tables/test/migrate.setup.ts"],
          environment: "node",
          testTimeout: 30_000,
          hookTimeout: 30_000
        }
      },
      {
        // The eval harness's own fixtures. The labelled set is generated code, and a generator whose
        // spans do not occur in the document it printed would make every downstream number a
        // measurement of that bug — so the properties the harness rests on are asserted here, where
        // they cost milliseconds, rather than discovered as a suspiciously bad grounded rate.
        test: {
          name: "evals",
          include: ["evals/test/**/*.test.ts"],
          environment: "node"
        }
      },
      {
        // The browser ring. jsdom is not needed: the interesting logic is the span locator, which is pure,
        // and testing it directly beats rendering a component to assert a string offset.
        test: {
          name: "console",
          include: ["apps/console/test/**/*.test.tsx"],
          environment: "node"
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
