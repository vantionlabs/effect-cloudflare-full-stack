/**
 * Resend behind the `Email` port.
 *
 * ## Why the SDK rather than `fetch`
 *
 * Every other provider in this repo is reached with a bare `fetch` — Workers AI, Mistral OCR — because for
 * those the SDK is either absent or buys nothing. Resend is the one place that argument came out the other way,
 * and only after checking the bundle rather than assuming:
 *
 * - `resend@6.31.0`'s ESM build is `fetch`-based and imports **no node builtins**. Its two static dependencies,
 *   `postal-mime` and `standardwebhooks`, are pure JS (`standardwebhooks` carries `@stablelib/base64` and
 *   `fast-sha256`, neither of which touches `node:crypto`).
 * - `@react-email/render` is a **peer** dependency, reached through `await import(...)` inside a try/catch, on a
 *   path that only runs when a message carries a React element. Nothing here does, so the peer stays
 *   uninstalled and React never enters the Worker.
 *
 * The payoff is small but real: typed error codes, and webhook signature verification already written for when
 * bounces get consumed. And this package exists precisely so that `resend` is reachable from exactly one place
 * (ADR-0021) — a bare `fetch` here would leave an empty package whose only content was a URL.
 *
 * ## The provider does not throw
 *
 * `emails.send` resolves with `{ data, error }`. An API rejection is a RESOLVED promise with `error` set, so
 * checking it is not defensive — forgetting to is how a send silently appears to succeed.
 *
 * **And the SDK catches transport failures too**, returning its own `application_error` with the sentence
 * "Unable to fetch data. The request could not be resolved." — measured, in `EmailResend.test.ts`, after a
 * test asserting on the real cause failed. So a DNS failure, a timeout and a TLS error are indistinguishable
 * in our logs, and the `catch` branch below is belt-and-braces rather than the path a network failure takes.
 * That is the one real cost of using the SDK here, and it is small because every caller of this port already
 * treats a failure as "log it and carry on".
 */
import { Email, type EmailMessage, type EmailService } from "@ea/modules/shared/domain/Email"
import { EmailNotSent } from "@ea/modules/shared/domain/Errors"
import { Config, Effect, Layer, Redacted } from "effect"
import { Resend } from "resend"

export interface ResendConfig {
  readonly apiKey: Redacted.Redacted
  /**
   * The `From` address, which must be on a domain verified in the Resend account.
   *
   * No default, and that is the whole reason this is configuration rather than a constant: a sender address is a
   * per-deployment fact, and a wrong one does not fail loudly — Resend accepts the request and the mail is
   * rejected downstream or lands in spam.
   */
  readonly from: string
}

/**
 * Reads the provider configuration, or `undefined` when there is none.
 *
 * Both-or-neither, like `mistralOcrConfig`: a key with no sender address is a half-finished deployment, and
 * dying on it is better than sending from a default nobody chose. `undefined` is the ordinary case on a laptop
 * and in CI, and the composition root answers it with the console stub.
 */
export const resendConfig: Effect.Effect<ResendConfig | undefined> = Effect.gen(function*() {
  const apiKey = yield* Effect.orDie(
    Config.Redacted("RESEND_API_KEY").pipe(Config.withDefault(Redacted.make("")))
  )
  const from = yield* Effect.orDie(Config.String("EMAIL_FROM").pipe(Config.withDefault("")))
  if (Redacted.value(apiKey) === "") return undefined
  if (from === "") {
    return yield* Effect.die(
      new Error(
        "RESEND_API_KEY is set but EMAIL_FROM is not. A sender address has no safe default: Resend " +
          "accepts a send from an unverified domain and the mail is dropped or spam-filtered downstream, " +
          "so the failure would not be visible here."
      )
    )
  }
  return { apiKey, from }
})

/** Resend's own description of why it refused, or a short description of a transport failure. */
const describe = (cause: unknown): string => {
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = (cause as { readonly message?: unknown }).message
    if (typeof message === "string" && message !== "") return message
  }
  return String(cause)
}

export const EmailResend = (config: ResendConfig): Layer.Layer<Email> =>
  Layer.sync(Email)(() => {
    const client = new Resend(Redacted.value(config.apiKey))
    const send = (message: EmailMessage) =>
      Effect.tryPromise({
        try: () =>
          client.emails.send({
            from: config.from,
            to: message.to,
            subject: message.subject,
            text: message.text,
            ...message.html === undefined ? {} : { html: message.html },
            ...message.headers === undefined ? {} : { headers: { ...message.headers } }
          }),
        catch: (cause) => new EmailNotSent({ to: message.to, reason: describe(cause) })
      }).pipe(
        Effect.flatMap((result) =>
          // A resolved promise with `error` set is a refusal. See the note at the top of this file.
          result.error === null
            ? Effect.void
            : Effect.fail(new EmailNotSent({ to: message.to, reason: describe(result.error) }))
        )
      )
    return { send } satisfies EmailService
  })
