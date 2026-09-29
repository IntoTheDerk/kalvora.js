/**
 * Wire-constant pins.
 *
 * These constants carry exact strings and numbers that wallet apps, the
 * bridge guardian network and deployed contracts match byte-for-byte. The SDK
 * gives them Kalvora names, but their values must never change. Every value is
 * spelled out here on purpose; a failure means a protocol-breaking change.
 */
import { describe, expect, it } from 'vitest';

import * as sdk from '../../index.js';
import { NETWORK_TYPE } from '../../proto/generated/guardian_pb.js';
import { KALVORA_ADAPTER_BROADCAST, KALVORA_ADAPTER_STORAGE_KEYS } from '../adapter/constants.js';
import { BRIDGE_CONTRACT_NAME, BRIDGE_FUNCTIONS } from '../smart-contracts/use-cases/bridge/kalvora/utils.js';
import { CORE_PROGRAM_ID } from '../smart-contracts/use-cases/bridge/solana/constants.js';

describe('wallet protocol constants', () => {
  it('pins the injected provider global and identity flag', () => {
    expect(sdk.KALVORA_INJECTED_PROVIDER_KEY).toBe('zera');
    expect(sdk.KALVORA_PROVIDER_FLAG).toBe('isZeraWallet');
  });

  it('pins the provider request methods', () => {
    expect(sdk.KALVORA_PROVIDER_METHODS).toEqual({
      requestAccounts: 'zera_requestAccounts',
      signTransaction: 'zera_signTransaction',
      disconnect: 'zera_disconnect'
    });
  });

  it('pins the deep-link scheme and default base URL', () => {
    expect(sdk.KALVORA_DEEP_LINK_SCHEME).toBe('zera-wallet');
    expect(sdk.KALVORA_DEFAULT_DEEP_LINK).toBe('zera-wallet://');
  });

  it('pins the deep-link callback parameters', () => {
    expect(sdk.KALVORA_DEEP_LINK_PARAMS).toEqual({
      result: 'zera_result',
      error: 'zera_error',
      address: 'zera_address',
      requestId: 'zera_request_id'
    });
  });

  it('pins the adapter storage keys and cross-tab channel', () => {
    expect(KALVORA_ADAPTER_STORAGE_KEYS).toEqual({
      connection: 'zera-wallet-adapter',
      pendingConnect: 'zera-wallet-pending',
      pendingSign: 'zera-wallet-sign-pending'
    });
    expect(KALVORA_ADAPTER_BROADCAST).toEqual({
      channel: 'zera-wallet-bridge',
      connectResult: 'zera-connect-result',
      connectError: 'zera-connect-error',
      signResult: 'zera-sign-result',
      signError: 'zera-sign-error'
    });
  });

  it('pins the WalletConnect namespace and methods', () => {
    expect(sdk.KALVORA_WC_NAMESPACE).toBe('zera');
    expect(sdk.KALVORA_WC_METHODS).toEqual(['zera_getAccounts', 'zera_signTransaction', 'zera_signMessage']);
    expect(Object.keys(sdk.KALVORA_WC_REQUIRED_NAMESPACES)).toEqual(['zera']);
  });

  it('pins the legacy transaction type prefix', () => {
    expect(sdk.LEGACY_TXN_TYPE_PREFIX).toBe('zera_txn.');
  });
});

describe('guardian protocol constants', () => {
  it('pins the Kalvora network type and payload case', () => {
    expect(sdk.NETWORK_TYPE_KALVORA).toBe(0);
    expect(sdk.NETWORK_TYPE_KALVORA).toBe(NETWORK_TYPE.ZERA);
    expect(sdk.GUARDIAN_KALVORA_PAYLOAD_CASE).toBe('zeraPayload');
  });
});

describe('on-chain names', () => {
  it('pins the DEX proxy contract name', () => {
    expect(sdk.dex.DEX_CONTRACT_NAME).toBe('zera_dex_proxy');
  });

  it('pins the bridge proxy contract and function names', () => {
    expect(BRIDGE_CONTRACT_NAME).toBe('zera_bridge_proxy');
    expect(BRIDGE_FUNCTIONS).toEqual({
      lockKalvora: 'lock_zera',
      releaseKalvora: 'release_zera',
      burnSol: 'burn_sol',
      mintSol: 'mint_sol',
      createSol: 'create_sol'
    });
  });

  it('pins the Solana core bridge program id', () => {
    expect(CORE_PROGRAM_ID).toBe('zera3giq7oM9QJaD6mY1ajGmakv9TZcax5Giky99HD8');
  });
});
