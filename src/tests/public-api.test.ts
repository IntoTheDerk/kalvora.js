/**
 * Public API contract for the package root (`index.ts`).
 *
 * Guards the 1.0 surface: every transaction type exposes build/create/send,
 * namespaces are present, legacy 1.x names stay removed, and VERSION matches
 * package.json.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as sdk from '../../index.js';

const TRANSACTION_TYPES = [
  'CoinTXN',
  'MintTXN',
  'ContractTXN',
  'ContractUpdateTXN',
  'RevokeTXN',
  'QuashTXN',
  'ComplianceTXN',
  'ExpenseRatioTXN',
  'AllowanceTXN',
  'DelegatedTXN',
  'ItemizedMintTXN',
  'NFTTXN',
  'BurnSBTTXN',
  'VoteTXN',
  'ProposalCancelTXN',
  'SmartContractTXN',
  'SmartContractInstantiateTXN',
  'SmartContractExecuteTXN',
  'ValidatorRegistrationTXN',
  'ValidatorHeartbeatTXN'
] as const;

const exported = sdk as unknown as Record<string, unknown>;

describe('package root exports', () => {
  it.each(TRANSACTION_TYPES)('exposes build/create/send for %s', type => {
    for (const verb of ['build', 'create', 'send']) {
      expect(exported[`${verb}${type}`], `${verb}${type}`).toBeTypeOf('function');
    }
  });

  it('exposes governance proposal lifecycle', () => {
    expect(sdk.buildTextGovernanceProposalTXN).toBeTypeOf('function');
    expect(sdk.createTextGovernanceProposalTXN).toBeTypeOf('function');
    expect(sdk.sendGovernanceProposalTXN).toBeTypeOf('function');
  });

  it('exposes the client, query clients, and error model', () => {
    expect(sdk.KalvoraClient).toBeTypeOf('function');
    expect(sdk.createQueryClient).toBeTypeOf('function');
    expect(sdk.createValidatorQueryClient).toBeTypeOf('function');
    expect(sdk.createGuardianQueryClient).toBeTypeOf('function');
    expect(sdk.KalvoraRpcError).toBeTypeOf('function');
    expect(sdk.RpcCode.NotFound).toBe(5);
    expect(sdk.KALVORA_NETWORKS.protonet.nativeToken).toBe(sdk.KALVORA_NATIVE_TOKEN);
  });

  it('exposes namespaces', () => {
    for (const ns of ['staking', 'bootstrapping', 'dex', 'solanaBridge', 'guardianBridge', 'smartSwap', 'proto']) {
      expect(exported[ns], ns).toBeTypeOf('object');
    }
    expect(sdk.proto.txn.CoinTXNSchema.typeName).toBe('zera_txn.CoinTXN');
    expect(sdk.proto.api.APIService.typeName).toBe('zera_api.APIService');
  });

  it('does not re-export removed 1.x names', () => {
    const legacy = Object.keys(exported).filter(name =>
      /Zera|ZERA_|^ZV_|MAINNET_GRPC|TESTNET_GRPC|ItemMintTXN$|NFTTransfer|SmartContractDeploy/u.test(name) ||
      ['getNonce', 'getNonces', 'getBalance', 'getBalances', 'getBaseFee', 'getExchangeRate',
        'createContract', 'updateContract', 'sendCreateContract', 'sendUpdateContract'].includes(name)
    );
    expect(legacy).toEqual([]);
  });

  it('keeps VERSION in sync with package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(sdk.VERSION).toBe(pkg.version);
  });
});
