/**
 * The answer to a question about the organization's data — and the data itself, always.
 *
 * `data` is what the tools returned, one entry per call, so the console can show the figures as tables whether or
 * not the prose survived the check. When it did not, `answer` is null and `refusedFigures` names the numbers that
 * could not be traced; the person still has the data and can read it themselves.
 */
import { Schema } from "effect"

export class DataLookup extends Schema.Class<DataLookup>("DataLookup")({
  tool: Schema.String,
  input: Schema.Unknown,
  result: Schema.Unknown
}) {}

export class DataAnswer extends Schema.Class<DataAnswer>("DataAnswer")({
  answer: Schema.NullOr(Schema.String),
  refusedFigures: Schema.Array(Schema.String),
  data: Schema.Array(DataLookup),
  /** True when the step bound stopped the loop, so the answer may be partial. */
  truncated: Schema.Boolean
}) {}
