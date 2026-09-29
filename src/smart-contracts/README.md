# Smart Contracts

Helpers for deploying, instantiating, and executing Kalvora smart contracts.

The public API follows the same transaction pattern used elsewhere in the SDK:

| Step | Unsigned builder | Build + sign | Submit |
| ---- | ---------------- | ------------ | ------ |
| Deploy | `buildSmartContractTXN()` | `createSmartContractTXN()` | `sendSmartContractTXN()` |
| Instantiate | `buildSmartContractInstantiateTXN()` | `createSmartContractInstantiateTXN()` | `sendSmartContractInstantiateTXN()` |
| Execute | `buildSmartContractExecuteTXN()` | `createSmartContractExecuteTXN()` | `sendSmartContractExecuteTXN()` |

Deploy aliases are also available for callers that prefer explicit naming:

- `buildSmartContractTXN()`
- `createSmartContractTXN()`
- `sendSmartContractTXN()`

## Deploy

```typescript
import {
  LANGUAGE,
  createSmartContractTXN,
  sendSmartContractTXN
} from 'kalvora.js';

const deployTxn = await createSmartContractTXN({
  smartContractName: 'hello_contract_rust',
  binaryCode: compiledRustWasmBytes,
  sourceCode: 'ipfs://bafybeihash/hello_contract.rs',
  language: LANGUAGE.COMPILED,
  functions: ['init', 'execute'],
  publicKeyBase58Identifier,
  privateKeyBase58,
  memo: 'Deploy hello_contract_rust'
});

const deployHash = await sendSmartContractTXN(deployTxn);
```

Rust contracts should be deployed as compiled bytes, commonly WASM or another network-supported compiled artifact, using `LANGUAGE.COMPILED`. `sourceCode` is optional. It is stored in the `source_code` protobuf field and is commonly used for source text, an IPFS CID, a GitHub URL, or another durable reference for storage, audit, or explorer display purposes.

Compiled deployments can omit `sourceCode` and use `LANGUAGE.COMPILED`:

```typescript
const deployTxn = await createSmartContractTXN({
  smartContractName: 'hello_contract_rust',
  binaryCode: compiledRustWasmBytes,
  language: LANGUAGE.COMPILED,
  functions: ['init', 'execute'],
  publicKeyBase58Identifier,
  privateKeyBase58
});
```

## Instantiate

```typescript
import {
  ParamType,
  createSmartContractInstantiateTXN,
  sendSmartContractInstantiateTXN
} from 'kalvora.js';

const instantiateTxn = await createSmartContractInstantiateTXN({
  smartContractName: 'hello_contract',
  instance: 1,
  parameters: [
    { type: ParamType.STRING, value: 'owner-wallet-address' },
    { type: ParamType.UINT64, value: 1000 }
  ],
  publicKeyBase58Identifier,
  privateKeyBase58,
  memo: 'Instantiate hello_contract'
});

const instantiateHash = await sendSmartContractInstantiateTXN(instantiateTxn);
```

## Execute

```typescript
import {
  ParamType,
  createSmartContractExecuteTXN,
  sendSmartContractExecuteTXN
} from 'kalvora.js';

const executeTxn = await createSmartContractExecuteTXN(
  'hello_contract',
  1,
  'execute',
  [{ type: ParamType.STRING, value: 'payload' }],
  publicKeyBase58Identifier,
  privateKeyBase58,
  { gasFeeInUsd: 0.05, memo: 'Execute hello_contract' }
);

const executeHash = await sendSmartContractExecuteTXN(executeTxn);
```

## Offline Building

All smart contract transaction builders support manual `nonce` and `feeAmountParts` options. When no `gasFeeInUsd` is requested, this lets you build and sign offline without fetching nonce or fee data from the network.

```typescript
const unsigned = await buildSmartContractInstantiateTXN({
  smartContractName: 'hello_contract',
  instance: 1,
  parameters: [],
  publicKeyBase58Identifier,
  nonce: '15',
  feeId: 'KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao',
  feeAmountParts: '500000000'
});
```

Manual nonce and fee values are not validated by the SDK and can cause network rejection if incorrect.

## Examples

```bash
npx tsx src/smart-contracts/deploy/examples/basic-deploy-example.ts
npx tsx src/smart-contracts/instantiate/examples/basic-instantiate-example.ts
npx tsx src/smart-contracts/execute/examples/basic-execute-example.ts
```
