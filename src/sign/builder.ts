import type { Message } from '@bufbuild/protobuf';

import type { BaseTXN } from '../../proto/generated/txn_pb.js';
import type { ProofLayout, SignerProofLayout } from '../shared/fee-calculators/proof-layout.js';
import type { GRPCConfig } from '../types/index.js';

import type { TransactionContext } from './context.js';
import { signAndFinalize, signWithKey, type TransactionSigner } from './finalize.js';

/** Registered single-key or policy signer, or a private key for a historical Ed envelope. */
export type SigningKey = TransactionSigner | string;

export function proofLayoutForSigner(key: SigningKey): SignerProofLayout | undefined {
  if (typeof key === 'string') return undefined;
  if (!('policy' in key)) return key.variant;
  return key.members.map(({ slot, signer }) => {
    if (signer.variant === undefined) throw new Error('Policy fee quotes require the Falcon variant for each selected slot');
    return { slot, variant: signer.variant };
  });
}

export function signBuiltTransaction<T extends Message & { base?: BaseTXN }>(
  txn: T, key: SigningKey, identity: string, context?: TransactionContext
): Promise<T> | T {
  return typeof key === 'string' ? signWithKey(txn, key, identity, context) : signAndFinalize(txn, key, context);
}

/** Use the signer's selected proof shape and trusted deployment during construction. */
export function optionsForSigner<T extends { grpcConfig?: GRPCConfig; proofLayout?: ProofLayout | undefined }>(
  options: T, key: SigningKey
): T {
  if (typeof key === 'string') return options;
  const chainId = 'policy' in key ? key.members[0]?.signer.chainId : key.chainId;
  const owner = options.proofLayout?.owner ?? proofLayoutForSigner(key);
  return {
    ...options,
    ...(owner !== undefined && { proofLayout: { ...options.proofLayout, owner } }),
    ...(chainId && !options.grpcConfig?.transactionContext && { grpcConfig: { ...options.grpcConfig, transactionContext: { chainId } } })
  };
}
