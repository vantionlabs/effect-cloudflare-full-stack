/**
 * The usage page's data: the `Usage.report` RPC as a serializable atom, so `atoms/dehydrate.ts` carries the
 * server's result into the browser. The default period (the current UTC month) is the server's to decide.
 */
import { Api } from "@/rpc"

export const usageReportAtom = Api.query("Usage.report", {}, { serializationKey: "usage-report" })
