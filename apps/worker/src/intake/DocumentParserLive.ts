/**
 * The text parser as a layer.
 *
 * Stateless, so safe to memoise for the isolate — unlike the database connection and better-auth's
 * pool. When `anydoc` WASM and Mistral OCR arrive they replace this layer for the same tag, and no
 * caller changes.
 */
import { DocumentParser, parseText } from "@ea/shared-domain/intake"
import { Layer } from "effect"

export const DocumentParserLive: Layer.Layer<DocumentParser> = Layer.succeed(DocumentParser)({
  parse: parseText
})
