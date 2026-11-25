import bs58 from 'bs58';

import type { FalconVariant, WalletHash } from '../../proto/generated/txn_pb.js';
import {
  decodeWalletAddress, deriveFalconAddress, falconVariantFromKey, WALLET_HASH
} from '../shared/crypto/falcon-address.js';

/** Identity supplied by a compatible wallet. The app supplies its own trusted chain ID. */
export interface ExternalSigningAccount {
  walletAddress: string;
  chainId: Uint8Array;
}

export function decodeFalconPublicKey(publicKey: string): Uint8Array {
  if (publicKey.length < 897 || publicKey.length > 2449) throw new Error('Invalid Falcon public key length');
  const raw = bs58.decode(publicKey);
  falconVariantFromKey(raw);
  return raw;
}

export function selectedWalletHash(rawPublicKey: Uint8Array, address: string): WalletHash {
  const selected = decodeWalletAddress(address);
  for (const walletHash of Object.values(WALLET_HASH)) {
    const derived = deriveFalconAddress(rawPublicKey, walletHash);
    if (derived.length === selected.length && derived.every((value, i) => value === selected[i])) return walletHash;
  }
  throw new Error('Wallet returned an address that does not match its public key');
}

/** Identity shared by injected providers, deep links and WalletConnect. */
export class WalletSigningAccount {
  readonly publicKey: string;
  readonly walletAddress?: string;
  readonly rawPublicKey?: Uint8Array;
  readonly variant?: FalconVariant;
  readonly walletHash?: WalletHash;
  readonly chainId?: Uint8Array;

  constructor(publicKey: string, account?: ExternalSigningAccount) {
    if (!publicKey) throw new Error('publicKey is required');
    this.publicKey = publicKey;
    if (!publicKey.includes('_')) {
      const raw = decodeFalconPublicKey(publicKey);
      if (!account || !(account.chainId instanceof Uint8Array) || account.chainId.length !== 32) {
        throw new Error('Falcon signing requires the selected wallet address and a trusted 32-byte wire chain ID');
      }
      this.walletHash = selectedWalletHash(raw, account.walletAddress);
      this.variant = falconVariantFromKey(raw);
      this.rawPublicKey = raw;
      this.walletAddress = account.walletAddress;
      this.chainId = account.chainId.slice();
    }
  }
}
