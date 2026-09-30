/**
 * The browser bundle must not contain server-only code.
 *
 * **This is the assertion ADR-0011 promised and never wrote.** That ADR collapsed eleven packages into one and
 * said, in as many words, that "browser safety now rests on the bundle assertion, not the module graph" — because
 * `better-auth` and `pg` became dependencies of the same package the console imports its wire schemas from. The
 * assertion existed only as a sentence in PLAN.md, so for the whole of that time nothing checked it at all.
 *
 * What it checks is the CLIENT output only. `dist/server` and `dist/effect_ai` are the Worker's own bundles and
 * are supposed to contain all of this; a check that scanned them would fail permanently and be deleted.
 *
 * Matching on strings rather than on the import graph, deliberately. Tree-shaking is what is being verified, and
 * only the emitted bytes can answer whether it worked — a graph check would be re-deriving the bundler's own
 * decision and would pass while the output was wrong.
 *
 * **It depends on the build emptying `dist`**, which `apps/console/vite.config.ts` now sets explicitly. Without
 * that, content-hashed leftovers from an earlier build stay on disk and this check reports a leak that was already
 * fixed — which happened while negative-testing it. The first attempt at a fix was a staleness detector here;
 * duplicate chunk base names turned out to be legitimate (three routes compile to `_authenticated-*.js`), so the
 * heuristic cried wolf and the real fix belonged in the build.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const CLIENT_DIR = new URL("../apps/console/dist/client", import.meta.url).pathname

/**
 * What must not reach a browser, and why each one matters.
 *
 * The needles are chosen to be things that only appear if the module really was included — a package's own
 * internal strings rather than its name, which could appear in a comment or a source map path.
 */
const FORBIDDEN = [
  /*
   * OUR OWN server SQL, which is the strongest needle available: these strings can only appear if a `tables`
   * ring was bundled, and no third-party package will ever coincidentally contain them.
   *
   * This is what the check caught on its first run. The `Db` seam and the migration manifest shared a barrel, and
   * a barrel is transitive — so `@ea/api`'s `Serve.ts` imported `Db`, the console imported `@ea/api`, and the
   * browser shipped every `create table` in the repo. Fixed by giving migrations their own concept folder.
   */
  {
    needle: "create table if not exists",
    because: "a table definition in the browser means a `tables` ring was pulled in — usually through a barrel " +
      "that exports both a seam and a migration manifest"
  },
  {
    needle: "set local role",
    because: "the tenancy scoping from `Db.scoped`. If this is in the browser, the whole database seam is"
  },
  /*
   * Drivers and platform modules. `@effect/sql-pg` rather than `pg` alone, because `pg` appears inside unrelated
   * words in minified output and would fail for the wrong reason — a needle that cries wolf gets deleted.
   */
  {
    needle: "pg-protocol",
    because: "the Postgres wire driver in a browser bundle means a connection string is one mistake from one too"
  },
  {
    needle: "@effect/sql-pg",
    because: "same as pg-protocol: the driver has no business in a browser"
  },
  {
    needle: "cloudflare:sockets",
    because: "a Workers-only module. Its presence means a server ring came along, even if nothing called it"
  },
  /*
   * better-auth's SERVER, named by a string only it contains. The console legitimately ships better-auth's
   * CLIENT, and the first version of this check matched the bare package name and failed on it — which was worth
   * finding out, because it also revealed that the client drags in core's env accessor (getters for
   * `BETTER_AUTH_SECRET` and friends: names, never values). `createAuthMiddleware` is server-only.
   */
  {
    needle: "createAuthMiddleware",
    because: "the auth server's middleware factory. The client SDK is fine and expected; the server is not"
  }
] as const

const files: Array<string> = []
const walk = (dir: string) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path)
    else if (path.endsWith(".js")) files.push(path)
  }
}

try {
  walk(CLIENT_DIR)
} catch {
  console.error(
    "no client bundle at apps/console/dist/client.\n" +
      "  Run `bun run --filter @ea/console build` first — this check reads emitted bytes, so there is nothing\n" +
      "  it can say about a tree that has not been built."
  )
  process.exit(1)
}

if (files.length === 0) {
  // An empty directory would make every assertion below pass, which is the one outcome worse than failing.
  console.error(`no .js files under ${CLIENT_DIR}; refusing to report a green check on an empty bundle`)
  process.exit(1)
}

const violations: Array<string> = []
for (const file of files) {
  const source = readFileSync(file, "utf8")
  for (const { because, needle } of FORBIDDEN) {
    if (source.includes(needle)) {
      violations.push(`  ${file.slice(CLIENT_DIR.length + 1)}\n    contains "${needle}"\n    ${because}`)
    }
  }
}

if (violations.length > 0) {
  console.error(`✗ ${violations.length} server-only module(s) reached the browser bundle:\n`)
  console.error(violations.join("\n\n"))
  console.error(
    "\nThe cause is usually a barrel: importing a concept's index.ts pulls every file in that folder, so a\n" +
      "domain type imported from a folder that also holds a server adapter drags the adapter in. Import the\n" +
      "narrower path, or move the adapter."
  )
  process.exit(1)
}

console.log(`✓ browser bundle is free of server-only modules (${files.length} files, ${FORBIDDEN.length} rules)`)
