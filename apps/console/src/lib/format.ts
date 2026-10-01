/**
 * How the console writes money, quantities, counts and days — in Dutch notation, because the interface is Dutch
 * (PRODUCT.md). One place, so "€ 1.234,50" looks the same on every page
 * and a test that reads a figure reads the same string everywhere.
 *
 * Money is integer cents end to end (ADR: no float touches money); dividing by 100 here is display only.
 */

const EURO = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const QUANTITY = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 3 })
const COUNT = new Intl.NumberFormat("nl-NL")
const DAY = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
const MOMENT = new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium", timeStyle: "short" })

/** `€ 1.234,50` from integer cents; a negative amount reads `-€ 1.234,50`. */
export const formatEuro = (cents: number): string =>
  cents < 0 ? `-€ ${EURO.format(-cents / 100)}` : `€ ${EURO.format(cents / 100)}`

/** A quantity stored in thousandths (`Milli`): 1500 → `1,5`. */
export const formatQuantity = (milli: number): string => QUANTITY.format(milli / 1000)

export const formatCount = (value: number): string => COUNT.format(value)

/** A `YYYY-MM-DD` day as `1 okt 2026`, read as UTC so it never shifts by a time zone. */
export const formatDay = (isoDay: string): string => DAY.format(new Date(`${isoDay.slice(0, 10)}T00:00:00Z`))

/** An ISO timestamp in the viewer's time zone. */
export const formatMoment = (iso: string): string => MOMENT.format(new Date(iso))

/** `1 offerte`, `3 offertes`. Dutch plurals are irregular, so `many` is usually passed. */
export const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`
