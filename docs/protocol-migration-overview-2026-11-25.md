# November 25 protocol migration overview

The SDK can generate a Falcon wallet, register it, and spend seven kalvs from that address in the following block. The Linux validator accepted both SDK-generated protobuf messages and reproduced the resulting balance and nonce after replay and restart. **The live network rehearsal is deferred.**

The original handoff targets validator `200030`, attestation protocol 33. The intended `kal_proto` rehearsal uses v35 (`200032`, Wasm preparation gas enabled). The three public SDK protobufs are byte-identical across the archived handoff and the local v35 source. The launch version is part of the signed genesis, so the rehearsal needs its own verified block-zero hash and operator assignment. [Original handoff](kalvora-js-protocol-handoff-2026-11-25/documents/howto/kalvora_js_protocol_handoff.md) · [Pull request and CI](https://github.com/IntoTheDerk/kalvora.js/pull/13)

## What changed

| Area | What applications can do now |
| --- | --- |
| Wire format | Use the synced transaction, validator and API schemas through the existing protobuf namespaces. Registration has transaction type 25, block field 30 and wrapper field 32. The build regenerates all four public SDK modules, including the existing guardian module. Archive line endings are pinned to preserve the supplied checksums across operating systems. |
| Wallets and adapters | Generate and restore padded Falcon-512 or Falcon-1024 keys. Store the selected hash and complete receiving address. All eleven hash choices are supported, including the 1,126-byte address. Injected, deep-link and WalletConnect signers can identify the selected address independently of the raw key. See [wallets](../src/wallet-creation/README.md) and [adapter integration](adapter-integration-guide.md). |
| Network identity | Derive the 32-byte wire chain ID from the network name and trusted final block-zero hash. Builders set the signed context before pricing. Signers verify the chain and intended transaction type. The operator supplies the deployment pin. |
| Registration and payment | Build a self-funded or sponsored wallet registration. Use the selected wallet address in subsequent transactions. Register a policy after its members and use its own nonce. Coin authorizations support individual or policy proofs and separate base-fee and contract-fee shares. Coin, Mint and ItemizedMint expose safe send. NFT transfers reject that option. |
| Signing and fees | Single-key owners, selected policy witnesses, sponsors and validator operators have distinct signature placement. The final SHA3-256 hash includes all proofs. Fee sizing uses encoded placeholders for the selected proof shapes and the decimal cap. Root authentication limits include nested children. See [signing](../src/sign/README.md). |
| RPCs and receipts | Submit a registration, resolve a registered key or policy, and page active proposal voters against a state digest. Match status-bearing receipts by hash, decode governance group markers and failed executions, and verify signed responses against the expected operator. With a finality verifier, polling revisits a provisional height so a replacement block can supply the receipt. See [query clients](../src/query/README.md). |
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

For application code, see the [wallet example](../src/wallet-creation/examples/basic-usage.ts), [registered vote](../src/vote/examples/registered-vote.ts), [instrument contract example](../src/contract/create/examples/example.ts) and [governance proposals](../src/proposal/README.md). Retained Ed examples are labeled as historical and point to the current signing flow.

For the later rehearsal, the [read-only checks](../src/query/tests/live.test.ts) can compare the served genesis hash and verify the expected operator's signed contract response. Set `KALVORA_LIVE_VALIDATOR_VERSION=200032` to also check the v35 genesis header version. The separate [proposal submission test](../src/proposal/tests/live-coin-proposal.test.ts) requires explicit opt-in and a funded, registered protonet wallet. Its header lists the environment variables.

## Second-pass fixes before the rehearsal

| Area | What the second review changed |
| --- | --- |
| Amounts and fees | Coin uses the actual parts-per-token denomination. Fixed contract fees are interpreted in their first allowed fee instrument before conversion to the selected fee instrument. Large transfer amounts and gas caps retain integer precision. Updating a cap after partial signing requires fresh proofs. |
| Proofs and recipients | Nested governance children receive authentication checks, and policy registrations reject unknown fields. Coin, Mint, item, compliance and allowance paths validate destination widths and padding. Burn and proposal-address exceptions follow the rules of each operation. |
| Contracts | Creation verifies a supplied wallet-created ID even when its vanity nonce defaults to zero. The builder validates token supply, denomination and premints, and rejects duplicate grant authorities and self-parent grants. |
| Governance and receipts | Adaptive proposals enforce the 90-day deadline and council restrictions. Proposal reads preserve POST state and a winning option of zero. V35 can finish several closing steps in one certified block. The decoder retains ordered results from that block. Receipt lookup checks hash width, marker fields and returned block height. |
| Timeouts and wallet selection | Unary RPCs honor the configured timeout. Receipt polling can end during a stalled read or finality check. An offline regression reconciles a committed registration after a lost acknowledgement using the original signed hash, finalized receipt, nonce and registry. Injected-wallet selection follows the selected address even if multiple addresses share one public key. |

## Verification

| Check | Evidence |
| --- | --- |
| Wire compatibility | SDK tests cover all 22 supplied key/address pairs, three frozen registrations and five contract-ID vectors. All 30 archived files and the three synced SDK protos match their SHA-256 checksums. |
| Wallet runtimes | Node 24.13 and headless Microsoft Edge exercised local Falcon signing. Edge generated, backed up, restored, signed and verified both variants through the wallet entry point. The declared Node floor is 20.19. |
| SDK to Linux validator | Passed the native `falcon-wallet-settlement-test --client-interop` with a freshly signed registration at nonce 1 and a seven-kalv payment at authorization nonce 2. The fixture checked execution, balances, nonces, replay and restart persistence. A first attempt exposed the first-balance-row fee. The exporter now supplies the fixture's adequate cap. |
| V35 native acceptance | Fresh SDK registration and payment bytes passed `--client-interop` in an isolated `200032` Linux build with preparation gas enabled. The same build passed the full `settlement` fixture. These runs used a synthetic genesis with networking disabled. |
| V35 sponsorship, policy and safe send | A temporary native fixture settled five SDK-generated transactions in five blocks. A funded Falcon-512 wallet sponsored a zero-balance Falcon-1024 registration, then sponsored registration of a policy requiring both members. The policy became eligible for safe send only after its registration block committed. It received seven parts in the next block and spent them with both witnesses and a separate zero-amount fee input. Replay reproduced the receipts and fees. A fresh validator process verified persisted balances, nonces and registry state. Invalid sponsor nonces and missing witnesses were rejected. |
| Android packaging | Android Metro 0.76.5 bundled the wallet entry from the npm tarball. The React Native 0.72 Hermes compiler generated HBC 94 bytecode. The historical BIP39 path produced a Metro resolution fallback and a Hermes warning about `Buffer`. A clean Android runtime test remains pending because this machine's offline Gradle cache lacks the matching React Native and Hermes Android packages. |
| Public proto gateway | The supplied host resolved in DNS. All five read-only smoke checks and a direct `POST /api/Balance` timed out connecting to TCP 443. `GET /health` also timed out before TLS or HTTP. The gateway supplied no block, version or signed response. |
| Fee boundary | The local native fixture accepted caps of 1,779 parts for registration and 200,000,000,000,001,031 parts for Coin with its new balance row. Independently reducing either cap by one part and re-signing caused rejection. These amounts describe this fixture and fee schedule. |
| SDK validation | `npm run validate` passed type-checking and lint with zero warnings. The full offline run passed 1,252 tests and skipped six opt-in network tests. The separate gateway check above records the outcome of the five read-only cases. |
| Package build | `npm run build` succeeded. `npm run build:validate-bundles` passed all 16 checks, including browser loading and parity across the 302 CommonJS and ESM exports. |

## Testing the alpha.3 package in dev-client

`0.0.1-alpha.3` follows the existing alpha series. To try the local package, run `npm pack` in the SDK checkout after `npm run validate` and `npm run build`. From the sibling `dev-client` directory, install the resulting file and check the loaded SDK version before starting Electron.

```powershell
npm install --no-save ../kalvora.js/kalvora.js-0.0.1-alpha.3.tgz
node -p "require('kalvora.js').VERSION"
npm run check
```

The local install lasts until dependencies are restored. After publication, `npm install --save-exact kalvora.js@0.0.1-alpha.3` pins the same version for teammates and CI. The release maintainer can publish the reviewed tarball with `npm publish ./kalvora.js-0.0.1-alpha.3.tgz --tag alpha`. Verify the channel with `npm view kalvora.js dist-tags --json` and compare `npm view kalvora.js@0.0.1-alpha.3 dist.integrity` with the integrity printed by `npm pack`.

The `dev-client` checkout at `371221a` passed all 129 tests on alpha.2. With the alpha.3 tarball installed, ESLint and Windows x64 Electron packaging passed. The runtime suite passed 126 of 129 tests, including all eight mocked wallet and transaction tests. The client also implements its own Falcon registration and transfer signing, so these local tests cover only part of the SDK migration.

Three client tests need updating. Two fixtures in `src/main/services/kal-signing.test.ts` use the installed SDK to construct legacy messages with the removed fields `SmartContractAllowance.unlimited` and `RestrictedKey.timeDelay`. Both fail TypeScript checking. At runtime the protobuf constructor drops those fields before the client can test their conversion. Preserve the old field values with a fixed legacy schema or fixture. The third test in `src/main/services/zera-client.test.ts` expects the literal version `0.0.1-alpha.2`.

In a temporary copy of the client, using the original alpha.2 descriptors for those fixtures and updating the expected SDK version restored a clean type-check, lint and all 129 tests. Applying these test changes to the dev-client repository remains open.

## Remaining work

| Owner | Action | Completion evidence |
| --- | --- | --- |
| Network operator and application team | Confirm that the separate Envoy gateway is listening publicly on TCP 443 and that the firewall permits access. Provide the independently verified final v35 genesis hash and registered operator address for `kal_proto`, then repeat the pinned reads. | HTTPS `/health` responds, the genesis hash and header version match, and the expected operator's registered Falcon key verifies a signed contract response. |
| SDK and wallet teams | Rehearse zero-balance sponsored registration, mixed-variant policy spending, fee boundaries, safe send across H/H+1, wrong chain/type and timeout recovery. Exercise wide addresses through a deployed query and wallet adapter. | Finalized receipts, balances, registry and nonce observations for each scenario. |
| Governance and validator operators | Rehearse a governance state change between voter pages, PRE/POST step zero, a grouped child terminal receipt, signed search responses and a dual-signed validator assignment. Use native KALV for that assignment after the validator registration fee policy is installed. | Verified page restarts, exact signed reply and receipt matches, and the finalized owner/operator record. |
| Wallet integrators | Exercise real injected, deep-link and WalletConnect providers and the target React Native runtime. | Verified receiving address, backup recovery and both signature variants on the supported devices. |
| Release maintainer | Review and merge the alpha.3 release changes, tag the merge commit, create the GitHub release and publish the reviewed package under npm’s `alpha` tag. Use the rehearsal results to decide when to promote the release. | `kalvora.js@alpha` resolves to `0.0.1-alpha.3` and its registry integrity matches the tested tarball. |
