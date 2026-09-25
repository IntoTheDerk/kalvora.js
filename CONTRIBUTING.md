# Contributing to kalvora.js

Thanks for your interest in contributing. This project is community-run — every contribution matters, whether it's a bug fix, a new module, documentation improvements, or a well-written issue.

## Getting Started

**Prerequisites:** Node.js 20 or later.

```bash
git clone https://github.com/intothederk/kalvora.js.git
cd kalvora.js
npm install
npm run proto:install
npm run build:proto
npm run build
```

Verify everything is working:

```bash
npm run validate   # type-check + lint (zero warnings) + tests
```

## Making Changes

1. **Fork the repo** and create a branch from `main`. Use a descriptive name like `fix/nonce-retry-logic` or `feat/staking-rewards`.

2. **Write your code.** The codebase is TypeScript with strict mode enabled. Follow the patterns you see in existing modules — each module lives in its own directory under `src/` with its own types, tests, and examples.

3. **Add tests.** We use [Vitest](https://vitest.dev). Tests live alongside the code they cover (in a `tests/` directory within each module). Run your module's tests in isolation while developing:

   ```bash
   # Run tests for a specific module
   npx vitest run src/coin-txn
   npx vitest run src/query
   npm run test:watch            # everything, in watch mode
   ```

   Unit tests must stay offline: pass `nonce` + `feeAmountParts` to builders,
   and use ConnectRPC's `createRouterTransport` for RPC code (see
   `src/query/tests`). Read-only checks against a real node belong in
   `src/query/tests/live.test.ts`, gated on `KALVORA_LIVE_ENDPOINT`.

4. **Add examples** if you're introducing new functionality. Examples live in `examples/` directories within each module and should be runnable with `npx tsx`.

5. **Update documentation.** If your change affects a module's public API, update that module's README. Keep the root README focused on high-level concepts — detailed docs belong in module READMEs.

6. **Lint and type-check** before submitting:

   ```bash
   npm run lint:fix
   npm run validate
   ```

7. **Protocol changes** come from kalvora-indexer, the source of truth for the
   `.proto` files. Never hand-edit `proto/*.proto`; run `npm run proto:sync`
   then `npm run build:proto`, and `npm run proto:check` in CI.

## Pull Requests

Keep PRs focused. One feature or fix per PR is easier to review than a grab-bag of changes.

In your PR description, explain **what** changed and **why**. If there's a related issue, reference it. If the change affects the public API, call that out explicitly.

All PRs should pass linting, type-checking, and tests before requesting review.

## Project Structure

Each module under `src/` follows a consistent layout:

```
src/module-name/
├── index.ts           Public API exports
├── *.ts               Implementation files
├── types.ts           TypeScript types (if needed)
├── tests/             Test files (*.test.ts)
├── examples/          Runnable examples
└── README.md          Module documentation
```

When adding a new module, follow this structure. Export public APIs from the module's `index.ts`, then re-export from the root `index.ts`.

## Code Style

- **TypeScript strict mode** — no `any` types without justification.
- **Explicit exports** — every module has a clear public API surface through its `index.ts`.
- **Descriptive naming** — functions, types, and variables should be self-documenting.
- **Error handling** — use typed error classes (see `src/wallet-creation/errors.ts` for the pattern). Don't throw raw strings.
- **No custom crypto** — all cryptographic operations use audited libraries (`@noble/curves`, `@noble/hashes`). Never implement your own cryptographic primitives.

## Reporting Issues

When filing an issue, include:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Node.js version and environment (Node, browser, React Native)

If you're reporting a security vulnerability, **do not open a public issue**. Email the maintainers directly.

## Becoming a Maintainer

Consistent contributors are invited to become maintainers. There's no formal application — just show up, contribute quality work, and help others.

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0 License](./LICENSE).
