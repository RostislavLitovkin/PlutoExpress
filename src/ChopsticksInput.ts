import { HexString } from '@polkadot/util/types'

export interface ChopsticksInput {
    endpoint: string,
    extrinsic: HexString,
    address: string,
}
