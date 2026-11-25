import { falcon512padded, falcon1024padded } from '@noble/post-quantum/falcon.js';
import bs58 from 'bs58';

import type { FalconVariant, WalletHash } from '../../proto/generated/txn_pb.js';
import {
  deriveFalconAddress, falconSignatureSize, falconVariantFromKey, FALCON_VARIANT, WALLET_HASH
} from '../shared/crypto/falcon-address.js';
import { deriveChainId } from '../shared/network/chain-id.js';
import type { KalvoraSigner } from '../sign/signer.js';

export * from '../shared/crypto/falcon-address.js';

function algorithm(variant: FalconVariant) {
  if (variant === FALCON_VARIANT.FALCON_512) return falcon512padded;
  if (variant === FALCON_VARIANT.FALCON_1024) return falcon1024padded;
  throw new Error('Unknown Falcon variant');
}

export function verifyFalconSignature(rawPublicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    const variant = falconVariantFromKey(rawPublicKey);
    return signature.length === falconSignatureSize(variant) && algorithm(variant).verify(signature, message, rawPublicKey);
  } catch {
    return false;
  }
}

export interface FalconWalletOptions {
  networkName: 'kal_main' | 'kal_proto';
  /** Operator-published final block-zero hash, in hex. */
  genesisHash: string;
  variant?: FalconVariant;
  walletHash?: WalletHash;
}

/** Sensitive, unencrypted backup. Store it in the caller's protected key store. */
export interface FalconWalletBackup {
  version: 1;
  networkName: FalconWalletOptions['networkName'];
  genesisHash: string;
  variant: FalconVariant;
  walletHash: WalletHash;
  walletAddress: string;
  secretKey: string;
}

/** Single-key Falcon wallet. The selected hash is part of the wallet's identity. */
export class FalconWallet implements KalvoraSigner {
  readonly publicKey: string;
  readonly walletAddress: string;
  readonly variant: FalconVariant;
  readonly walletHash: WalletHash;
  readonly networkName: FalconWalletOptions['networkName'];
  readonly genesisHash: string;
  readonly #secretKey: Uint8Array;
  readonly #rawPublicKey: Uint8Array;
  readonly #chainId: Uint8Array;

  private constructor(options: FalconWalletOptions, rawPublicKey: Uint8Array, secretKey: Uint8Array) {
    this.#chainId = deriveChainId(options.networkName, options.genesisHash);
    this.networkName = options.networkName;
    this.genesisHash = options.genesisHash;
    this.variant = falconVariantFromKey(rawPublicKey);
    this.walletHash = options.walletHash ?? WALLET_HASH.BLAKE3_256;
    this.#rawPublicKey = rawPublicKey;
    this.#secretKey = secretKey;
    this.publicKey = bs58.encode(rawPublicKey);
    this.walletAddress = bs58.encode(deriveFalconAddress(rawPublicKey, this.walletHash));
  }

  static generate(options: FalconWalletOptions): FalconWallet {
    const keys = algorithm(options.variant ?? FALCON_VARIANT.FALCON_512).keygen();
    return new FalconWallet(options, keys.publicKey, keys.secretKey);
  }

  static restore(backup: FalconWalletBackup): FalconWallet {
    if (backup.version !== 1 || !Number.isInteger(backup.walletHash)) throw new Error('Invalid Falcon wallet backup');
    const secretLength = algorithm(backup.variant).lengths.secretKey as number;
    if (typeof backup.secretKey !== 'string' || backup.secretKey.length > Math.ceil(secretLength * 8 / Math.log2(58))) {
      throw new Error('Invalid Falcon backup secret key length');
    }
    const secretKey = bs58.decode(backup.secretKey);
    const rawPublicKey = algorithm(backup.variant).getPublicKey(secretKey);
    const wallet = new FalconWallet(backup, rawPublicKey, secretKey);
    if (wallet.walletAddress !== backup.walletAddress) throw new Error('Backup address does not match the Falcon key and wallet hash');
    return wallet;
  }

  get address(): string { return this.walletAddress; }
  get rawPublicKey(): Uint8Array { return this.#rawPublicKey.slice(); }
  get chainId(): Uint8Array { return this.#chainId.slice(); }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    return algorithm(this.variant).sign(data, this.#secretKey);
  }

  exportBackup(): FalconWalletBackup {
    return {
      version: 1, variant: this.variant, walletHash: this.walletHash, networkName: this.networkName,
      genesisHash: this.genesisHash, walletAddress: this.walletAddress, secretKey: bs58.encode(this.#secretKey)
    };
  }
}
