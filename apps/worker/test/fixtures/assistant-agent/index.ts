/**
 * A harness for the REAL `AssistantAgent`, in real `workerd`.
 *
 * Its own Worker rather than the product's, because the agent has no production route yet — the Worker edge
 * that resolves a session, runs `AskCorpus` and hands the turn over is separate work
 * (`.scratch/ai-stack/issues/04`). Standing up a route just to test the class would mean shipping an
 * unauthenticated door to a tenant-scoped conversation, which is the one thing the design says not to do.
 *
 * What this DOES exercise is production code: it imports the class itself, so the state contract, the
 * validation and the append are the deployed ones. Only the routing is a fixture.
 */
import { getAgentByName } from "agents"
import { AssistantAgent } from "../../../src/AssistantAgent.ts"

export { AssistantAgent }

interface ProbeEnv {
  readonly ASSISTANTS: DurableObjectNamespace<AssistantAgent>
}

export default {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    const url = new URL(request.url)
    const name = url.searchParams.get("name") ?? "probe"
    /*
     * `getAgentByName` is the SDK's accessor. It resolves to an ordinary namespace lookup, which is why the
     * production `Env` can declare the narrow shape it does rather than importing the SDK into Bindings.ts.
     */
    const agent = await getAgentByName<ProbeEnv, AssistantAgent>(env.ASSISTANTS, name)
    /*
     * The body is spread in rather than passed as `undefined`, because `exactOptionalPropertyTypes` makes
     * `{ body: undefined }` a different thing from an absent `body` — and `RequestInit` accepts the latter.
     */
    const init: RequestInit = request.method === "POST"
      ? { method: request.method, headers: request.headers, body: await request.text() }
      : { method: request.method, headers: request.headers }
    return await agent.fetch(new Request("https://agent/", init))
  }
} satisfies ExportedHandler<ProbeEnv>
