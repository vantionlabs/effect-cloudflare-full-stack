/**
 * The usage page's data: the `Usage.report` RPC as a serializable atom, so `atoms/dehydrate.ts` carries the
 * server's result into the browser. The default period (the current UTC month) is the server's to decide.
 */
import { dehydrateAtoms } from "@/atoms/dehydrate"
import { Api } from "@/rpc"
import { createServerFn } from "@tanstack/react-start"

export const usageReportAtom = Api.query("Usage.report", {}, { serializationKey: "usage-report" })

/** The page's SSR data. A GET server function, so it always runs on the server. */
export const loadUsagePage = createServerFn({ method: "GET" }).handler(() => dehydrateAtoms([usageReportAtom]))
