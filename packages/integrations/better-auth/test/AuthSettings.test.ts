/**
 * What this integration reads from the environment, and what it turns an empty string into.
 *
 * `authSettings` is the one part of the better-auth adapter that decides something on its own rather
 * than handing it to the SDK: every optional origin setting arrives as a string that may be empty, and
 * **empty must become `undefined`, not `""`**. The difference is not cosmetic — better-auth treats an
 * empty `trustedOrigins` entry and a `Domain=` cookie attribute as configuration, and both are wrong
 * in a way that only shows up in a browser.
 *
 * No database and no SDK boot: `SessionStore` is a connection string and a fake provides it.
 */
import { authSettings, SessionStore } from "@ea/better-auth/Session"
import { ConfigProvider, Effect } from "effect"
import { describe, expect, it } from "vitest"

const settingsWith = (env: Record<string, string | undefined>) =>
  Effect.runPromise(
    authSettings.pipe(
      Effect.provideService(SessionStore, { connectionString: "postgres://fake/db" }),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord({
        BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
        ...env
      })))
    )
  )

describe("authSettings", () => {
  it("turns every empty origin setting into undefined, not an empty string", async () => {
    const settings = await settingsWith({ ALLOWED_HOSTS: "", CONSOLE_ORIGIN: "", COOKIE_DOMAIN: "" })

    expect(settings.allowedHosts).toBeUndefined()
    expect(settings.consoleOrigin).toBeUndefined()
    expect(settings.cookieDomain).toBeUndefined()
  })

  it("splits ALLOWED_HOSTS on commas and trims, dropping empties", async () => {
    const settings = await settingsWith({
      ALLOWED_HOSTS: "app.example.com, *.effect-ai-console-dev.pages.dev ,"
    })
    expect(settings.allowedHosts).toEqual(["app.example.com", "*.effect-ai-console-dev.pages.dev"])
  })

  /*
   * The default is http://localhost, and that is load-bearing rather than a convenience: better-auth
   * derives `useSecureCookies` from this URL's scheme, so an https default would mark every local
   * session cookie `Secure`, the browser would discard it over plain http, and every sign-in would
   * appear to succeed while signing nobody in. That is a bug this repo has actually shipped locally.
   */
  it("defaults BASE_URL to http, because the cookie's Secure flag is derived from the scheme", async () => {
    const settings = await settingsWith({})
    expect(settings.baseURL.startsWith("http://")).toBe(true)
  })

  it("passes BASE_URL through untouched when it is set", async () => {
    const settings = await settingsWith({ BASE_URL: "https://api.example.com" })
    expect(settings.baseURL).toBe("https://api.example.com")
  })

  it("carries the store's connection string rather than reading one of its own", async () => {
    const settings = await settingsWith({})
    expect(settings.connectionString).toBe("postgres://fake/db")
  })

  /*
   * The secret leaves `Redacted` here because better-auth needs the string. Asserted so the
   * unwrapping stays deliberate: a `Redacted` reaching the SDK fails at runtime, and a redacted
   * value stringified by accident would silently become "<redacted>" and sign every cookie with it.
   */
  it("unwraps the secret, which the SDK needs as a plain string", async () => {
    const settings = await settingsWith({})
    expect(settings.secret).toBe("test-secret-at-least-32-characters-long")
  })
})
