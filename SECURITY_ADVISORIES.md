# Dependency advisory review — 2026-11-06

This bounded tooling update is based on SDK source `f0be436`. It does not change
SDK runtime source, protocol files, crypto, package exports or optional Solana
peer ranges. Every pre-existing non-development lockfile entry is unchanged.

## Changes and compatibility

- Align Vitest, UI and V8 coverage on 3.2.7, retaining the existing Vitest 3
  configuration and single-fork test behavior. This fixes the critical
  [UI file-read/execution advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp).
- Pin the development-only `tinypool` override to 2.1.2, the first version fixing
  both worker-option prototype-pollution advisories
  ([worker options](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3),
  [run options](https://github.com/advisories/GHSA-85c8-ppgw-ccpr)).
  Vitest 3 requests 1.x, so this is an intentional cross-major override.
  [Tinypool 2.0's documented breaking change](https://github.com/tinylibs/tinypool/releases)
  is dropping Node 18; 2.1.2 supports Node 20 and 22+. The installed pool remains
  exercised by the repository's full offline fork-based suite. Remove the
  override when an adopted Vitest release depends on a patched pool itself.
- Explicitly select Vite 6.4.5, within Vitest 3's supported dependency range and
  [Vite's security-maintained 6.4 line](https://vite.dev/releases). This avoids
  selecting a newer Vite major with a higher Node requirement.
- Update esbuild to 0.28.2 and refresh compatible tooling transitives, including
  Rollup, TSX, Markdown-It, YAML, brace expansion, PostCSS and WebSocket fixes.
  TypeScript remains 5.9; TypeDoc and typescript-eslint retain their existing
  compatible lines.
- Do not override Minimatch to 11. Current TypeDoc calls `Minimatch.matchOne`,
  which 11 removes: a trial override made `npm run docs` fail. Keep compatible
  9.0.9/10.2.6 and explicitly retain their remaining moderate advisory.

The declared Node engine remains `>=20.0.0`. The existing Noble runtime packages
already require **Node >=20.19.0**, so the locked tree does not support every
20.0 release; this patch does not raise that existing floor or require Node 22.
Verification targets Node 20.20.2 and Node 24.21.0. No live endpoint is enabled.
All declared Node engine ranges in both lockfiles also accept 20.19.0; that
minimum was checked from package metadata, not by executing Node 20.19.0 itself.

## Audit scope and remaining findings

The full root audit changed from **32 entries (4 critical, 15 high, 12 moderate,
1 low)** to **22 entries (0 critical, 3 high, 19 moderate, 0 low)**. Entries include
affected parent packages, not 22 distinct vulnerabilities. The complete tooling
tree is **not clean**. `npm audit --omit=dev --omit=optional` reports zero entries;
that native-runtime result excludes the bridge and must not be described as a
clean optional-bridge audit. Root development installs include the optional
Solana packages for bridge tests and bundle builds.

| Remaining advisory family | Root dependency paths and affected nodes | Disposition |
| --- | --- | --- |
| High: [bigint-buffer overflow](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg) | `@solana/spl-token -> @solana/buffer-layout-utils -> bigint-buffer` (all three high entries) | Retain bridge 0.4.14. There is no patched compatible bigint-buffer release. Reject npm's suggested spl-token 0.1.8 downgrade; replacing or removing this optional bridge needs separate compatibility work. |
| Moderate: [Minimatch pattern amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) | TypeDoc -> Minimatch 10.2.6; typescript-eslint parser/plugin -> typescript-estree -> Minimatch 9.0.9; coverage-v8 -> test-exclude -> Minimatch 9.0.9 (also reached through Glob) | Fixed in incompatible 11.x. Keep trusted local configuration/globs; do not accept untrusted patterns in tooling. Audit also marks typescript-eslint utils/type-utils parents. |
| Moderate: [Glob cancellation bypass](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | coverage-v8 -> test-exclude 7.0.1 -> Glob 10.5.0 | No compatible 10.x fix; defer coverage/toolchain major migration. |
| Moderate: Vitest mock registration and file-read issues ([redirect mocks](https://github.com/advisories/GHSA-82fw-gwwq-j7x9), [manual mocks](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)) | Vitest 3.2.7 -> @vitest/mocker 3.2.7; UI and coverage also inherit Vitest findings | Fixes require Vitest 4.1.12 or later. Keep test/UI servers private and run trusted tests only; this patch does not claim to remediate these moderate findings. |
| Moderate: [stream-json parsing](https://github.com/advisories/GHSA-mjw6-4jj6-33hc) and [UUID buffer bounds](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | Optional @solana/web3.js -> Jayson -> stream-json / UUID; spl-token-group and spl-token-metadata inherit the web3 peer finding | Fixes require incompatible upstream majors. Preserve web3 1.98.4 and report this optional-runtime exposure separately from the zero native-runtime audit. |

No `npm audit fix --force`, bridge downgrade, advisory suppression or severity
threshold reduction was used. Parent integration must rerun audits and required
checks on the combined receipt/tooling commit before updating consumer pins.

## Verification of this patch

- Node 20.20.2: `npm ci --engine-strict --no-audit --no-fund` passed, including
  the normal protobuf setup and complete SDK build lifecycle.
- Node 20.20.2: `npm run validate` passed type-checking, zero-warning lint and
  1,234 tests across 63 files; six live tests in two files stayed skipped.
- Node 24.21.0: `npm run build` and `npm run test:coverage` passed with the same
  1,234 passing / six skipped tests. Coverage tooling executed successfully;
  reported line coverage was 42.02%, not a claim of an 80% coverage target.
- Node 24.21.0: `npm run docs` passed after removing the incompatible Minimatch
  override. This check verifies TypeDoc compatibility, not documentation edits.
- A Node 20 Tinypool regression probe passed: inherited constructor `filename`
  and `execArgv` are ignored, and inherited run-option `filename` is rejected
  before any canary worker dispatch.
- `npm ls --all` has no dependency-tree problems; native-runtime audit is zero;
  `git diff --check` passes. Runtime lock invariance was checked against the base:
  all changed or added dependency entries are development-only.

Audit counts are a dated registry snapshot. The moderate mock-server and glob
findings and the optional bridge findings above remain open; no claim is made
that the complete development tree is free of vulnerabilities.
