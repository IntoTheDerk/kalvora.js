# Validator operator transactions (`ValidatorRegistration`, `ValidatorHeartbeat`)

Transactions a validator **operator** sends about their own node:

| Transaction | Purpose | RPC |
|---|---|---|
| `ValidatorRegistration` | Register (`register: true`) or deregister (`register: false`) a validator node | `kal_validator.ValidatorService/ValidatorRegistration` |
| `ValidatorHeartbeat` | Report node liveness (`online`) and software `version` | `kal_validator.ValidatorService/ValidatorHeartbeat` |

These are **not** submitted through `TXNService`. The `send*` functions use
`createClient(ValidatorService, grpcConfig)`, so requests go to the
`/validator/...` path. You can pass `grpcConfig.transport` to use your own
ConnectRPC transport. Both `send*` functions reject unsigned transactions and
return the hex `base.hash`.

## Functions

| Function | Purpose |
|---|---|
| `buildValidatorRegistrationTXN(input, options?)` | Unsigned registration, with `generated_public_key` set and `generated_signature` empty |
| `attachGeneratedSignature(txn, generatedPrivateKey, generatedPublicKey, context?)` | Sets `generated_signature = sign(base.hash)` on an operator-signed registration |
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

V1 registration signing follows this order:

1. Pin the operator-supplied chain ID with `configureTransactionContext({ chainId })`.
   Build the complete transaction, including the ordinary `KAL_USER_TXN_V1`
   domain, registration intended type, and `generated_public_key`.
2. With `base.signature`, `base.hash`, and `generated_signature` absent,
   sign the transaction with the operator key. Hash the operator-signed
   transaction with `base.hash` and `generated_signature` still absent.
3. Validate that the context still matches the trusted chain and sign the raw
   `base.hash` bytes with the generated operational key. The co-signer first
   verifies that this hash matches the owner-signed registration body.

The operational co-signature is outside the owner signature and transaction
hash. Both signers reject missing or foreign context. The lower-level pipeline
is:

```typescript
import { buildValidatorRegistrationTXN, signWithKey, attachGeneratedSignature } from 'kalvora.js';

const txn = await buildValidatorRegistrationTXN({ ...input, generatedPublicKey: node.publicKey }, options);
signWithKey(txn, operator.privateKey, operator.publicKey);
attachGeneratedSignature(txn, node.privateKey, node.publicKey);
```

`attachGeneratedSignature` requires an operator-signed transaction whose
`generated_public_key` matches the key you pass. Its optional fourth argument
accepts an explicit trusted signing context; otherwise it uses the configured
chain pin. The generated key can be
Ed25519 (`A_…`, 64-byte signature) or Ed448 (`B_…`, 114-byte signature).

## Validation

| Field | Rule |
|---|---|
| `validator.host` | Non-empty string, no whitespace |
| `validator.clientPort`, `validator.validatorPort` | Integer or numeric string in `1`–`65535`, stored as a canonical decimal string |
| `validator.stakedContractIds` | Removed in 0.0.1-alpha.0 (`Validator` field 5 is reserved; staking is KALV-only). Passing it throws |
| `validator.benchmark`, `validator.lastHeartbeat` | uint64. Default `0` |
| `validator.attestationKey` | Optional `{ version, publicKey, proofOfPossession }`: uint64 version, 48-byte BLS12-381 G1 key, 96-byte G2 proof. Consensus verifies the proof |
| `validator.version`, heartbeat `version` | uint32 (`0`–`4294967295`). Registration default is `0` |
| `validator.timestamp` | Valid `Date`. Defaults to now |
| `register`, `online`, `lite` | Booleans |
| `publicKey`, `generatedPublicKey`, `validator.publicKey` | Valid Kalvora public key identifiers |

The committed `lastHeartbeatTimeSeconds` is maintained by consensus; a
registration does not set this liveness timestamp.

## Fees and offline building

The envelope uses the shared standard pipeline (`StandardTXNOptions`). Pass
both `nonce` and `feeAmountParts` to skip all network calls, and add
`timestamp` (plus `validator.timestamp`) to get byte-identical output.

The automatic fee accounts for the generated-key signature: a zero-filled
placeholder of the right size (64 bytes Ed25519, 114 bytes Ed448) is present
while fees are calculated and cleared before the transaction is returned.
