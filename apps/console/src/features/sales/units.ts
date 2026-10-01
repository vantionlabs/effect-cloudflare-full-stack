/** The price list's units as stored (English, part of the contract). The Dutch labels live in the sales domain. */
export { UNIT_LABEL } from "@ea/modules/sales/domain/Product"
export const UNITS = ["piece", "hour", "meter", "kilogram", "litre"] as const
export type Unit = typeof UNITS[number]
