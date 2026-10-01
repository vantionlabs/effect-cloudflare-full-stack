/**
 * The price list: what can be quoted, in what unit, at what price and VAT rate.
 *
 * The ONLY source of a price in a quote. The model reading a customer's request may choose a product from this
 * list; it never states a price, and a price it wrote would be ignored. That is the sales version of the rule the
 * decide pipeline enforces with rails: the model proposes, code computes.
 */
import { Cents, PerMille } from "@ea/modules/shared/domain/Money"
import { Schema } from "effect"

export const ProductId = Schema.String.pipe(Schema.brand("ProductId"))
export type ProductId = typeof ProductId.Type

export const Unit = Schema.Literals(["piece", "hour", "meter", "kilogram", "litre"])
export type Unit = typeof Unit.Type

/** How a person reads a unit, in Dutch. The stored values stay English: they are part of the API contract. */
export const UNIT_LABEL: Readonly<Record<Unit, string>> = {
  piece: "stuk",
  hour: "uur",
  meter: "meter",
  kilogram: "kilogram",
  litre: "liter"
}

/**
 * The VAT rates a product may carry, in per-mille: 0%, 9%, 21%. Enforced by the upsert and by a `check` constraint on
 * the column, so a rate outside this set cannot be stored however it arrives.
 */
export const VAT_RATES: ReadonlyArray<number> = [0, 90, 210]

export class Product extends Schema.Class<Product>("Product")({
  id: ProductId,
  /** The organization's own code for it — what the model is given to choose by, and what it must echo back. */
  sku: Schema.String,
  name: Schema.String,
  unit: Unit,
  /** Excluding VAT, per one unit. */
  unitPrice: Cents,
  vat: PerMille,
  /** An inactive product stays on old quotes but is never offered for a new one. */
  active: Schema.Boolean
}) {}
