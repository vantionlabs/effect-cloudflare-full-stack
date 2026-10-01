/**
 * An incoming email's raw MIME, parsed into the fields a draft needs — the one place `postal-mime` (MIT-0) is used.
 *
 * A `server`-ring adapter, not glue: it takes the bytes as a parameter and knows nothing about Workers. The handler
 * in `apps/worker` reads `message.raw` and the headers and hands them here.
 *
 * Plain text when the message has it; otherwise its HTML reduced to text. The reduction is deliberately crude —
 * tags out, block ends to newlines, entities postal-mime already decoded — because what matters downstream is that
 * the customer's words survive verbatim, so the model's pointers into them can be checked.
 */
import type { ReceivedEmail } from "@ea/modules/sales/use-cases/Inbound"
import { Effect } from "effect"
import PostalMime from "postal-mime"

const htmlToText = (html: string): string =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

export class UnreadableEmail extends Error {
  readonly _tag = "UnreadableEmail"
}

/**
 * `envelopeFrom` is the SMTP sender Cloudflare received the message from; the `From:` header is preferred for the
 * address and name a person would recognise, with the envelope as the fallback.
 */
export const parseInboundEmail = (input: {
  readonly raw: ReadableStream<Uint8Array> | ArrayBuffer
  readonly envelopeFrom: string
  readonly autoSubmitted: string | null
  readonly precedence: string | null
}): Effect.Effect<ReceivedEmail, UnreadableEmail> =>
  Effect.map(
    Effect.tryPromise({
      try: () => PostalMime.parse(input.raw),
      catch: (cause) => new UnreadableEmail(String(cause))
    }),
    (email) => {
      const from = email.from !== undefined && email.from.address !== undefined ? email.from : undefined
      const text = email.text?.trim() || (email.html === undefined ? "" : htmlToText(email.html))
      return {
        messageId: email.messageId ?? null,
        fromAddress: from?.address ?? input.envelopeFrom,
        fromName: from?.name?.trim() || null,
        subject: email.subject?.trim() || null,
        text,
        autoSubmitted: input.autoSubmitted,
        precedence: input.precedence
      }
    }
  )
