/**
 * The organization's quote-request address, read and rotated through the sales RPCs. Its own atoms rather than
 * sales's: a feature does not import another feature, and settings only needs the address.
 */
import { Api } from "@/rpc/client"

export const INBOUND_ADDRESS_KEY = "settings-inbound-address"

export const inboundAddressAtom = Api.query("Sales.inboundAddress", {}, {
  serializationKey: "settings-inbound-address",
  reactivityKeys: [INBOUND_ADDRESS_KEY]
})

export const rotateInboundAddressAtom = Api.mutation("Sales.rotateInboundAddress")
