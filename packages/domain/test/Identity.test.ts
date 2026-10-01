/**
 * The identity seam's three load-bearing properties, tested where they are decided.
 *
 * `@ea/domain` has no dependency but `effect`, so these need nothing — no database, no bindings, no
 * session. That is the point of the package existing, and a test file that needed a fixture would be
 * evidence the cut was wrong.
 */
import { Unauthenticated } from "@ea/domain/Errors"
import { CurrentOrg, CurrentOrgFromUser, CurrentUser, Identity, OrgId, UserId } from "@ea/domain/Identity"
import { Effect, Layer, Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

const alice = new Identity({
  userId: UserId.make("user_alice"),
  orgId: OrgId.make("org_acme"),
  email: "alice@acme.test",
  role: "reviewer"
})

describe("CurrentOrgFromUser", () => {
  it("derives the tenant from the authenticated user", async () => {
    const orgId = await Effect.runPromise(
      CurrentOrg.pipe(
        Effect.provide(CurrentOrgFromUser),
        Effect.provideService(CurrentUser, alice)
      )
    )
    expect(orgId).toBe("org_acme")
  })

  /*
   * The bridge points ONE way, and this is the machine-checkable half of that claim: providing only
   * the tenant leaves `CurrentUser` unsatisfied, so an effect that wants a person cannot be served by
   * a queue consumer's identity. There is deliberately no `CurrentUserFromOrg` to import here — the
   * type error you would get from writing one is the enforcement, and this asserts the runtime half.
   */
  it("does not work backwards: a tenant alone cannot answer for a person", async () => {
    const reading = CurrentUser.pipe(Effect.provide(Layer.succeed(CurrentOrg)(OrgId.make("org_acme"))))
    await expect(Effect.runPromise(reading as Effect.Effect<Identity>)).rejects.toThrow(/CurrentUser/)
  })
})

describe("Identity", () => {
  it("accepts the four roles and nothing else", () => {
    for (const role of ["owner", "admin", "reviewer", "viewer"]) {
      expect(Result.isSuccess(Schema.decodeUnknownResult(Identity)({ ...alice, role }))).toBe(true)
    }
    // `member` is the plausible wrong answer: better-auth's own default role, and not ours. An open role set
    // would let it through and authorise on a string nobody defined. (`admin` used to be this example; it is a
    // real role now — owners and admins manage the team.)
    expect(Result.isSuccess(Schema.decodeUnknownResult(Identity)({ ...alice, role: "member" }))).toBe(false)
  })
})

describe("Unauthenticated", () => {
  /*
   * `_tag` is the contract; `.message` is empty, which AGENTS.md records as a trap for the whole repo.
   * Asserted here rather than left as prose so a future `Schema.TaggedError` that starts carrying a
   * message cannot quietly change what callers should read.
   */
  it("carries its tag and no message", () => {
    const failure = new Unauthenticated()
    expect(failure._tag).toBe("Unauthenticated")
    expect(failure.message).toBe("")
  })

  it("has an empty payload, so it cannot become a probing oracle", () => {
    expect(Object.keys(new Unauthenticated().toJSON() as object)).toEqual(["_tag"])
  })
})
