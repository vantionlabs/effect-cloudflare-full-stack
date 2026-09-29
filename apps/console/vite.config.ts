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
import { defineConfig } from "vite"

export default defineConfig({
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
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    viteReact(),
    tailwindcss()
  ]
})
