/**
 * The request body is the contract with the provider, so it is asserted directly.
 *
 * Every one of these was a real failure on the first end-to-end run, and none of them is visible from
 * inside the codebase — they are all "the request we sent was wrong", which presents as "the model is bad".
 * A network test would catch them too, and would cost money and a flake; the body is pure.
 *
 * Lives in `domain/test` rather than beside a network test because it needs nothing: no token, no fetch, no
 * bindings.
 */
import { ProposedDecision } from "@ea/modules/decision/domain/Decision"
import { Invoice } from "@ea/modules/decision/domain/Invoice"
import { buildRequestBodyForTest, chatCompletionsUrl, jsonSchemaForTest } from "@ea/modules/decision/server/Extraction"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

const options = (responseFormat: "text" | "json") => ({
  prompt: { content: [] } as never,
  tools: [],
  toolChoice: "none" as const,
  responseFormat: responseFormat === "text"
    ? { type: "text" as const }
    : { type: "json" as const, objectName: "ProposedDecision", schema: ProposedDecision },
  span: {} as never,
  previousResponseId: undefined,
  incrementalPrompt: undefined
})

const body = (responseFormat: "text" | "json" = "json") =>
  buildRequestBodyForTest(options(responseFormat), [{ role: "user", content: "hi" }], "@cf/test/model")

describe("the request body", () => {
  it("sets max_tokens, because the provider default truncates a full extraction", () => {
    /*
     * The first real eval run failed EVERY case with `finish_reason: "length"`. Workers AI's default
     * max_tokens is low enough to cut an invoice extraction off mid-string, and the JSON then fails to
     * decode — which `generateObject` classifies as invalid output and RETRIES, truncating at exactly the
     * same place and paying twice to learn nothing.
     */
    expect(body()["max_tokens"]).toBe(4096)
  })

  it("sets temperature to 0, because a payment authorisation must not be sampled", () => {
    // Also so the eval harness can detect a regression: before this, two identical 12-case runs scored
    // 0/10 and 8/11 on uncited decisions.
    expect(body()["temperature"]).toBe(0)
  })

  it("forwards a JSON schema when the response format is json", () => {
    // `generateObject` does NOT put the schema in the prompt — it sets responseFormat and decodes the
    // returned text. Without this the model gets no shape at all and returns prose.
    const format = body()["response_format"] as { type: string; json_schema: { name: string } }
    expect(format.type).toBe("json_schema")
    expect(format.json_schema.name).toBe("ProposedDecision")
  })

  it("omits response_format entirely for a text request", () => {
    expect(body("text")["response_format"]).toBeUndefined()
  })
})

describe("the JSON schema handed to the provider", () => {
  const schema = jsonSchemaForTest(ProposedDecision) as {
    $ref?: string
    $defs?: Record<string, { properties?: Record<string, unknown>; required?: ReadonlyArray<string> }>
  }

  it("carries $defs, not definitions, so nested types resolve", () => {
    /*
     * `Schema.toJsonSchemaDocument` emits `{ schema, definitions }` while its own `$ref`s point at
     * `#/$defs/…`. A provider resolving `#/$defs/CitationEncoded` against a document that only has
     * `definitions` sees an EMPTY schema for that type — so `Citation` would be unconstrained and the
     * model could return anything for it, which is the one type rail 2 depends on.
     */
    expect(schema.$defs).toBeDefined()
    expect(Object.keys(schema.$defs!)).toContain("CitationEncoded")
    expect(Object.keys(schema.$defs!)).toContain("ProposedDecisionEncoded")
  })

  it("resolves every $ref it contains", () => {
    // Walks the whole document rather than checking the two known names, so a new nested type cannot be
    // added without its definition travelling with it.
    const refs: Array<string> = []
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return void node.forEach(walk)
      if (node === null || typeof node !== "object") return
      for (const [key, value] of Object.entries(node)) {
        if (key === "$ref" && typeof value === "string") refs.push(value)
        else walk(value)
      }
    }
    walk(schema)
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) {
      expect(ref.startsWith("#/$defs/"), `${ref} is not a $defs reference`).toBe(true)
      expect(Object.keys(schema.$defs!), ref).toContain(ref.slice("#/$defs/".length))
    }
  })

  it("preserves the measured field order: citations before rationale", () => {
    /*
     * The one ordering claim in this codebase backed by a number. docket measured `rationale` before
     * `citations` accounting for 25 of 66 grounding failures, because a model writes `[7]` mid-paragraph
     * and only afterwards works out what citation 7 was.
     *
     * This asserts the order SURVIVES into the schema the provider sees, which is the only part we control.
     * Whether the provider then generates in that order is a separate question, and the answer for Workers
     * AI is measured and negative — its constrained decoding emitted `citations, outcome, rationale` for
     * this very schema. That is recorded in `evals/Decisions.ts` rather than asserted here, because it is a
     * property of the provider and not of our code.
     */
    const properties = Object.keys(schema.$defs!["ProposedDecisionEncoded"]!.properties!)
    expect(properties.indexOf("citations")).toBeLessThan(properties.indexOf("rationale"))
  })

  it("preserves source_span before value on every extracted field", () => {
    // ADR-0008's hypothesis, at least as far as the request goes: quote the document before committing to
    // a reading. Checked on the Invoice schema, where it is actually used.
    const invoice = jsonSchemaForTest(Invoice) as {
      $defs?: Record<string, { properties?: Record<string, unknown> }>
      properties?: Record<string, unknown>
    }
    const candidates = [
      ...Object.values(invoice.$defs ?? {}).map((definition) => definition.properties),
      invoice.properties
    ]
    const fields = candidates
      .filter((properties): properties is Record<string, unknown> => properties !== undefined)
      .flatMap((properties) => Object.values(properties))
      .filter((property): property is { properties: Record<string, unknown> } =>
        typeof property === "object" && property !== null && "properties" in property &&
        typeof (property as { properties?: unknown }).properties === "object" &&
        (property as { properties: Record<string, unknown> }).properties["source_span"] !== undefined
      )
    // Guards the guard: a walk that found nothing would pass every assertion below it.
    expect(fields.length).toBeGreaterThan(0)
    for (const field of fields) {
      const keys = Object.keys(field.properties)
      expect(keys.indexOf("source_span")).toBeLessThan(keys.indexOf("value"))
    }
  })

  it("describes value by what it excludes, because a model read 'as printed' as 'the whole line'", () => {
    /*
     * The defect that made the first eval run useless: the model set `value` to
     * `"**Totaal inclusief BTW: EUR 839,07**"`, `parseMoney` refused it, the arithmetic check failed and
     * rail 1 fired on every case. The description reaches the model through this schema, so it is the fix
     * and it is worth pinning.
     */
    const invoice = jsonSchemaForTest(Invoice) as {
      properties: Record<string, { properties: Record<string, { description?: string }> }>
    }
    const description = invoice.properties["total_incl_vat"]!.properties["value"]!.description ?? ""
    expect(description).toContain("nothing else")
    expect(description).toMatch(/markdown/i)
  })
})

describe("what a plain Schema round-trips to", () => {
  it("emits a self-contained document for a flat struct too", () => {
    // A vertical without nested types must not depend on $defs existing.
    const flat = jsonSchemaForTest(Schema.Struct({ a: Schema.String })) as Record<string, unknown>
    expect(flat["type"] ?? flat["$ref"]).toBeDefined()
  })
})

describe("the endpoint URL", () => {
  /*
   * Asserted rather than executed, and the distinction is stated because it matters: no AI Gateway exists
   * on the account yet, so this integration is **not verified by execution** — the same status
   * `cloudflare:sockets` had before milestone 0 (ADR-0009). A wrong URL here fails in the most expensive
   * way available: the call still succeeds against the direct endpoint shape or 404s, and either way the
   * request is unmetered and uncached while everything looks configured.
   */
  it("calls the account endpoint when no gateway is configured", () => {
    expect(chatCompletionsUrl({ accountId: "acc", gateway: undefined }))
      .toBe("https://api.cloudflare.com/client/v4/accounts/acc/ai/v1/chat/completions")
  })

  it("calls the gateway's workers-ai path when one is configured", () => {
    // The provider-specific path, not `/compat/`: it keeps the model id exactly as Workers AI names it,
    // where `/compat/` would require a `workers-ai/` prefix on every model.
    expect(chatCompletionsUrl({ accountId: "acc", gateway: "gw" }))
      .toBe("https://gateway.ai.cloudflare.com/v1/acc/gw/workers-ai/v1/chat/completions")
  })

  it("never silently drops the gateway from the URL", () => {
    // The failure this guards is not a crash — it is a call that works and is simply not metered.
    const url = chatCompletionsUrl({ accountId: "acc", gateway: "gw" })
    expect(url).toContain("gateway.ai.cloudflare.com")
    expect(url).toContain("/gw/")
    expect(url).not.toContain("api.cloudflare.com")
  })
})
