# Bridging a dependency across Effect v4 RCs

Written after attempting to make Alchemy `2.0.0-beta.79` work on `effect@4.0.0-rc.118`.
The attempt **failed for a reason worth knowing**, and the technique is reusable, so both
are recorded here.

## The technique

### 1. Audit before patching

Do not discover breakage one import at a time. `scripts/audit-effect-imports.ts` enumerates
every `effect/*` specifier a package uses and tries to resolve each against the _installed_
Effect, printing only the failures:

```bash
bun scripts/audit-effect-imports.ts node_modules/<pkg>
# -> "116 distinct effect specifiers, 2 unresolvable"
```

This turns an unknown number of whack-a-mole rounds into one list.

### 2. Know that there are two kinds of rename

Between rc.117 and rc.118 **both** happened:

| Kind                                        | Example                                      | Fix                             |
| ------------------------------------------- | -------------------------------------------- | ------------------------------- |
| The `unstable/` prefix was dropped          | `effect/unstable/http` → `effect/http`       | mechanical `sed`                |
| Top-level modules moved into subdirectories | `effect/Encoding` → `effect/encoding/Base64` | needs a shim or call-site edits |

And one path is **not** a prefix strip: `effect/unstable/httpapi` → `effect/http-api`
(hyphenated). It must be rewritten _before_ the generic rule, or it becomes `effect/httpapi`,
which does not exist.

```bash
find src -type f -name "*.ts" -print0 | xargs -0 sed -i '' \
  -e 's|effect/unstable/httpapi|effect/http-api|g' \
  -e 's|effect/unstable/|effect/|g'
```

Deep imports survive: rc.118's `./*` wildcard export means `effect/http/HttpBody` resolves
even though only `./http` is named explicitly.

### 3. Prefer a shim to rewriting call sites

For a split module, aliasing keeps the patch small and reviewable:

```ts
import * as Base64 from "effect/encoding/Base64"
import * as Base64Url from "effect/encoding/Base64Url"
const Encoding = {
  encodeBase64: Base64.encode,
  decodeBase64: Base64.decode, // still Result<Uint8Array, EncodingError>
  encodeBase64Url: Base64Url.encode
}
```

**Verify the signatures actually match** before shimming — a changed return type would be a
silent behavioural difference rather than a compile error. Here `decode` returned
`Result<Uint8Array, EncodingError>` in both, and call sites already used `Result.isSuccess`.

### 4. The `bun patch` relink gotcha

`bun patch --commit` regenerates `patches/*.patch` but leaves `node_modules/<pkg>` as a real
directory **without its dependency symlinks**, so the package then fails on its first
transitive import (`pathe`, `@alchemy.run/cloudflare-runtime`, …). It also resets your edits
in that directory. The fix is a clean reinstall that forces Bun to apply the patch to a fully
linked copy:

```bash
rm -rf node_modules/<pkg> node_modules/.bun/<pkg>@* node_modules/.bin/<pkg>
bun install
```

## Why the Alchemy attempt failed

Patching Alchemy's own source worked — 224 files, and the audit went to zero unresolvable.
It was **insufficient**, because:

1. Alchemy's _transitive_ dependencies import `effect/unstable/*` too: eleven
   `@distilled.cloud/*` packages plus four `@alchemy.run/*`. **`@distilled.cloud/aws` alone
   is 1,323 files.**
2. The real problem is not missing renames, it is **version mixing**. Both
   `effect@4.0.0-rc.117` and `rc.118` end up installed: the `@distilled.cloud/*` packages
   resolve rc.117, our app resolves rc.118, and Bun's hoisting decides per-package which one
   a given file sees. Patching cannot fix that — a package patched for rc.118 still breaks
   when it resolves rc.117, and vice versa.

Isolating Alchemy in its own workspace pinned to rc.117 was also tried, and failed the same
way: `@effect/platform-bun@rc.117` pulled `@effect/platform-node-shared@rc.118`, which then
looked for rc.118 paths inside an rc.117 resolution.

**Conclusion: patch a leaf dependency, not a tool with its own deep Effect-based dependency
tree.** The cost is not the file count, it is that every package in the tree must agree on
one Effect version — which is a resolution problem, not a source problem.

## What to do instead

Either pin the whole repo to the Effect version the tool expects (uniform resolution, no
patch needed at all), or use the tool's alternative (here: `wrangler.jsonc`, which is already
declarative infrastructure in git) and adopt it once it targets your version.

Re-check with one command when a new Alchemy ships:

```bash
bun add -D alchemy@latest && bun scripts/audit-effect-imports.ts node_modules/alchemy
```

Zero unresolvable, with only one `effect@*` in `node_modules/.bun/`, means it is safe to adopt.
