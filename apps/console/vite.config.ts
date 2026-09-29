/**
 * The reviewer console: a client-rendered app, served by the Worker as static assets.
 *
 * **One deploy, two packages.** ADR-0001 keeps a single Worker — one origin, one auth seam, no CORS, assets
 * served before the Worker runs. That does not require a single *package*, and the plan conflated the two.
 * Here the console builds to static assets that `apps/worker`'s `assets` binding serves, so the deploy stays
 * single while the type environments stay apart.
 *
 * Client-rendered rather than SSR, deliberately. SSR is what forced one package: TanStack Start insists on
 * owning the Worker entry, so the Effect router and the SSR handler had to live in one build. For an
 * internal tool behind a login there is no SEO and no first-paint pressure on a queue grid that cannot
 * render before auth resolves, so SSR was paying a real architectural cost for nothing. It is recoverable
 * later — the routes are unchanged by it.
 */
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true })
  ],
  build: {
    // Where apps/worker's `assets` binding looks. Kept explicit so the two cannot drift silently.
    outDir: "dist"
  },
  server: {
    // `vite dev` proxies the API to `wrangler dev`, so the console is developed against the real Worker
    // rather than a mock — the same reason the tests drive real workerd.
    proxy: {
      "/api": "http://localhost:8799",
      "/auth": "http://localhost:8799"
    }
  }
})
