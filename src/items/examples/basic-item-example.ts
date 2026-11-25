/** Run each example with a registered wallet and the real collection ID.
 * Pass { grpcConfig: client.grpcConfig } from your pinned client for online lookups.
 * For offline signing, also pass a confirmed next nonce and an approved feeAmountParts cap.
 */
import type { FalconWallet } from '../../wallet-creation/falcon.js';
import {
  buildItemizedMintTXN, createBurnSBTTXN, createItemizedMintTXN, createNFTTXN, type StandardItemTXNOptions
} from '../index.js';

export function buildNftMint(minter: FalconWallet, nftId: string, recipient: string, options: StandardItemTXNOptions) {
  return buildItemizedMintTXN({
    ...options,
    contractId: nftId,
    itemId: '42',
    recipientAddress: recipient,
    publicKeyBase58Identifier: minter.walletAddress,
    parameters: [{ key: 'name', value: 'Genesis Item' }],
    grpcConfig: {
      ...options.grpcConfig,
      transactionContext: options.grpcConfig?.transactionContext ?? { chainId: minter.chainId }
    }
  });
}

export function signSbtMint(minter: FalconWallet, sbtId: string, recipient: string, options: StandardItemTXNOptions) {
  return createItemizedMintTXN({
    ...options, contractId: sbtId, itemId: '7', votingWeight: '1', recipientAddress: recipient,
    publicKeyBase58Identifier: minter.walletAddress, privateKeyBase58: minter
  });
}

/** The holder transfers a fee-free example NFT. Supply applicable fee caps for a fee-bearing item. */
export function signNftTransfer(holder: FalconWallet, nftId: string, recipient: string, options: StandardItemTXNOptions) {
  return createNFTTXN({
    ...options, contractId: nftId, itemId: '42', recipientAddress: recipient,
    publicKeyBase58Identifier: holder.walletAddress, privateKeyBase58: holder
  });
}

export function signSbtBurn(holder: FalconWallet, sbtId: string, options: StandardItemTXNOptions) {
  return createBurnSBTTXN({
    ...options, contractId: sbtId, itemId: '7',
    publicKeyBase58Identifier: holder.walletAddress, privateKeyBase58: holder
  });
}
