## Context

The LSP resolves against the project symbol table from mirrored `src/` files. Referenced libraries
aren't mirrored, so their symbols (`PACK_ML`, `L_MC4P`, `SER_*`, …) resolve nowhere and false-positive —
~1066 of the 1097 built-only diagnostics on pro2193. The diagnostics are all *"unknown name"*, so
knowing the library symbol **names** is enough to clear them; the symbols' **contents** are only needed
for hover/member-completion/go-to-def.

**Spike findings (2026-07-02, two rounds, reverted):**
- Build the project → `SystemInstances.LanguageModelMgr` (`LanguageModelManagerLegacy`) →
  `GetCompileContext(appGuid) -> ICompileContext` → `ctx.GetAllSignaturesFlat()` returns the whole
  resolved symbol table (16,424 on pro2193). Each item carries **`LibraryId`** (e.g.
  `"l_mc1p_motioncontrolbasic * (lenze)"`) — non-empty ⇒ library-owned. So **names + kind + owning
  library are extractable** (Phase 1). `GetAllMethods(ISignature2)` works.
- BUT that flat model is **compiler-LOWERED**: FBs become structs with `__VFTABLEPOINTER` vars and
  mangled names (`L_MC1P_IRETAINFUNCTION__UNION`). NOT clean source. `GetConverterToIEC` is a
  value/literal converter (`GetInteger`/`GetBoolean`), NOT a declaration renderer. The source-level
  precompile *app* context (`GetPrecompileContext`) is PROJECT-only (4219 sigs; `GetAllLocalLibraries`=0);
  `GetLibraryPrecompileContext(resolutionGuid)` returned null. So **clean full declarations were NOT
  reached** — that's Phase 2, pending its own spike.

## Goals / Non-Goals

**Goals (Phase 1):**
- Resolve library symbol references in the LSP (clear the ~1066 floor) + name-level completion.
- Materialize a read-only `libs/` tree, one minimal-stub file per library element, kind extensions, by
  namespace — the same tree Phase 2 will enrich.
- Amortize the build+extract via per-library-version caching (a normal pull pays nothing).

**Non-Goals:**
- Full member signatures (struct fields, FB inputs/methods/properties, function params) — Phase 2.
- Library implementation bodies, ever (signatures only; libraries are owned upstream).
- Any push/edit of `libs/` (read-only). TwinCAT parity in v1 (Beckhoff returns none).

## Decisions

### 1. Extract a name/kind catalog filtered by LibraryId
From `GetAllSignaturesFlat()`, keep signatures with a non-empty `LibraryId`, drop compiler-mangled
entries (names containing `__`, vtable/union artifacts) and implicit signatures (`VARIABLES`,
`IEC_DATATYPE`, `__TL_*_GVL`). Map each to `(qualifiedName, namespace, kind, libraryId)`. Classify kind →
extension via the existing `ItemKind.ExtFor`. Namespace comes from the library's declared namespace
(`L_MC4P`, `PACK_ML`), so qualified references map correctly.

### 2. Materialize as minimal per-element STUB files (Phase-2-ready)
`libs/<Namespace>/<Element>.<ext>` — one file per element, containing only the declaration header + name
+ an empty body (e.g. `FUNCTION_BLOCK L_MC4P_MC_MoveAbsolute` … `END_FUNCTION_BLOCK`;
`TYPE AxesGroup : STRUCT END_STRUCT END_TYPE`). Enough for the LSP to register the symbol and resolve
references. Phase 2 fills the SAME files with real `VAR`/member signatures — no restructuring. Read-only;
never a push target.

### 3. Extraction keyed and cached per LIBRARY VERSION (no per-project instability)
A library's contents are immutable for a given `(name, version, resolution)`, so — unlike project items —
there is **no instability risk hashing per library**. The wire carries a per-library version manifest
(`namespace → {version, resolutionId, catalogHash}`); the client sends its known versions and the bridge
returns catalog entries ONLY for changed/new libraries. An unchanged library set costs nothing. `libs/`
changes only when a library is added/removed/version-bumped — stable and diffable.

### 4. A dedicated build-gated extraction step, not part of /fetch
Extraction needs a build (~25–35 s). Split into `GET /lib-refs` (cheap version manifest, no build) +
`POST /lib-symbols {knownLibs}` (build+extract+return only changed libraries). `volt pull` calls the
latter only when the manifest changed.

### 5. LSP ingests `libs/` into an ambient library scope
The workspace builds a library scope from `libs/` (the resolver already walks scope chains); the
unresolved-identifier check + completion consult it. Because it's namespace-keyed, `PACK_ML.State` and a
project `State` don't collide. `standard-functions.ts` becomes a fallback (the Standard/String libraries
are themselves indexed).

### 6. Committed, not gitignored
`libs/` is committed — stable (per-version), self-contained (LSP + AI resolve with no bridge), diffable
(a library upgrade shows as a catalog diff). Per-version keying keeps churn minimal.

## Risks / Trade-offs

- **Phase-2 render fidelity is unproven** — the whole reason this change is Phase-1-scoped. Phase 2 needs
  a dedicated spike to find a clean source-signature path (or reconstruction from the lowered model with
  acceptable fidelity) before it's committed.
- **Stub correctness** — the minimal declarations must parse and register as the right kind/namespace so
  references resolve. Spike-verify a sample (FB, struct, enum, GVL, interface) resolves in the LSP.
- **Namespace/qualified-name mapping** — the flat names are namespace-prefixed (`L_MC4P_…`); confirm the
  mapping to how source references them (bare vs `Namespace.Name`) so resolution matches. This is the key
  Phase-1 correctness risk.
- **Volume** — filtered to public library elements it's far smaller than 16k, and per-namespace files
  keep it browsable; committing stable, version-keyed content bounds churn.
- **Build dependency / Beckhoff** — extraction needs a successful build (skip + keep last-good on
  failure); Beckhoff returns none (documented gap).
