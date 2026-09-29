/** Browser-safe Smart Swap integration using an injected Kalvora indexer. */

import {
  createSmartSwap,
  deserializeTransaction,
  signAndFinalize,
  SMART_SWAP_TRANSACTION_TYPE,
  sendSmartContractExecuteTXN,
  type GRPCConfig,
  type SmartContractExecuteTXN,
  type SmartSwapIndexerClient,
  type KalvoraSigner
} from '../../../../../../../index.js';

export async function quoteAndBuildSwap(
  indexer: SmartSwapIndexerClient,
  signer: KalvoraSigner,
  grpcConfig: GRPCConfig,
  reviewTransaction: (transaction: SmartContractExecuteTXN) => void | Promise<void>
): Promise<string> {
  const swaps = createSmartSwap(indexer);
  const quote = await swaps.getQuote({
    tokenIn: 'LEET1337',
    tokenOut: 'solana-SOL000000',
    amountIn: 10
  });

  const built = await swaps.swapFromStages({
    stages: quote.stages,
    minAmountOut: String(quote.netAmountOut * 0.995),
    feeContractID: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao'
  }, signer.publicKey);

  const unsigned = deserializeTransaction(built.transaction);
  if (unsigned.$typeName !== SMART_SWAP_TRANSACTION_TYPE) {
    throw new Error(`Unexpected Smart Swap transaction type: ${unsigned.$typeName}`);
  }
  const execute = unsigned as SmartContractExecuteTXN;
  await reviewTransaction(execute);
  const signed = await signAndFinalize(execute, signer);
  return sendSmartContractExecuteTXN(signed, grpcConfig);
}
