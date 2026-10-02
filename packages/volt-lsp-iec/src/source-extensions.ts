/**
 * The kind-named writable-source extensions Volt materializes on disk — POUs (`.fb`/`.prg`/`.fun`),
 * interface (`.itf`), every DUT (`.struct`/`.enum`/`.union`/`.alias`/`.dut`), and GVL (`.gvl`). This is the LSP-side single source of truth
 * for "is this a Volt source file", shared by the workspace crawl, the running server, the corpus tests and
 * the maintenance scripts — so the set is defined once, not copied per consumer.
 *
 * Read-only graphical bodies (`.cfc`/`.sfc`) and reference manifests (`.library`/`.device`/…) are NOT
 * here — they are not writable source. Kept as a dependency-free leaf so a lightweight consumer does not
 * transitively load the analysis layer. (It named `detect-vendor` as the consumer that needed that; that
 * module is gone — see `consolidate-lsp-structure` C8 — and the property is still worth keeping.)
 * The ENGINE names every item, and the file name is that wire name (`Materializer.FullWireName` in `volt-cli`;
 * a DUT's extension is the subtype its vendor states, `.dut` when it states none). This mirrors the engine's writable-source table,
 * `ItemKind.SourceKindExtensions`, and is cross-checked against it and every other copy by `scripts/check-wiring.ts`.
 */
export const SOURCE_EXTENSIONS: readonly string[] = [
  ".fb",
  ".prg",
  ".fun",
  ".itf",
  ".gvl",
  // A DUT is named on the wire — and so on disk — by the subtype its vendor states, and `.dut` when the vendor
  // states none (openspec push-without-header-check 5.B); the file name IS the wire name.
  ".struct",
  ".enum",
  ".union",
  ".alias",
  ".dut",
]

/** Membership set for the same extensions — for the hot `.has(ext)` path in the crawl and tests. */
export const SOURCE_EXTENSION_SET: ReadonlySet<string> = new Set(SOURCE_EXTENSIONS)
