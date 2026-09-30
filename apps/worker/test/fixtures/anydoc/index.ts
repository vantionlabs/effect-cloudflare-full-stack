/**
 * Does `@firecrawl/anydoc-wasm` initialise and parse inside `workerd`?
 *
 * The plan's tier-2 parser rests on it, and the claim was never tested — the same status
 * `cloudflare:sockets` had before milestone 0 (ADR-0009) and the Workflows step memo had before its probe.
 * Two things could plausibly fail and neither is visible from reading the package:
 *
 * - **the wasm has to reach the runtime as a module.** wasm-bindgen's default `init()` does
 *   `fetch(new URL('anydoc_wasm_bg.wasm', import.meta.url))`, which has no meaning in a Worker. `initSync`
 *   taking a `WebAssembly.Module` is the path, and whether wrangler hands us one for a `.wasm` import from
 *   `node_modules` is exactly the sort of thing to find out by running it.
 * - **startup time is capped at 1 second** for a Worker's global scope, and this module is 6.38 MiB. So it
 *   is initialised LAZILY, on first use, and the probe reports how long that took.
 */
import init, { formatFromBytes, formatFromExtension, initSync, toMarkdownBytes } from "@firecrawl/anydoc-wasm"
import wasmModule from "@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm"

// Referenced so the unused default import cannot be dropped, and to document that it is the WRONG entry
// point here: it fetches a URL. `initSync` is what a Worker can use.
void init

let ready = false
let initMillis = 0

/** Compiles the module once per isolate, on first use rather than at module scope. */
const ensureReady = () => {
  if (ready) return
  const started = Date.now()
  initSync({ module: wasmModule })
  initMillis = Date.now() - started
  ready = true
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname !== "/parse") return new Response("not found", { status: 404 })

    const extension = url.searchParams.get("ext") ?? ""
    const bytes = new Uint8Array(await request.arrayBuffer())

    try {
      ensureReady()
      const sniffed = formatFromBytes(bytes)
      const format = sniffed ?? formatFromExtension(extension)
      const started = Date.now()
      const markdown = toMarkdownBytes(bytes, format)
      return Response.json({
        ok: true,
        initMillis,
        parseMillis: Date.now() - started,
        sniffed: sniffed ?? null,
        format: format ?? null,
        markdown
      })
    } catch (cause) {
      return Response.json({ ok: false, error: String(cause) }, { status: 500 })
    }
  }
} satisfies ExportedHandler
