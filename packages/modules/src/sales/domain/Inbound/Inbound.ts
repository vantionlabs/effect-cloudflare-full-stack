/**
 * A customer's email that becomes a draft quote — the part that is not platform.
 *
 * Each organization has a receiving address `<token>@<domain>`. An email to it is stored as an `InboundMessage`,
 * then read into a DRAFT quote by the same `DraftQuote` a person uses — the model points at what is asked for, code
 * prices it, a person approves before anything is sent. The sender's address is the customer's: it came from the
 * mail envelope, not from the model, so it is trusted as the reply address.
 *
 * What is refused is still recorded (status `rejected`, with a reason): an auto-reply, a message over the hourly
 * limit. A customer request that leaves no trace is worse than one that is visibly declined.
 */
import { Schema } from "effect"

/** At most this many messages per organization per hour are read; the rest are recorded as refused. */
export const MAX_INBOUND_PER_HOUR = 50
/** A raw message larger than this is refused at the door: requests are text, not attachments. */
export const MAX_INBOUND_RAW_BYTES = 1_000_000
/** The body kept and read. Longer text is truncated, and the message says so. */
export const MAX_INBOUND_BODY_CHARS = 20_000

export const InboundStatus = Schema.Literals(["received", "drafted", "failed", "rejected"])
export type InboundStatus = typeof InboundStatus.Type

export class InboundMessage extends Schema.Class<InboundMessage>("InboundMessage")({
  id: Schema.String,
  fromAddress: Schema.String,
  fromName: Schema.NullOr(Schema.String),
  subject: Schema.NullOr(Schema.String),
  receivedAt: Schema.String,
  status: InboundStatus,
  quoteId: Schema.NullOr(Schema.String),
  /** Why it was refused or failed, in Dutch, for the person reading the inbox. */
  reason: Schema.NullOr(Schema.String),
  truncated: Schema.Boolean
}) {}

export class InboundAddress extends Schema.Class<InboundAddress>("InboundAddress")({
  token: Schema.String,
  /** `token@domain`, or null while no receiving domain is configured for this deployment. */
  address: Schema.NullOr(Schema.String),
  createdAt: Schema.String
}) {}

/** Where a quote's request came from: typed into the console, or an email to the organization's address. */
export class QuoteSource extends Schema.Class<QuoteSource>("QuoteSource")({
  inboundMessageId: Schema.String,
  fromAddress: Schema.String,
  fromName: Schema.NullOr(Schema.String),
  subject: Schema.NullOr(Schema.String)
}) {}

/**
 * An automated message, by its headers: an out-of-office or a mailing list. Answering one with a draft quote is
 * noise at best and a mail loop at worst. RFC 3834 `Auto-Submitted` (anything but `no`) and the older `Precedence`.
 */
export const isAutomated = (headers: { readonly autoSubmitted: string | null; readonly precedence: string | null }) => {
  const auto = headers.autoSubmitted?.trim().toLowerCase()
  if (auto !== undefined && auto !== "" && auto !== "no") return true
  const precedence = headers.precedence?.trim().toLowerCase()
  return precedence === "bulk" || precedence === "list" || precedence === "junk"
}

/** The token is the local part of the recipient address, compared case-insensitively. */
export const tokenOf = (recipient: string): string => recipient.split("@")[0]!.trim().toLowerCase()

/** The text a draft is read from: the subject (customers put the request there) and the body. */
export const requestTextOf = (subject: string | null, body: string): string =>
  subject === null || subject.trim() === "" ? body : `Onderwerp: ${subject.trim()}\n\n${body}`
