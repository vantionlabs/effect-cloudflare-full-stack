/**
 * A `.wasm` import is a compiled `WebAssembly.Module`.
 *
 * wrangler compiles the module at BUILD time and hands the Worker the compiled object — which is why the
 * tier-2 parser's `initSync` costs about a millisecond in `workerd` against fifteen in Node, where the
 * compile happens at runtime. TypeScript has no rule for this, so the shape is declared here.
 *
 * Only `apps/worker` may import a `.wasm`: it is a bundler artifact, and `packages/modules` compiles with
 * `types: []` so that platform artifacts cannot be ambient there. The adapter takes the module as an opaque
 * parameter instead, the same inversion every binding uses.
 */
declare module "*.wasm" {
  const module: WebAssembly.Module
  export default module
}
