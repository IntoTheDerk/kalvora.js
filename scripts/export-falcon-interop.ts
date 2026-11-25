import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { create, toBinary } from '@bufbuild/protobuf';

import { TokenFeeInfoSchema } from '../proto/generated/kal_api_pb.js';
import { CoinTXNSchema, WalletRegistrationSchema } from '../proto/generated/txn_pb.js';
import { buildCoinTXN } from '../src/coin-txn/transaction.js';
import { KALVORA_NATIVE_TOKEN } from '../src/shared/network/constants.js';
import { signAndFinalize, signCoinTXN } from '../src/sign/finalize.js';
import { FalconWallet } from '../src/wallet-creation/falcon.js';
import { buildWalletRegistration } from '../src/wallet-registration/index.js';

// The settlement fixture binds kal_main to this synthetic block zero.
const directory = process.argv[2];
if (!directory) throw new Error('Usage: tsx scripts/export-falcon-interop.ts <output-directory>');
const network = { networkName: 'kal_main' as const, genesisHash: '47'.repeat(32) };
const owner = FalconWallet.generate(network);
const recipient = FalconWallet.generate(network);
const grpcConfig = { transactionContext: { chainId: owner.chainId } };
// The fixture prices in 10^-18 parts and charges for the recipient's first balance row.
const cap = '1000000000000000000';
const registration = await buildWalletRegistration(owner, { nonce: 1, feeAmountParts: cap, grpcConfig });
await signAndFinalize(registration, owner);
const token = create(TokenFeeInfoSchema, { contractId: KALVORA_NATIVE_TOKEN, denomination: '1000000000' });
const coin = await buildCoinTXN(
  [{ publicKey: owner.walletAddress, nonce: 2, amount: '0.000000007' }],
  [{ to: recipient.walletAddress, amount: '0.000000007' }], KALVORA_NATIVE_TOKEN,
  { baseFeeParts: cap }, '', grpcConfig, { tokenInfoMap: new Map([[token.contractId, token]]) }
);
await signCoinTXN(coin, [owner]);
await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'registration.pb'), toBinary(WalletRegistrationSchema, registration));
await writeFile(join(directory, 'coin.pb'), toBinary(CoinTXNSchema, coin));
