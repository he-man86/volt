## Why

After the exclude-from-build, standard-function, and reserved-keyword wins, built-only LSP precision on
pro2193 is **1097 diagnostics — and ~1066 of them are one thing: un-mirrored library symbols**
(`PACK_ML`, `L_MC1P`/`L_MC4P` motion, `SER_*`, `IQSlices`, `Fanuc_*`, `Cmp*`, `Str*A`). `volt pull` mirrors
project source only; referenced libraries live outside the repo, so the LSP has never heard of their
names and flags every reference. There's nothing to fix in the resolver — the symbols genuinely aren't in
what we mirror.

A **live spike (2026-07-02, reverted)** proved the library symbols are reachable in-process through the
same .NET automation the bridge already reflects over: build the project, then
`LanguageModelMgr.GetCompileContext(appGuid).GetAllSignaturesFlat()` returns the resolved symbol table
(16,424 entries — project + every library), each tagged with its owning **`LibraryId`**. That lets us
extract, per library, a catalog of its public symbol **names + kinds** — enough for the LSP to *resolve*
the references and clear the floor. (The same spike found that full source *declarations* — struct
fields, FB method/property signatures — are NOT cleanly reachable: that model is compiler-lowered and the
clean source form isn't exposed where we looked; see `design.md`. So this change is scoped to Phase 1,
the name index, with Phase 2 flagged as a separate deeper spike.)

## What Changes

**Phase 1 (this change): a library-symbol resolution index.** The bridge extracts, per referenced
library, the public symbol names + kinds + namespace (from the flat compiled model, filtered by
`LibraryId`). Each element materializes as a **minimal declaration stub** file — one file per element,
kind-based extension (`.fb`/`.prg`/`.fun`/`.struct`/`.enum`/`.union`/`.alias`/`.gvl`/`.itf`), namespaced
under a read-only `libs/` tree (`libs/L_MC4P/AxesGroup.struct`, `libs/PACK_ML/State.enum`) — a header/name
with an empty body. The LSP ingests `libs/` into an ambient library scope so bare and namespace-qualified
references to those symbols resolve — clearing the ~1066-diagnostic floor and giving name-level
completion. The stub files are the same tree Phase 2 later enriches, so nothing is thrown away.

**Efficiency (user's insight):** library contents are immutable per `(name, version, resolution)`, so
extraction is **keyed and cached per library-version, not per project state** — a normal pull skips the
build+extract entirely; only added/removed/version-bumped libraries re-extract. The `libs/` tree is
stable and diffable.

**Phase 2 (future, needs its own spike): fill the stubs with full signatures** — struct fields, FB
`VAR_INPUT/OUTPUT`, method/property signatures, function params — for real hover, member-completion, and
go-to-definition. Blocked on a clean source-signature extraction path (the compiled model is lowered;
`GetConverterToIEC` is a value converter, not a declaration renderer; the per-library precompile path was
not cracked in the spike).

## Capabilities

### New Capabilities
- `library-signature-index`: the bridge extracts a per-library symbol catalog (names/kinds), the CLI
  materializes it as a read-only `libs/` stub tree keyed by library version, and the LSP resolves library
  symbols through it.

### Modified Capabilities
- `bridge-protocol`: a new library-symbol extraction step, versioned per library so the wire ships only
  changed libraries.
- `language-server`: the LSP SHALL resolve identifiers against an ambient library scope built from
  `libs/`; the hand-curated standard-function table becomes a fallback.
- `workspace-file-extensions`: the read-only `libs/` tree uses kind extensions but is never a push target.

## Impact

- **Code:** `packages/volt-bridge` (catalog extraction via `LanguageModelMgr` + `GetCompileContext` +
  `GetAllSignaturesFlat`, filtered by `LibraryId`; a per-library-versioned wire endpoint; Beckhoff returns
  none), `packages/volt-git` + `packages/volt-control` (materialize `libs/` stubs + a library-version
  manifest; incremental refresh), `packages/volt-lsp-iec` (ingest the library scope; scan `libs/`
  read-only; reduce `standard-functions.ts`), `packages/volt-vscode` (mark `libs/` read-only).
- **Repo:** a new read-only `libs/` tree (committed, versioned by a library manifest hash).
- **Cost:** extraction needs a build (~25–35 s), amortized by per-library-version caching — paid only on
  a library change.
- **Supersedes:** the `standard-functions.ts` stopgap. Mirrors the archived `exclude-from-build-awareness`
  cross-layer shape.
