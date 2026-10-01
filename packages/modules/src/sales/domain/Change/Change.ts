/**
 * A proposed change to the price list, made by asking — and applied only by a person.
 *
 * The model reads an instruction ("raise SV-350 to 199 euro and stop offering OLD-1") and can only PROPOSE: each
 * proposal is a row with the product's exact values before and after, computed here in code. Nothing in the price
 * list changes until a person applies the proposal, and applying refuses a proposal whose "before" no longer
 * matches the product — someone changed it in the meantime, so the diff the person read is no longer the truth.
 *
 * Values the model passes are checked against the INSTRUCTION, the same rule as a quote's quantities: a new price
 * or name must appear verbatim in what the person typed, so the model cannot invent one.
 */
import { Cents, parseScaledInteger } from "@ea/modules/shared/domain/Money"
import { containsVerbatim } from "@ea/modules/shared/domain/Verbatim"
import { Result, Schema } from "effect"
import { type Product, VAT_RATES } from "../Product/Product.ts"

export const ChangeId = Schema.String.pipe(Schema.brand("ChangeId"))
export type ChangeId = typeof ChangeId.Type

export const ChangeStatus = Schema.Literals(["pending", "applied", "rejected"])
export type ChangeStatus = typeof ChangeStatus.Type

/** The product fields a change can set. Units are fixed at creation: changing one would reprice every quote line. */
export const ProductFields = Schema.Struct({
  sku: Schema.String,
  name: Schema.String,
  unit: Schema.Literals(["piece", "hour", "meter", "kilogram", "litre"]),
  unitPrice: Schema.Int,
  vat: Schema.Int,
  active: Schema.Boolean
})
export type ProductFields = typeof ProductFields.Type

export class ProposedChange extends Schema.Class<ProposedChange>("ProposedChange")({
  id: ChangeId,
  status: ChangeStatus,
  kind: Schema.Literals(["update_product", "create_product"]),
  sku: Schema.String,
  /** Null for a new product. */
  before: Schema.NullOr(ProductFields),
  after: ProductFields,
  /** The person's own words, so whoever applies it can see what was asked. */
  instruction: Schema.String,
  createdAt: Schema.String
}) {}

/** One "change by asking" run: what was proposed, and why anything asked for was not. */
export class ProposalRun extends Schema.Class<ProposalRun>("ProposalRun")({
  proposals: Schema.Array(ProposedChange),
  refusals: Schema.Array(Schema.String)
}) {}

export const fieldsOf = (product: Product): ProductFields => ({
  sku: product.sku,
  name: product.name,
  unit: product.unit,
  unitPrice: product.unitPrice,
  vat: product.vat,
  active: product.active
})

/** What the model asked to set, as it passed it — every value still to be checked. */
export interface RequestedFields {
  readonly name?: string | undefined
  /** As written in the instruction, e.g. "199" or "42,50". */
  readonly price_eur?: string | undefined
  /** As written, e.g. "21" or "9". */
  readonly vat_percent?: string | undefined
  readonly active?: boolean | undefined
}

/** Either the checked "after" values, or the reason a proposal cannot be made — said back to the model. */
export type Checked = { readonly _tag: "Ok"; readonly after: ProductFields } | {
  readonly _tag: "Refused"
  readonly reason: string
}

const refuse = (reason: string): Checked => ({ _tag: "Refused", reason })

/**
 * Applies requested values to a starting point, checking each against the instruction.
 *
 * Exported for the two proposal kinds: an update starts from the product's current fields, a new product from the
 * fields the instruction gives for it.
 */
export const checkRequested = (
  start: ProductFields,
  requested: RequestedFields,
  instruction: string
): Checked => {
  let after: ProductFields = start
  if (requested.name !== undefined) {
    if (!containsVerbatim(requested.name, instruction)) {
      return refuse(`The name "${requested.name}" is not in the instruction.`)
    }
    after = { ...after, name: requested.name.trim() }
  }
  if (requested.price_eur !== undefined) {
    if (!containsVerbatim(requested.price_eur, instruction)) {
      return refuse(`The price "${requested.price_eur}" is not in the instruction; prices are never inferred.`)
    }
    const cents = parseScaledInteger(requested.price_eur, 2)
    if (Result.isFailure(cents) || cents.success < 0) return refuse(`The price "${requested.price_eur}" is ambiguous.`)
    after = { ...after, unitPrice: Cents.make(cents.success) }
  }
  if (requested.vat_percent !== undefined) {
    if (!containsVerbatim(requested.vat_percent, instruction)) {
      return refuse(`The VAT rate "${requested.vat_percent}" is not in the instruction.`)
    }
    const perMille = Math.round(Number(requested.vat_percent.replace(",", ".")) * 10)
    if (!VAT_RATES.includes(perMille)) return refuse(`VAT must be 0, 9 or 21 percent, not ${requested.vat_percent}.`)
    after = { ...after, vat: perMille }
  }
  if (requested.active !== undefined) after = { ...after, active: requested.active }
  return { _tag: "Ok", after }
}

export const sameFields = (a: ProductFields, b: ProductFields): boolean =>
  a.sku === b.sku && a.name === b.name && a.unit === b.unit && a.unitPrice === b.unitPrice && a.vat === b.vat &&
  a.active === b.active
