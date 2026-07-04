## Why

After the exclude-from-build, standard-function, and reserved-keyword wins, built-only LSP precision was
dominated by one thing: **un-mirrored library symbols** (`PACK_ML`, `L_MC1P`/`L_MC4P` motion, `MEM`,
`SER_*`, `Str*A`, …). `volt pull` mirrors project source only; referenced libraries live outside the repo,
so the LSP never heard of their names and flagged every reference. There's nothing to fix in the resolver —
the symbols genuinely weren't in what we mirror.

Live spikes proved the library symbols are reachable in-process through the same .NET automation the bridge
already reflects over, and — decisively — that FULL signatures (pins, types, members, `EXTENDS` chains) are
extractable, not just names. So the original Phase-1/Phase-2 split (a name-only catalog first, full
signatures "later") collapsed: we ship full signatures in one pass.

## What Changes

Two complementary pieces, both keyed by the **item name = identity** protocol invariant and materialized
INTO the existing CODESYS tree (no invented `libs/` tree):

**1. Transitive namespace stubs (on the normal `/fetch`, build-free).** The bridge's library-ref walk
(`GetLibraryRefs`) now recurses the FULL dependency tree via `ILibManItem.GetDependencies()`, not just the
top-level Library Manager entries. Every library — direct AND transitive (e.g. `CAA Memory`, namespace
`MEM`, pulled in as a hidden dependency) — materializes as a `.library` stub carrying its `NAMESPACE`. The
LSP already reads `.library` NAMESPACE lines, so every qualified-reference ROOT (`MEM.LowWord`,
`PACK_ML.State`) now resolves. This is build-free and rides the existing cheap `/fetch`.

**2. Full element signatures (on `/fetch?verbose`, opt-in).** A new `verbose` fetch flag returns every
referenced-library element's public SIGNATURE — FB/function pins + types, struct fields, enum members,
GVL vars, interfaces, with `EXTENDS` bases — rendered as Structured Text declaration files (no bodies).
Each is materialized **under its owning library's folder in the Library Manager**
(`…/Library Manager/<LibraryName>/<Element>.<kind>`), co-located with that library's `.library` stub. The
LSP already scans those kind extensions as source, so the elements ingest into the symbol table for free:
bare library elements and member access resolve, no special ambient scope needed. Extraction is
`LanguageModelMgr.AllPrecompiledSignatures(true,true)` after a best-effort build (a freshly-opened project
has an empty precompiled set until a build populates it; even a FAILING app build precompiles the
resolvable libraries). `verbose` is off by default — a normal pull pays nothing; the corpus harvest sets it.

**Three precision fixes rode along** (surfaced by real projects once the library floor cleared):
- the VG (graphical) unresolved check now consults the same `libraryNamespaces` + `deviceInstances`
  catalogs the ST check does (device/library roots in FBD/LD bodies stopped false-flagging);
- a non-`{attribute 'qualified_only'}` enum's members resolve when referenced BARE (they're global
  constants per IEC, but live in the enum's own scope off the resolver's parent chain);
- a `FUNCTION_BLOCK X EXTENDS Y;` header with a stray trailing `;` no longer drops the VAR section
  (which had silently un-declared every local);
- the renderer lifts a CODESYS function's self-named output pin into its declared return type.

## Capabilities

### New Capabilities
- `library-signature-index`: the bridge materializes (a) a `.library` namespace stub per library across the
  full dependency tree, and (b) on `verbose`, each library element's full signature under its Library
  Manager folder; the LSP resolves both namespace roots and elements through the ordinary source/reference
  scan.

### Modified Capabilities
- `bridge-protocol`: `GetLibraryRefs` walks the transitive dependency tree; `/fetch` gains a `verbose` flag
  that returns library element signatures. (The build-gated `/lib-symbols` endpoint from an interim spike is
  folded into `/fetch?verbose` and removed.)
- `language-server`: bare members of a non-qualified_only enum resolve; the VG unresolved check consults the
  library/device catalogs; the FB-header trailing-`;` parse fix keeps locals declared.
- `workspace-file-extensions`: library element signatures use kind extensions, materialized under the
  Library Manager tree; read-only, never a push target.

## Impact

- **Code:** `packages/volt-bridge` (transitive `GetDependencies()` walk; `AllPrecompiledSignatures` extraction
  after a best-effort build; `LibSignatureRenderer`; `verbose` fold into `FetchService`; Beckhoff returns
  none), `packages/volt-lsp-iec` (VG catalog + bare-enum + FB-trailing-`;` fixes; the corpus ratchet),
  `volt-scripts/harvest-lsp-corpus.ts` (one `verbose` fetch).
- **Repo:** library `.library` stubs (full dep tree) + element-signature files under each Library Manager,
  committed. Large (~thousands of stub files per project) — a referenced-only filter is a possible future
  trim.
- **Cost:** `verbose` extraction builds once (~25–35 s) to precompile; the normal (non-verbose) pull, incl.
  the namespace stubs, is build-free.
- **Result:** built-only precision across the four real corpora (pro2193, bakon-nano, awa-palletizer,
  lenze-mid) dropped from **405 → 32** diagnostics.
- **Supersedes:** the `standard-functions.ts` stopgap (library symbols are now indexed). Mirrors the archived
  `exclude-from-build-awareness` cross-layer shape.
