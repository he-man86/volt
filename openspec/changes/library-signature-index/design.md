## Context

The LSP resolves against the project symbol table built from mirrored `src/` files. Referenced
libraries aren't mirrored, so their symbols (`PACK_ML`, `L_MC4P`, `SER_*`, …) resolve nowhere and
false-positive — ~1066 of the 1097 built-only diagnostics on pro2193. The fix is to give the LSP the
libraries' **public signatures** (interfaces only, no bodies).

**Proven extraction path (live spike, 2026-07-02):** the referenced libraries' resolved signatures are
reachable in-process via the same .NET automation the bridge already reflects over (`ObjectMgr`-style):
1. **Build the project** (`POST /build`) — the compiler populates the language models. Before a build
   they are EMPTY; the `ILanguageModelBuilder.Create*` methods are empty-shell factories, not readers.
2. `SystemInstances.LanguageModelMgr` → `_3S.CoDeSys.LanguageModelManagerLegacy.LanguageModelManagerLegacy`.
3. `GetCompileContext(Guid appGuid) -> ICompileContext` (appGuid from the app node / the
   `<language-model application-id="…">` of `LibMan.GetLanguageModel()`).
4. `ctx.GetAllSignaturesFlat()` (0-arg) → all `ISignature` objects (16,424 on pro2193: project + every
   library + implicit). Confirmed to contain real library signatures (`L_MC4P_PARAMETERINDEX`, …).
5. Render each `ISignature2` to ST declaration text via `LanguageModelMgr.GetConverterToIEC(...)`, or
   walk `GetAllMethods`/`GetAllVariables`/`GetInterfaceSignatures`. `GetLibraryPrecompileContext(libId)`
   scopes to one library.

## Goals / Non-Goals

**Goals:**
- Resolve library symbols in the LSP (clear the ~1066 floor) + enable hover/completion/go-to-definition.
- Mirror each library as read-only, per-element signature files with kind extensions, by namespace.
- Amortize the build+extract cost via per-library-version caching (a normal pull pays nothing).
- Reuse existing seams (kind extensions, scope resolution, materialization).

**Non-Goals:**
- Library *implementation* bodies — signatures only; libraries are edited/owned upstream.
- Any push/edit of `libs/` — strictly read-only.
- A general symbol server — the resolved compile-context is the source; we snapshot signatures to text.
- TwinCAT parity in v1 (Beckhoff returns none; documented gap).

## Decisions

### 1. Materialize as per-element signature files under a read-only `libs/` tree
`libs/<Namespace>/<Element>.<ext>` — one file per public library POU/DUT/GVL/interface, declaration
only, kind extension matching project source (`.fb`/`.prg`/`.fun`/`.struct`/`.enum`/`.union`/`.alias`/
`.gvl`/`.itf`). Namespace folders (`L_MC4P/`, `PACK_ML/`) preserve qualified access. `libs/` is a
sibling of `src/`, never a push target. Filter to library-owned public signatures — EXCLUDE the
project's own POUs/types (already under `src/`) and implicit/compiler signatures (`VARIABLES`,
`IEC_DATATYPE`, `__TL_*_GVL`, …); dedup by qualified name.

### 2. Extraction is keyed and cached per LIBRARY VERSION, not per project state
A library's signatures are immutable for a given `(name, version, resolution)` — there is **no
instability risk** in hashing per library (unlike project items, which change with edits). So the wire
carries a library-version manifest (`namespace → {version, resolutionId, signatureHash}`); the client
sends its known library-versions and the bridge returns signature files ONLY for libraries whose version
changed. A normal pull (unchanged library set) skips the build+extract entirely. The `libs/` tree is
therefore stable and diffable — it changes only when a library is added/removed/version-bumped.

### 3. A dedicated extraction step, not part of every fetch
Extraction requires a build (~25–35 s). It runs as its own operation (`GET /lib-refs` for the cheap
version manifest + `POST /lib-symbols` with knownLibs for the incremental payload), gated on a
version-manifest diff. `volt pull` calls it only when the library manifest changed; otherwise `libs/`
is untouched.

### 4. LSP ingests `libs/` into an ambient library scope
The workspace builds a library scope from the `libs/` tree (the resolver already walks scope chains +
EXTENDS bases; a library namespace scope slots in the same way). The unresolved-identifier check,
hover, completion, and go-to-definition all consult it. `standard-functions.ts` becomes a fallback
(the CODESYS Standard/String libraries are themselves indexed) — kept only for un-indexed edge cases.

### 5. Committed, not gitignored
`libs/` is committed under version control. Rationale: it's stable (changes only on library version
bumps), it makes the repo self-contained (LSP + AI resolve library symbols with no bridge), and it's
diffable (a library upgrade shows as a signature diff). The per-version keying keeps churn minimal.

## Risks / Trade-offs

- **Volume.** 16k total signatures, but that's project + implicit + all libs; filtered to public
  library elements it's far smaller, and per-namespace files keep it browsable. Still, a large library
  set = many files; mitigated by committing stable, version-keyed content.
- **Rendering fidelity.** `GetConverterToIEC` output must parse as valid ST declarations for the LSP.
  Spike-verify a sample (FB with methods, struct, enum, GVL, interface) round-trips into a resolvable
  signature before bulk extraction.
- **Build dependency.** Extraction needs a successful build; a project that doesn't compile yields a
  partial/empty context. Handle gracefully (skip on build failure, keep the last good `libs/`).
- **Name collisions / qualified identity.** Library symbols are namespaced; the ambient scope must key
  by namespace so `PACK_ML.State` and a project `State` don't collide. Preserve namespace in the tree
  and the scope.
- **Beckhoff/TwinCAT.** No extraction in v1 (returns none) — documented parity gap.
- **First-pull cost.** The initial extraction pays the full build+extract; subsequent pulls are free
  until a library changes. Acceptable and clearly one-time.
