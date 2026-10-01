/**
 * The console, as a TanStack Start app on a Cloudflare Worker.
 *
 * It was a static SPA on Pages until now. The move to Start is what buys **server-side auth**: a route
 * can be refused before any HTML is sent, rather than rendering a shell and then discovering on the
 * client that there is no session. That is the difference between a guard and a flicker.
 *
 * Plugin order is not arbitrary — it is the order Cloudflare's own framework guide specifies:
 * `cloudflare` first, declaring the SSR environment it owns, then `tanstackStart`, then React.
 *
 * `viteEnvironment: { name: "ssr" }` is what tells the Cloudflare plugin which Vite environment runs in
 * workerd. Without it the SSR pass runs in Node and the bindings are absent, which fails as a missing
 * `env` rather than as a configuration error.
 */
import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"
import { defineConfig, type Plugin } from "vite"

/**
 * `cloudflare:workers` resolves, in the CLIENT environment only, to an empty stub.
 *
 * `rpc.ts` and `auth/auth-client.ts` reach the API binding through `createIsomorphicFn`'s server branch, which
 * imports `cloudflare:workers`. That branch never runs in a browser — but TanStack Start's server-function lookup
 * (`?server-fn-module-lookup`) transforms the modules a server function imports for the client environment WITHOUT
 * stripping that branch, and Vite then cannot resolve `cloudflare:workers` there. Both files returned 500 under the
 * lookup; the browser's client entry failed to load and the page never hydrated. It looked like a cold-start flake
 * and was blamed on the dependency optimizer for longer than it should have been: it began when server-function
 * modules started importing `rpc.ts`.
 *
 * The stub only has to make the client graph RESOLVE. Nothing in it is ever executed: the server branch is the only
 * importer, and it does not run outside the Worker. The SSR environment is untouched and gets the real module.
 */
const cloudflareWorkersClientStub = (): Plugin => ({
  name: "effect-ai:cloudflare-workers-client-stub",
  enforce: "pre",
  resolveId(id) {
    if (id === "cloudflare:workers" && this.environment.name === "client") return "\0cloudflare-workers-client-stub"
    return undefined
  },
  load(id) {
    return id === "\0cloudflare-workers-client-stub" ? "export const env = {}\n" : undefined
  }
})

export default defineConfig({
  build: {
    /*
     * Empty `dist` on every build, EXPLICITLY.
     *
     * Vite's default would normally do this for an outDir inside the root, and here it does not — the Cloudflare
     * plugin writes the Worker bundles alongside the client one and the directory survived. Content-hashed assets
     * then accumulate, so `bun run bundle:check` scanned files from earlier builds and reported a leak that had
     * already been fixed. A stale artefact is worse than a missing one: it makes a check lie.
     */
    emptyOutDir: true
  },
  /*
   * `@/` for this app's own src.
   *
   * shadcn/ui generates components importing `@/lib/utils` and `@/components/ui/*`, so the alias is not
   * optional once its registry is used — and having it means a route three directories deep imports
   * `@/auth/SignIn.ts` rather than counting `../`. Mirrored in tsconfig so tsc and the bundler agree.
   */
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  plugins: [
    cloudflareWorkersClientStub(),
    cloudflare({
      viteEnvironment: { name: "ssr" },
      /*
       * The API, so the `API` service binding RESOLVES locally.
       *
       * Without this the console's own dev server starts happily and `env.API` is simply absent, so the
       * first sign-in throws inside the isomorphic fetch rather than reporting a missing binding — the
       * console was in exactly that state from the moment it stopped being a Pages project with a vite
       * proxy and became a Worker with a service binding.
       *
       * An auxiliary Worker is not exposed on its own port: every request reaches it through this entry,
       * which is the same topology as the deployed pair. So the browser has ONE origin locally too, and
       * `localhost:5173` is what the API must be told it is (see apps/worker/.env.example).
       *
       * `wrangler deploy` ignores this: it deploys only the entry Worker, and the API is deployed from
       * its own directory — first, because the console's binding needs it to exist. See deploy.yml.
       */
      auxiliaryWorkers: [{ configPath: "../worker/wrangler.jsonc" }]
    }),
    tanstackStart(),
    viteReact(),
    tailwindcss()
  ]
})
