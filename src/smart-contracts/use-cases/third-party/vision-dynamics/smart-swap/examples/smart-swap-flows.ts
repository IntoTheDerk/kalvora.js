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
  type KalvoraSigner,
  KALVORA_NATIVE_TOKEN
} from '../../../../../../../index.js';

export async function quoteAndBuildSwap(
  indexer: SmartSwapIndexerClient,
  signer: KalvoraSigner & { walletAddress: string; chainId: Uint8Array },
  grpcConfig: GRPCConfig,
  tokenIn: string,
  tokenOut: string,
  reviewTransaction: (transaction: SmartContractExecuteTXN) => void | Promise<void>
): Promise<string> {
  const swaps = createSmartSwap(indexer);
  const quote = await swaps.getQuote({
    tokenIn,
    tokenOut,
    amountIn: 10
  });

  const built = await swaps.swapFromStages({
    stages: quote.stages,
    minAmountOut: String(quote.netAmountOut * 0.995),
    feeContractID: KALVORA_NATIVE_TOKEN
  }, signer.walletAddress);

  const unsigned = deserializeTransaction(built.transaction);
  if (unsigned.$typeName !== SMART_SWAP_TRANSACTION_TYPE) {
    throw new Error(`Unexpected Smart Swap transaction type: ${unsigned.$typeName}`);
  }
  const execute = unsigned as SmartContractExecuteTXN;
  await reviewTransaction(execute);
  const signed = await signAndFinalize(execute, signer, grpcConfig.transactionContext);
  return sendSmartContractExecuteTXN(signed, grpcConfig);
}
