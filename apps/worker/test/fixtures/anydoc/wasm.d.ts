/**
 * A `.wasm` import is a `WebAssembly.Module`.
 *
 * wrangler compiles the module at build time and hands the Worker the compiled object, which is why
 * `initSync` can take it directly and why no `fetch` is involved. TypeScript does not know that, so the
 * shape is declared here.
 */
declare module "*.wasm" {
  const module: WebAssembly.Module
  export default module
}
