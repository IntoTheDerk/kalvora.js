# November 25 protocol migration overview

The SDK can generate a Falcon wallet, register it, and spend seven kalvs from that address in the following block. The Linux validator accepted both SDK-generated protobuf messages and reproduced the resulting balance and nonce after replay and restart. **The live network rehearsal is deferred.**

This overview covers the SDK changes for validator 200030 and attestation protocol 33. The [original migration handoff](kalvora-js-protocol-handoff-2026-11-25/documents/howto/kalvora_js_protocol_handoff.md) records the validator revision and launch profile.

## What changed

| Area | What applications can do now |
| --- | --- |
| Wire format | Use the synced transaction, validator and API schemas through the existing protobuf namespaces. Registration has transaction type 25, block field 30 and wrapper field 32. The build regenerates all four public SDK modules, including the existing guardian module. Archive line endings are pinned to preserve the supplied checksums across operating systems. |
| Wallets and adapters | Generate and restore padded Falcon-512 or Falcon-1024 keys. Store the selected hash and complete receiving address. All eleven hash choices are supported, including the 1,126-byte address. Injected, deep-link and WalletConnect signers can identify the selected address independently of the raw key. See [wallets](../src/wallet-creation/README.md) and [adapter integration](adapter-integration-guide.md). |
| Network identity | Derive the 32-byte wire chain ID from the network name and trusted final block-zero hash. Builders set the signed context before pricing. Signers verify the chain and intended transaction type. The operator supplies the deployment pin. |
| Registration and payment | Build a self-funded or sponsored wallet registration. Use the selected wallet address in subsequent transactions. Register a policy after its members and use its own nonce. Coin authorizations support individual or policy proofs and separate base-fee and contract-fee shares. Coin, Mint and ItemizedMint expose safe send. NFT transfers reject that option. |
| Signing and fees | Single-key owners, selected policy witnesses, sponsors and validator operators have distinct signature placement. The final SHA3-256 hash includes all proofs. Fee sizing uses encoded placeholders for the selected proof shapes and the decimal cap. Root authentication limits include nested children. See [signing](../src/sign/README.md). |
| RPCs and receipts | Submit a registration, resolve a registered key or policy, and page active proposal voters against a state digest. Match status-bearing receipts by hash, decode wallet registrations, governance group markers and failed executions, and verify signed responses against an expected registered operator. See [query clients](../src/query/README.md). |
| Governance | Build granular proposals and ballots, preserve a negative vote or option zero, price council steps, and represent ordered PRE and POST review. Regular results use the frozen per-instrument ratios and integer arithmetic. |
| Contracts and grants | Derive wallet-created IDs with the V2 domain and the full address. Internal governance and smart-contract creators retain the V1 domain. Validate typed direct grants, the single parent and a direct recovery authority. A nonempty update replaces the whole grant list. See [instrument contracts](../src/contract/README.md). |
| Validator operations | Assign separate registered owner and operator wallets. Both sign the same assignment bytes and the final hash covers both proofs. Deregistration carries only the owner proof. Heartbeats use the operator signature with the owner's nonce and enforce memo, size and fee-field limits. Validator records expose separate timestamps for signed heartbeats and producer liveness. See [validator operations](../src/validator-ops/README.md). |
| Smart contracts | Execute and instantiate with signed gas and caller-wallet spending budgets. Include the applicable asset fees in those budgets. A contract paying fees from its own wallet must opt in through the Wasm fee-limit import in its wrapper. See [smart contracts](../src/smart-contracts/README.md). |

## Migrating an application

1. Obtain the network name, trusted final block-zero hash and endpoints from the operator. Pin the client to that deployment.
2. Generate a fresh Falcon wallet, save its backup in protected storage and display its selected Base58 address. Existing Ed backups remain historical. The new address may receive an ordinary payment before registration.
3. Prefund its first registration or arrange a distinct registered sponsor. Use the owner's next nonce and the sponsor's independent nonce. Persist the signed bytes and hash before submission.
4. Match the registration hash to a successful receipt in a trusted finalized block. Registration in block H becomes eligible for spending, sponsorship and safe-send receipt in H+1. After a timeout, reconcile the original receipt, registry and nonce before deciding to resubmit identical bytes.

The [quick start](../README.md#quick-start) shows a self-funded registration. The [fixture exporter](../scripts/export-falcon-interop.ts) builds the complete registration and payment offline with a synthetic chain pin.

## Verification

| Check | Evidence |
| --- | --- |
| Wire compatibility | SDK tests cover all 22 supplied key/address pairs, three frozen registrations and five contract-ID vectors. All 30 archived files and the three synced SDK protos match their SHA-256 checksums. |
| Wallet runtimes | Node 24.13 and headless Microsoft Edge exercised local Falcon signing. Edge generated, backed up, restored, signed and verified both variants through the wallet entry point. The declared Node floor is 20.19. |
| SDK to Linux validator | Passed the native `falcon-wallet-settlement-test --client-interop` with a freshly signed registration at nonce 1 and a seven-kalv payment at authorization nonce 2. The fixture checked execution, balances, nonces, replay and restart persistence. A first attempt exposed the first-balance-row fee. The exporter now supplies the fixture's adequate cap. |
| Fee boundary | The local native fixture accepted caps of 1,779 parts for registration and 200,000,000,000,001,031 parts for Coin with its new balance row. Independently reducing either cap by one part and re-signing caused rejection. These amounts describe this fixture and fee schedule. |
| SDK validation | `npm run validate` passed type-checking and lint with zero warnings. The full suite passed 1,219 tests. Six opt-in network tests were skipped. |
| Package build | `npm run build` succeeded. `npm run build:validate-bundles` passed all 16 checks, including browser loading and parity across the 302 CommonJS and ESM exports. |

## Remaining work

| Owner | Action | Completion evidence |
| --- | --- | --- |
| Network operator and application team | Schedule the deferred rehearsal and supply the deployed profile, network name, independently verified final genesis hash, service endpoints, TLS trust and expected operator identity. | The client can bind to the intended finalized network. |
| SDK and wallet teams | Rehearse zero-balance sponsored registration, mixed-variant policy spending, fee boundaries, safe send across H/H+1, wrong chain/type and timeout recovery. Exercise wide addresses through a deployed query and wallet adapter. | Finalized receipts, balances, registry and nonce observations for each scenario. |
| Governance and validator operators | Rehearse a governance state change between voter pages, PRE/POST step zero, a grouped child terminal receipt, signed search responses and a dual-signed validator assignment. Use native KALV for that assignment after the validator registration fee policy is installed. | Verified page restarts, exact signed reply and receipt matches, and the finalized owner/operator record. |
| Wallet integrators | Exercise real injected, deep-link and WalletConnect providers and the target React Native runtime. | Verified receiving address, backup recovery and both signature variants on the supported devices. |
| Release maintainer | Review and merge the migration, select a release version and publish after the rehearsal. | Reviewed commit, release tag and published package. |
