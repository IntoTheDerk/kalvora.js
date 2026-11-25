# Validator assignments and heartbeats

Register the owner and operational Falcon wallets separately using distinct keys. After both registrations finalize, wait until the following height and confirm the network has installed its validator-registration fee policy. Ordinary joins pay with native KALV. BLS handles consensus attestations.

```typescript
import { createValidatorRegistrationTXN, sendValidatorRegistrationTXN } from 'kalvora.js';

const assignment = await createValidatorRegistrationTXN({
  publicKey: owner.walletAddress,
  register: true,
  validator: { host, clientPort, validatorPort, version, attestationKey }
}, owner, operator, { grpcConfig });
const hash = await sendValidatorRegistrationTXN(assignment, grpcConfig);
```

The base and validator record both name the owner. The generated public key field names the operator. Both sign the same unsigned assignment. The final hash covers both proofs. To collect the proofs separately, use `buildValidatorRegistrationTXN`, `signAndFinalize` with the owner, then `attachGeneratedSignature(txn, owner, operator)`. Deregistration uses `register: false` and an absent operator.

```typescript
const heartbeat = await createValidatorHeartbeatTXN({
  publicKey: operator.walletAddress, ownerAddress: owner.walletAddress, online: true, version
}, operator, { grpcConfig });
await sendValidatorHeartbeatTXN(heartbeat, grpcConfig);
```

The operator signs a heartbeat with the owner's next nonce and fee budget. The memo limit is 64 UTF-8 bytes and the entire signed message limit is 4,096 bytes. The validator rejects sponsorship and interface fees. Read `lastSignedHeartbeatTimeSeconds` for signed heartbeat cadence and `lastHeartbeatTimeSeconds` for producer liveness.

Both send helpers call `kal_validator.ValidatorService` and return the transaction hash for receipt reconciliation.
