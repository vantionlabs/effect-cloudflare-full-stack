/** The figure check: what it lets through and what it refuses. */
import { ungroundedFigures } from "@ea/modules/reporting/domain/DataAsk"
import { describe, expect, it } from "vitest"

const DATA = JSON.stringify({ period: { from: "2026-09-01", to: "2026-10-01" }, sent: 4, sent_value_eur: "1829.52" })

describe("ungroundedFigures", () => {
  it("accepts figures quoted from the data, however they are formatted", () => {
    expect(ungroundedFigures("In September we sent 4 quotes worth € 1.829,52.", [DATA])).toEqual([])
    expect(ungroundedFigures("4 quotes, 1829.52 euro, from 2026-09-01.", [DATA])).toEqual([])
  })

  it("allows a decimal to be said in whole units, rounded or truncated", () => {
    expect(ungroundedFigures("Roughly € 1830 in total.", [DATA])).toEqual([])
    expect(ungroundedFigures("About € 1829.", [DATA])).toEqual([])
  })

  it("refuses a figure the model computed", () => {
    // 1829.52 / 4 = 457.38: true, but not in the data, so it cannot be traced.
    expect(ungroundedFigures("An average of € 457,38 per quote.", [DATA])).toEqual(["45738"])
  })

  it("refuses an invented count", () => {
    expect(ungroundedFigures("We sent 5 quotes.", [DATA])).toEqual(["5"])
  })

  it("accepts figures that come from the question itself", () => {
    expect(ungroundedFigures("Over the last 30 days there were 4.", [DATA, "What happened in the last 30 days?"]))
      .toEqual([])
  })
})
