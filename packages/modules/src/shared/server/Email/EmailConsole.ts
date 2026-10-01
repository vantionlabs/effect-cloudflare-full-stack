/**
 * The default `Email` implementation: it logs the message and sends nothing.
 *
 * **This is what makes the auth flows developable.** Verification, password reset and invitations all need a
 * link to reach a person, and on a laptop there is no sending domain and no provider key — so the link goes to
 * the terminal instead, where it can be clicked. `wrangler dev`, the e2e suite and a fresh clone all work with
 * no vendor account, which is the same argument as the scripted language model.
 *
 * **It logs the body, including the link.** That is the point: a reset link is a bearer capability, and a stub
 * that redacted it would be useless. So this adapter is a development tool and `apps/worker` must not select
 * it where real users exist — which is why selection keys on the presence of a provider key rather than on an
 * environment name, and why the log line says `NOT SENT` loudly enough to notice in production logs if it ever
 * is selected there by mistake.
 */
import { Email, type EmailService } from "@ea/modules/shared/domain/Email"
import { Effect, Layer } from "effect"

export const EmailConsole: Layer.Layer<Email> = Layer.succeed(Email)(
  {
    send: (message) =>
      Effect.logWarning("email NOT SENT (console stub)").pipe(
        Effect.annotateLogs({
          to: message.to,
          subject: message.subject,
          // The whole body, deliberately: the links in it are the only reason a developer reads this line.
          text: message.text
        })
      )
  } satisfies EmailService
)
