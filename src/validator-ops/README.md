# Validator operator transactions (`ValidatorRegistration`, `ValidatorHeartbeat`)

Transactions a validator **operator** sends about their own node:

| Transaction | Purpose | RPC |
|---|---|---|
| `ValidatorRegistration` | Register (`register: true`) or deregister (`register: false`) a validator node | `zera_validator.ValidatorService/ValidatorRegistration` |
| `ValidatorHeartbeat` | Report node liveness (`online`) and software `version` | `zera_validator.ValidatorService/ValidatorHeartbeat` |

These are **not** submitted through `TXNService`. The `send*` functions use
`createClient(ValidatorService, grpcConfig)`, so requests go to the
`/validator/...` path. You can pass `grpcConfig.transport` to use your own
ConnectRPC transport. Both `send*` functions reject unsigned transactions and
return the hex `base.hash`.

## Functions

| Function | Purpose |
|---|---|
| `buildValidatorRegistrationTXN(input, options?)` | Unsigned registration, with `generated_public_key` set and `generated_signature` empty |
| `attachGeneratedSignature(txn, generatedPrivateKey, generatedPublicKey)` | Sets `generated_signature = sign(base.hash)` on an operator-signed registration |
| `createValidatorRegistrationTXN(input, operatorPrivateKey, generatedKeyPair, options?)` | Build, then operator-sign, then generated-key co-sign |
| `sendValidatorRegistrationTXN(txn, grpcConfig?)` | Submit. Needs `base.signature`, `base.hash` and `generated_signature` |
| `buildValidatorHeartbeatTXN(input, options?)` | Unsigned heartbeat |
| `createValidatorHeartbeatTXN(input, privateKey, options?)` | Build + sign |
| `sendValidatorHeartbeatTXN(txn, grpcConfig?)` | Submit a signed heartbeat |

## Registration example

```typescript
import { createValidatorRegistrationTXN, sendValidatorRegistrationTXN } from 'kalvora.js';

const txn = await createValidatorRegistrationTXN(
  {
    publicKey: operator.publicKey,          // BaseTXN signer
    register: true,
    validator: {
      // publicKey defaults to the operator publicKey ("original public key")
      host: 'node1.example.com',
      clientPort: '50052',
      validatorPort: '50051',
      stakedContractIds: ['KALXvxhUMJERCse4e6b2jeXFkcqqpiUByQQckvPZm4szmF3Ao'],
      benchmark: 0,
      version: 100,
      lite: false,
      online: true
      // timestamp defaults to now
    }
  },
  operator.privateKey,
  { publicKey: node.publicKey, privateKey: node.privateKey } // node's generated key
);
const hash = await sendValidatorRegistrationTXN(txn);
```

## Heartbeat example

```typescript
import { createValidatorHeartbeatTXN, sendValidatorHeartbeatTXN } from 'kalvora.js';

const hb = await createValidatorHeartbeatTXN(
  { publicKey: operator.publicKey, online: true, version: 100 },
  operator.privateKey
);
const hash = await sendValidatorHeartbeatTXN(hb);
```

## Signing order and the generated-key signature

> **Assumption, not verified against the validator implementation.**
> The proto describes `generated_signature` as "signature of the generated
> public key (signing txn hash)". This module reads that as follows:
>
> 1. Build the transaction with `generated_public_key` set and
>    `generated_signature` empty.
> 2. Sign with the operator key (`signWithKey`). This sets `base.signature` and
>    then `base.hash = SHA3-256(serialized signed txn)`.
> 3. Set `generated_signature = sign(generatedPrivateKey, base.hash)`.
>
> Because step 3 runs after hashing, `generated_signature` is **not** covered
> by `base.signature` or `base.hash`.

If validators turn out to verify in a different order, compose the steps
yourself with the lower-level functions:

```typescript
import { buildValidatorRegistrationTXN, signWithKey, attachGeneratedSignature } from 'kalvora.js';

const txn = await buildValidatorRegistrationTXN({ ...input, generatedPublicKey: node.publicKey }, options);
signWithKey(txn, operator.privateKey, operator.publicKey);
attachGeneratedSignature(txn, node.privateKey, node.publicKey);
```

`attachGeneratedSignature` requires an operator-signed transaction whose
`generated_public_key` matches the key you pass. The generated key can be
Ed25519 (`A_…`, 64-byte signature) or Ed448 (`B_…`, 114-byte signature).

## Validation

| Field | Rule |
|---|---|
| `validator.host` | Non-empty string, no whitespace |
| `validator.clientPort`, `validator.validatorPort` | Integer or numeric string in `1`–`65535`, stored as a canonical decimal string |
| `validator.stakedContractIds` | Canonical Kalvora contract IDs with no duplicates. Defaults to `[]` |
| `validator.benchmark`, `validator.lastHeartbeat` | uint64. Default `0` |
| `validator.version`, heartbeat `version` | uint32 (`0`–`4294967295`). Registration default is `0` |
| `validator.timestamp` | Valid `Date`. Defaults to now |
| `register`, `online`, `lite` | Booleans |
| `publicKey`, `generatedPublicKey`, `validator.publicKey` | Valid Kalvora public key identifiers |

## Fees and offline building

The envelope uses the shared standard pipeline (`StandardTXNOptions`). Pass
both `nonce` and `feeAmountParts` to skip all network calls, and add
`timestamp` (plus `validator.timestamp`) to get byte-identical output.

The automatic fee accounts for the generated-key signature: a zero-filled
placeholder of the right size (64 bytes Ed25519, 114 bytes Ed448) is present
while fees are calculated and cleared before the transaction is returned.
