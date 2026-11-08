# SDK integration map

The local Floorplan map covers native/Git packaging, governance construction,
trusted signing context and processing receipts in this SDK only. Other SDK
features are outside this focused map. Generated maps, caches and worksheets
stay under the ignored repository-root `floorplan/`; this directory is the
shared documentation entry point.

From the SDK root, use the installed `$floorplan` skill to create the map if
absent or refresh it after changes. With `FLOORPLAN_SKILL` set to the installed
directory containing `SKILL.md`, run:

```sh
node "$FLOORPLAN_SKILL/scripts/status.mjs"
# Existing map: rescan, preserve notes/flows and follow the printed NEXT items.
node "$FLOORPLAN_SKILL/scripts/refresh.mjs" "$PWD"
node "$FLOORPLAN_SKILL/scripts/describe.mjs" "$PWD"
node "$FLOORPLAN_SKILL/scripts/recent.mjs" "$PWD"
node "$FLOORPLAN_SKILL/scripts/build.mjs" "$PWD"
node "$FLOORPLAN_SKILL/scripts/open.mjs" "$PWD"
```

For a new map, the skill starts with `scan.mjs`, then creates architecture,
flow and file descriptions before building. Inspect `floorplan/` and any legacy
`show-code/` map first; do not overwrite or relocate existing maps.

Canonical references: [SDK architecture](../guides/architecture.md),
[installation and native exports](../../README.md),
[Git preparation and validation](../../CONTRIBUTING.md),
[proposal validation](../../src/proposal/README.md),
[delegation assignment and unresolved semantics](../../src/delegated-voting/README.md),
[trusted signing](../../src/sign/README.md), and
[query/receipt semantics](../../src/query/README.md).

Verify native imports without Solana, chain/domain/type enforcement before
signing, Markdown round trips and explicit receipt status against code when
refreshing. Query lookups distinguish an absent hash from an incomplete receipt;
polling retains the height until an explicit status, timeout or abort. Pure
decoders still omit incomplete rows; see the query reference above.
A map does not verify live deployment or finality. The scanner's
secret warning for `KALVORA_NATIVE_TOKEN` is a false positive: it is the public
native mint identifier, not a credential.
