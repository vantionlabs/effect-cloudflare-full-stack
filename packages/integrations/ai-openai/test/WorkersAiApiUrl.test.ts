/**
 * The two base URLs this adapter can talk to, and the one thing that must not differ between them.
 *
 * A model id is the same string in both shapes. Cloudflare's AI Gateway offers a unified `/compat/`
 * path that requires a `workers-ai/` prefix on every model name, and taking it would mean the model id
 * is rewritten in one configuration and not the other — so a gateway becoming enabled would change what
 * `@cf/meta/...` means. The provider-specific path avoids that, and these tests are what keep the
 * choice from being undone by a plausible-looking edit.
 */
import { workersAiApiUrl } from "@ea/ai-openai/Model"
import { describe, expect, it } from "vitest"

describe("workersAiApiUrl", () => {
  it("goes direct to the account's Workers AI endpoint with no gateway", () => {
    expect(workersAiApiUrl({ accountId: "acct123", gateway: undefined }))
      .toBe("https://api.cloudflare.com/client/v4/accounts/acct123/ai/v1")
  })

  it("routes through the named gateway on the provider-specific path", () => {
    expect(workersAiApiUrl({ accountId: "acct123", gateway: "prod" }))
      .toBe("https://gateway.ai.cloudflare.com/v1/acct123/prod/workers-ai/v1")
  })

  it("never uses the unified /compat/ path, which would require prefixing every model id", () => {
    for (const gateway of [undefined, "prod"]) {
      expect(workersAiApiUrl({ accountId: "acct123", gateway })).not.toContain("/compat/")
    }
  })

  it("ends at the OpenAI-compatible version segment in both shapes, so paths append the same way", () => {
    for (const gateway of [undefined, "prod"]) {
      expect(workersAiApiUrl({ accountId: "acct123", gateway }).endsWith("/v1")).toBe(true)
    }
  })
})
