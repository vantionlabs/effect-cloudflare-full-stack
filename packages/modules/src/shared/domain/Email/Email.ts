/**
 * Transactional email, as a port.
 *
 * One method, and the shape is deliberately the smallest thing every flow in this repo needs: a verification
 * link, a password reset link, an invitation. No templates, no attachments, no bulk send, no scheduling — each
 * of those is a Resend feature, and putting it here would make the port a description of Resend rather than a
 * description of what the product sends.
 *
 * ## Why `text` is required and `html` is not
 *
 * Every message this product sends is a sentence and a URL. A text body is therefore always writable, always
 * renderable, and is what a deliverability check wants to see; HTML is the optional nicety. The other way round
 * — HTML required, text derived — means somebody eventually strips tags with a regex to produce the fallback.
 *
 * ## Why a port rather than calling Resend
 *
 * The same reason as `Cache`: so `modules` stays runnable in Node, and so sign-up works on a laptop with no
 * vendor account. `EmailConsole` is the default and it logs instead of sending, which is what makes the auth
 * flows developable without credentials. The vendor adapter lives in `@ea/resend` and `apps/worker` chooses
 * between them (ADR-0021).
 */
import { Context, type Effect } from "effect"
import type { EmailNotSent } from "../Errors/EmailNotSent.ts"

export interface EmailMessage {
  readonly to: string
  readonly subject: string
  /** Plain text. Required: see the note above on why this is the body that always exists. */
  readonly text: string
  readonly html?: string | undefined
}

export interface EmailService {
  /**
   * Hands one message to the provider.
   *
   * Success means **accepted for delivery**, not delivered. Nothing in an HTTP response can tell you a mailbox
   * received anything, so a caller must never treat this as proof — the provider's webhooks are where bounces
   * and complaints come from, and this repo does not consume them yet.
   */
  readonly send: (message: EmailMessage) => Effect.Effect<void, EmailNotSent>
}

export class Email extends Context.Service<Email, EmailService>()("shared/Email") {}
