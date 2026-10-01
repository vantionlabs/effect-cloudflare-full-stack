/**
 * The Worker's `email` entry point: an email to `<token>@<INBOUND_EMAIL_DOMAIN>`, routed here by Cloudflare Email
 * Routing, becomes a recorded inbound message and a queued draft.
 *
 * Glue, and kept in `platform/` for the same reason `QueueHandler` is: `setReject` is a platform contract — it is how
 * a refusal reaches the SENDER, as a bounce — and nothing else in the repo can see a `ForwardableEmailMessage`. What a
 * message MEANS lives in the sales slice (`ReceiveEmail`, `parseInboundEmail`).
 *
 * What is refused at the door, and why there and not later:
 * - an unknown or disabled token — `setReject("Onbekend adres")`, before reading a byte of the body; a rotated address
 *   must stop accepting mail at once;
 * - a message over 1 MB — the sender should hear it did not arrive, rather than it vanishing.
 * An automated message or one over the hourly limit is NOT bounced: it is recorded as refused and shown in the inbox.
 * Bouncing auto-replies risks a mail loop, and bouncing a burst of spam sends it back to forged senders.
 */
import { CurrentOrg } from "@ea/domain/Identity"
import { MAX_INBOUND_RAW_BYTES, tokenOf } from "@ea/modules/sales/domain/Inbound"
import { type ReceivedEmail, ReceiveEmail, ResolveInboundToken } from "@ea/modules/sales/use-cases/Inbound"
import { Effect } from "effect"

/** The part of Cloudflare's `ForwardableEmailMessage` this handler uses. Structural, like every binding here. */
export interface InboundEmailMessage {
  readonly from: string
  readonly to: string
  readonly headers: { readonly get: (name: string) => string | null }
  readonly raw: ReadableStream<Uint8Array>
  readonly rawSize: number
  readonly setReject: (reason: string) => void
}

/** The MIME parser, handed in by the composition root — the one file allowed to name a `server`-ring adapter. */
export type ParseInboundEmail = (input: {
  readonly raw: ReadableStream<Uint8Array>
  readonly envelopeFrom: string
  readonly autoSubmitted: string | null
  readonly precedence: string | null
}) => Effect.Effect<ReceivedEmail, Error>

export const handleInboundEmail = (parseInboundEmail: ParseInboundEmail) => (message: InboundEmailMessage) =>
  Effect.gen(function*() {
    const orgId = yield* ResolveInboundToken(tokenOf(message.to))
    if (orgId === null) {
      message.setReject("Onbekend adres")
      return yield* Effect.log("email: unknown or disabled address, rejected")
    }
    if (message.rawSize > MAX_INBOUND_RAW_BYTES) {
      message.setReject("Bericht te groot: stuur de aanvraag als tekst, zonder grote bijlagen.")
      return yield* Effect.log("email: over the size limit, rejected").pipe(Effect.annotateLogs({ orgId }))
    }
    const parsed = yield* parseInboundEmail({
      raw: message.raw,
      envelopeFrom: message.from,
      autoSubmitted: message.headers.get("auto-submitted"),
      precedence: message.headers.get("precedence")
    }).pipe(
      Effect.tapError(() => Effect.sync(() => message.setReject("Bericht kon niet gelezen worden.")))
    )
    const outcome = yield* ReceiveEmail(parsed).pipe(Effect.provideService(CurrentOrg, orgId))
    yield* Effect.log(`email: ${outcome._tag}`).pipe(Effect.annotateLogs({ orgId }))
  })
