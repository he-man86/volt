## Context

The LSP resolves against the project symbol table from mirrored `src/` files. Referenced libraries
aren't mirrored, so their symbols (`PACK_ML`, `L_MC4P`, `SER_*`, …) resolve nowhere and false-positive —
~1066 of the 1097 built-only diagnostics on pro2193. The diagnostics are all *"unknown name"*, so
knowing the library symbol **names** is enough to clear them; the symbols' **contents** are only needed
for hover/member-completion/go-to-def.

**Spike findings — RE-VERIFIED LIVE END-TO-END 2026-07-03 (Lenze MID-S100); supersedes the pessimistic
2026-07-02 note.** Full recipe (see the `codesys-library-signature-extraction` memory):
1. Build (`app.generate_code()` / `POST /build`) — models are EMPTY before a build.
2. `SystemInstances.LanguageModelMgr` (`LanguageModelManagerLegacy`) via reflection (as the bridge reaches
   `ObjectMgr`/`Engine`).
3. `lmm.GetCompileContext(appGuid)` — **appGuid = `proj.active_application.guid`** (simpler than the old
   `GetLanguageModel()` XML path).
4. `ctx.GetAllSignaturesFlat()` → the resolved symbol table (11,694 on Lenze).
5. Filter `sig.IsLibraryObject` → 7,760 library sigs (also `IsCompiledLibraryObject`/`IsSourceLibraryObject`).
6. Organize: `sig.LibraryPath` = clean `"l_mc1p_motioncontrolbasic, 3.34.0.96 (lenze)"` → one folder per
   library (110); `sig.POUType` (`FunctionBlock`/`Interface`/`Function`/`VarGlobal`/`Type`) → the kind.
- **PHASE 2 IS NOW UNBLOCKED — full public declarations ARE reachable** (the earlier "not reached" was
  from walking the wrong accessor): enums/GVLs via `sig.AllVariables` (clean members — `L_MC1P_AXIS_STATE`
  → `ERRORSTOP, DISABLED, STANDSTILL, …`); FBs/functions via `sig.Inputs`/`Outputs`/`InOuts` (clean public
  pins with real types — `XERROR : BOOL`, `ERRORHANDLE : POINTER TO BYTE`); `BaseSignature`/`Interfaces`
  for the EXTENDS/IMPLEMENTS chain. Verified real `L_MC1P_*` + `MC_DIRECTION` signatures — exactly the floor.
- **Two render gotchas:** (a) an FB's `AllVariables` still includes compiler internals (`__VFTABLEPOINTER`,
  `__INTERFACEPOINTER__*`) — use `Inputs`/`Outputs` for the clean interface, or drop `__`-prefixed names.
  (b) The official renderer `GetConverterToIEC(bool, bool, DisplayMode)` (3 args, not a value converter)
  wasn't dumped; the manual variable walk is the confirmed path.
- **Build-free alt for SOURCE libs only:** `librarymanager.get_file_path(ref.managed_library)` → open the
  `.library` standalone → `obj.textual_declaration.text` (verified on OSCAT). Compiled `.compiled-library*`
  return empty (protected), so the ISignature path above is the complete single solution (source + compiled).

## As shipped (authoritative — supersedes the design-time Decisions below)

The Phase 1 / Phase 2 split collapsed once full signatures proved extractable. Final design:

1. **Namespace stubs, build-free, on the normal `/fetch`.** `GetLibraryRefs` recurses the full dependency
   tree (`GetAllLibraries` + recursive `ILibManItem.GetDependencies()`), emitting one `.library` stub per
   library (direct + transitive), deduped by `(namespace,name)`. Transitive deps (`CAA Memory` → `NAMESPACE
   MEM`, hidden top-level) are what make `MEM.LowWord` resolve. The LSP's existing `loadLibraryNamespaces`
   reads these — no new LSP code for namespace roots.
2. **Full element signatures, opt-in, on `/fetch?verbose`.** `ExtractLibrarySignatures` does a best-effort
   build (to precompile — a freshly-opened project's precompiled set is empty), then reads
   `AllPrecompiledSignatures(true,true)`, keeps `IsLibraryObject`, drops `__`-mangled. `LibSignatureRenderer`
   emits an ST declaration (real pins/types/members, `EXTENDS`). `FetchService` folds these into the response
   pathed under each library's Library Manager folder (`<lib folder>/<lib name>/<Element>.<kind>`), joined to
   the `.library` ref by RESOLUTION. **No `libs/` tree, no separate `/lib-symbols` endpoint, no per-version
   caching manifest** — `verbose` is simply off for a normal pull.
3. **LSP: no ambient scope.** Signature files use the ordinary kind extensions, so the existing source scan
   ingests them into the symbol table — bare elements + member access resolve for free.
4. **Rider precision fixes** (surfaced once the library floor cleared): VG unresolved check consults the
   library/device catalogs; bare members of a non-`qualified_only` enum resolve; FB-header trailing-`;` no
   longer drops the VAR section; renderer lifts a function's self-named output pin into its return type.

Result: built-only precision across the four real corpora **405 → 32**. The sections below are the
design-time record (the `libs/`-tree / per-version-catalog / GetCompileContext ideas were NOT the final shape).

## Goals / Non-Goals

**Goals (Phase 1):**
- Resolve library symbol references in the LSP (clear the ~1066 floor) + name-level completion.
- Materialize a read-only `libs/` tree, one minimal-stub file per library element, kind extensions, by
  namespace — the same tree Phase 2 will enrich.
- Amortize the build+extract via per-library-version caching (a normal pull pays nothing).

**Non-Goals:**
- Full member signatures (struct fields, FB inputs/methods/properties, function params) — Phase 2. NOTE
  (2026-07-03): the extraction for this is now spiked/proven (see Spike findings — `sig.Inputs`/`Outputs`
  /`AllVariables`), so Phase 2 is de-risked and could fold into Phase 1 (emit full signatures in one pass)
  rather than minimal stubs; revisit the phase split when implementing.
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

## Spike results (2026-07-02, round 3 — implemented via a temporary `/debug?lib=1`, reverted)

Ran the extraction live against Pro2193. Four findings that **revise the plan** — Phase 1 shrinks to a
**namespace catalog**, and per-element stubs move to Phase 2:

1. **Extraction is build-INDEPENDENT.** `GetCompileContext(appGuid)` returns null because the headless app
   build FAILS (`built:false` — device/library mismatch in the headless env). But
   `LanguageModelMgr.AllPrecompiledSignatures(true,true)` returns **4225 library-owned signatures anyway**
   (libraries are precompiled independently of the app). So no 30–35 s app build, no build-failure handling
   — a big simplification over the original recipe. (`AllSignatures`/`GlobalSignatures` return `IScope`, not
   enumerable — skip.)

2. **Namespaces are ALREADY on the wire — no signature extraction needed for the bulk win.** The library
   REFERENCE (`.library` manifest, `NAMESPACE` field, already emitted by `ToLibRef`) carries the namespace
   the source references (`PACK_ML`, `Stu`, `Util`, `L_MC1P`, `L_MC4P`, …). 62 distinct namespaces on
   Pro2193.

3. **A namespace-only catalog clears 468 / 563 unresolved (83%) — VERIFIED.** The unresolved diagnostics
   flag the qualified-reference ROOTS (`PACK_ML` ×219, `L_MC1P` ×75, `Stu` ×72, `L_MC4P` ×42, …), which are
   exactly the library namespaces. Registering the namespace names alone clears them. The remaining 95:
   device/axis instances (~41 — `MagazineAxes`, `*Drive`, `EtherCAT_Master`, `Axis_*`; a separate
   device-instance-exposure feature), bare library ELEMENTS (~19 — `CLOCK`, `TICKS`, `L_TSeverity`,
   `L_IMHP_Layer` → Phase 2), and project-local (~27 — `takeover`, `OUT`, `product0/1`).

4. **Kind is NOT cleanly extractable, and the LibraryId→namespace join is fuzzy.** Every signature is the
   generic `.NET` type `Signature` with the same `ISignature..7` interfaces; kind members (`TypeClass`,
   `IsFunctionBlock`, `IsEnum`, …) are all null; only `GetAllMethods`/`GetAllVariables` COUNTS distinguish
   loosely (enum=0 methods/N vars, FB=N methods). And `sig.LibraryId` (e.g. `"omac packml state machine,
   1.0.0.4 (3s…)"` vs `"systypes2 interfaces * (system)"`) does not string-match the ref resolution cleanly
   (case + a `*`-placeholder form). So **per-element stubs with correct kinds are a Phase-2 problem** — they
   need the signature extraction AND a reliable namespace join AND kind detection, none of which Phase 1
   requires.

**Revised Phase 1 = the namespace catalog** (from the refs, already on the wire): materialize the library
namespaces; the LSP registers them so qualified references resolve. Signature extraction
(`AllPrecompiledSignatures`), element names, kinds, and per-element stubs all move to Phase 2.

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
