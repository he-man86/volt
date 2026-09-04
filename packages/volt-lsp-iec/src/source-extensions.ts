/**
 * The kind-named writable-source extensions Volt materializes on disk — POUs (`.fb`/`.prg`/`.fun`),
 * interface (`.itf`), every DUT (`.dut`), and GVL (`.gvl`). This is the LSP-side single source of truth
 * for "is this a Volt source file", shared by the workspace crawl, the running server, vendor detection,
 * the corpus tests, and the maintenance scripts — so the set is defined once, not copied per consumer.
 *
 * Read-only graphical bodies (`.cfc`/`.sfc`) and reference manifests (`.library`/`.device`/…) are NOT
 * here — they are not writable source. Kept as a dependency-free leaf so lightweight consumers
 * (`detect-vendor`, used by `volt init` and the VS Code extension) don't transitively load the analysis
 * layer. The bridge/CLI own the on-disk layout (`ItemKind.ExtFor` in `volt-cli`); this mirrors its
 * writable-source rows and is cross-checked against every other copy by `scripts/check-wiring.ts`.
 */
export const SOURCE_EXTENSIONS: readonly string[] = [
  ".fb",
  ".prg",
  ".fun",
  ".itf",
  ".gvl",
  // A DUT is one wire kind but four files on disk, by its declaration's subtype. `.dut` stays recognized:
  // a workspace pulled before the split is full of them, and an unknown extension is not analyzed at all.
  ".struct",
  ".enum",
  ".union",
  ".alias",
  ".dut",
]

/** Membership set for the same extensions — for the hot `.has(ext)` path in the crawl and tests. */
export const SOURCE_EXTENSION_SET: ReadonlySet<string> = new Set(SOURCE_EXTENSIONS)
