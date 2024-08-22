import { HexString } from '@polkadot/util/types'

export interface ChopsticksInput {
    endpoint: string
    extrinsic: HexString
    address: string
}

export interface XcmChopsticksInput {
    fromEndpoint: string
    toEndpoint: string
    extrinsic: HexString
    fromId: number
    toId: number
    relay: string
}
