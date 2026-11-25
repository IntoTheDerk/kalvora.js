import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export type ChainName = 'kal_main' | 'kal_proto';

/** Derive the height-one wire identity from the operator's trusted final block-zero hash. */
export function deriveChainId(name: ChainName, genesisHash: Uint8Array | string): Uint8Array {
  if (name !== 'kal_main' && name !== 'kal_proto') throw new Error('Unknown Kalvora chain name');
  const hash = typeof genesisHash === 'string' ? hexToBytes(genesisHash.replace(/^0x/u, '')) : genesisHash;
  if (!(hash instanceof Uint8Array) || hash.length !== 32) throw new Error('Final genesis hash must be 32 bytes');
  return sha256(concatBytes(utf8ToBytes(`KAL_CHAIN_ID_V2|${name}|`), hash));
}
