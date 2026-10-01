/**
 * The Resend adapter, against a stubbed `fetch`.
 *
 * Stubbing the TRANSPORT rather than the SDK is deliberate, because the two things worth pinning are both on
 * the wire. The first is that `from` comes from configuration and the message supplies the rest — a `from`
 * that silently defaulted would be accepted by Resend and dropped downstream, a failure invisible from here.
 * The second is that a refusal arrives as a RESOLVED promise with `error` set, so a missing check would make
 * every rejected send look successful; a hand-written fake of the SDK could not catch that, because the fake
 * would be built on the same mistaken assumption.
 */
import { Email, type EmailMessage } from "@ea/modules/shared/domain/Email"
import { EmailResend, type ResendConfig, resendConfig } from "@ea/resend/Email"
import { ConfigProvider, Effect, Redacted, Result } from "effect"
import { afterEach, describe, expect, it } from "vitest"

const config: ResendConfig = { apiKey: Redacted.make("re_test_key"), from: "Effect AI <noreply@example.com>" }

const message: EmailMessage = {
  to: "someone@example.com",
  subject: "Reset your password",
  text: "Open this link to choose a new password:\n\nhttps://console.example.com/reset?token=abc"
}

interface Call {
  readonly url: string
  readonly authorization: string | null
  readonly body: Record<string, unknown>
}

/** Replaces `fetch`, records what the SDK asked for, and answers with whatever Resend would have answered. */
const stubFetch = (respond: () => Response): Array<Call> => {
  const calls: Array<Call> = []
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
    })
    return Promise.resolve(respond())
  }) as typeof globalThis.fetch
  return calls
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const send = (input: EmailMessage) =>
  Effect.runPromise(
    Effect.gen(function*() {
      const email = yield* Email
      return yield* Effect.result(email.send(input))
    }).pipe(Effect.provide(EmailResend(config)))
  )

const configFrom = (env: Record<string, string | undefined>) =>
  Effect.runPromiseExit(resendConfig.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env)))))

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("EmailResend", () => {
  it("sends the configured `from` and the message's own fields, authorised with the key", async () => {
    const calls = stubFetch(() => json(200, { id: "e_1" }))
    const result = await send(message)

    expect(Result.isSuccess(result)).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toContain("api.resend.com")
    expect(calls[0]?.authorization).toBe("Bearer re_test_key")
    expect(calls[0]?.body).toMatchObject({
      from: "Effect AI <noreply@example.com>",
      to: "someone@example.com",
      subject: "Reset your password",
      text: message.text
    })
  })

  it("omits `html` entirely rather than sending it as null", async () => {
    const calls = stubFetch(() => json(200, { id: "e_1" }))
    await send(message)
    expect(calls[0]?.body).not.toHaveProperty("html")
  })

  it("fails with EmailNotSent when the provider REFUSES, which is a resolved 4xx and not a throw", async () => {
    stubFetch(() => json(403, { statusCode: 403, name: "validation_error", message: "domain is not verified" }))
    const result = await send(message)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      // `_tag` first: a `Schema.TaggedError` is an `Error` whose `.message` is usually empty.
      expect(result.failure._tag).toBe("EmailNotSent")
      expect(result.failure.to).toBe("someone@example.com")
      expect(result.failure.reason).toContain("domain is not verified")
    }
  })

  /*
   * MEASURED, not assumed: the SDK catches transport failures itself and returns its OWN error, so a rejected
   * `fetch` arrives through the same resolved-with-`error` path as a 403 and the underlying cause is lost. The
   * first version of this test asserted on "tcp timeout" and got "Unable to fetch data." instead.
   *
   * The consequence is worth knowing before debugging one: a DNS failure, a timeout and a TLS error all log
   * the same sentence. The `catch` branch in the adapter is therefore belt-and-braces rather than the path a
   * network failure takes.
   */
  it("fails with EmailNotSent when the transport fails, via the SDK's own error rather than a throw", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("tcp timeout"))) as typeof globalThis.fetch
    const result = await send(message)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("EmailNotSent")
      expect(result.failure.reason).toContain("Unable to fetch data")
    }
  })
})

describe("resendConfig", () => {
  it("is undefined with no key, so a laptop and CI get the console stub", async () => {
    const exit = await configFrom({})
    expect(exit._tag).toBe("Success")
    if (exit._tag === "Success") expect(exit.value).toBeUndefined()
  })

  it("is undefined when the key is present but empty, which is how an unset secret arrives", async () => {
    const exit = await configFrom({ RESEND_API_KEY: "", EMAIL_FROM: "noreply@example.com" })
    if (exit._tag === "Success") expect(exit.value).toBeUndefined()
  })

  it("reads both when both are set", async () => {
    const exit = await configFrom({ RESEND_API_KEY: "re_live", EMAIL_FROM: "noreply@example.com" })
    expect(exit._tag).toBe("Success")
    if (exit._tag === "Success") {
      expect(exit.value?.from).toBe("noreply@example.com")
      expect(Redacted.value(exit.value!.apiKey)).toBe("re_live")
    }
  })

  it("DIES on a key with no sender address, rather than inventing one", async () => {
    const exit = await configFrom({ RESEND_API_KEY: "re_live" })
    expect(exit._tag).toBe("Failure")
  })
})
