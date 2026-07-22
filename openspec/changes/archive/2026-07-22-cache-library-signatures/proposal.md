## Why

On the pull/init path, the CODESYS bridge runs `ExtractLibrarySignatures()`, which precompiles the referenced libraries (a `Build(app)`) and reads their `AllPrecompiledSignatures`. A live spike against headless CODESYS (fixture project, 24 referenced libraries, 590 rendered signature items) measured:

- **fetch #1 (cold): 2469 ms**, fetch #2 (warm): **97 ms** — a 25× gap.
- Every `.library` resolution carries its **version** (`Standard, 3.5.18.0 (System)`, `IoStandard, 3.5.17.0 (System)`, …).
- The 590 rendered signature items are **byte-stable across fetches** (0 version mismatches).

So the precompile is a **cold, once-per-session cost** (CODESYS keeps the precompiled set warm within a session; a subsequent fetch's `Build(app)` is a fast incremental no-op). It is *not* paid on every warm pull. The cost matters because (a) it lands on the **first pull after opening the IDE** (or after a Clean), and (b) it **scales with library count** — real corpora carry **5220–5406** signatures vs 590 in the fixture, so a large project's first-pull precompile is plausibly 10–20 s, not 2.4 s. Because a library's rendered API is **immutable for a given version** (only a version swap changes it — never a line of code), the extraction is safely cacheable by the referenced-resolution set.

## What Changes

- **Cache the CODESYS library extraction by the referenced-resolution fingerprint.** Before precompiling, read the live set of referenced-library resolutions (name + version) — build-free, from the Library-Manager reference metadata the walk already reads. If the fingerprint matches a cached extraction, **return the cached signatures and skip `Build(app)` entirely**; otherwise build once, extract, and cache under that fingerprint.
- **Two cache tiers:**
  - **In-proc (session)** — a field on the CODESYS session; removes redundant extraction work within a session (marginal, since CODESYS is already warm — but removes the `Build(app)` call + the extraction/render pass on repeat fetches).
  - **On-disk (cross-session), optional/second phase** — persist `fingerprint → rendered signatures` beside the workspace so the **first pull after reopening the IDE** skips the cold precompile. This is where the real user-visible win is.
- **Keep the correctness invariants intact:** the fingerprint is read **live on every fetch**, so a version swap / added / removed library is a natural cache miss; and this touches **only** the library-signature path — the per-item project walk stays live (either side may edit at any time, so project versions must not be cached).
- **Scope: CODESYS only.** TwinCAT does not yet emit library signatures, so `DriverBase` gets the cache seam but Beckhoff is a no-op until TC gains signatures.

## Capabilities

### New Capabilities
- `library-signature-cache`: the bridge caches referenced-library signature extraction keyed by the immutable `(library, version)` resolution set, skipping the precompile when the referenced set is unchanged, without weakening live change-detection of project items.

### Modified Capabilities
<!-- None: no existing openspec/specs tree (invariants live in package docs). -->

## Impact

- **`packages/volt-cli` (bridge/C#)** — `Volt.Engine/Ide/DriverBase.cs` (cache seam wrapping an abstract uncached-extract + a new build-free `ReferencedLibraryResolutions()`), `Volt.Cli.Ide.Codesys/Ide/CodesysObjectModel.cs` (implement the build-free resolution read + move the `Build(app)`/`AllPrecompiledSignatures` into the uncached path), `Volt.Engine/Sync/FetchService.cs` (unchanged call site — it just calls `ide.ExtractLibrarySignatures()` which is now cached).
- No wire/protocol change; no change to `projectVersion`/`structureVersion` (library signatures don't feed them — verified). Fetch output is byte-identical on a cache hit.
- **Risk is isolated to CODESYS library extraction**; the project walk, push, and status paths are untouched.
