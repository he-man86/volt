## 1. Spike — DONE (findings in design.md)

- [x] 1.1 Reach the library symbol table live. Two accessors, both build-INDEPENDENT of the app's success but
  NOT of precompilation: `AllPrecompiledSignatures(true,true)` returns the library-owned `ISignature`s once the
  libraries are precompiled. A freshly-opened project's precompiled set is EMPTY (verified: 2 sigs before a
  build, 5220 after) — so a best-effort build (even a failing one precompiles the resolvable libs) is required.
- [x] 1.2 Full signatures ARE extractable (not just names): `sig.Inputs`/`Outputs`/`InOuts`/`AllVariables`
  give clean pins+types, `BaseSignature` the EXTENDS chain. So Phase 1/Phase 2 collapse — ship full sigs.
- [x] 1.3 Namespace roots come from the library REFERENCE (`.library` NAMESPACE), not the signature. Transitive
  deps carry namespaces the source uses directly (`MEM` from CAA Memory) but are hidden top-level — reachable
  via `ILibManItem.GetDependencies()`.

## 2. Bridge: transitive namespace stubs — DONE (build-free, on /fetch)

- [x] 2.1 `GetLibraryRefs` recurses the FULL dependency tree (`GetAllLibraries` + recursive `GetDependencies()`),
  emitting a `.library` stub per library, deduped by `(namespace,name)` (cycle-safe). 51→~187 libs on lenze;
  `CAA Memory.library` (NAMESPACE MEM) now present.

## 3. Bridge: full element signatures — DONE (on /fetch?verbose)

- [x] 3.1 `ExtractLibrarySignatures`: best-effort build to precompile, then `AllPrecompiledSignatures(true,true)`,
  keep `IsLibraryObject`, drop `__`-mangled; map each to a `LibSignature` (name, LibraryPath, POUType, pins,
  members, base, return).
- [x] 3.2 `LibSignatureRenderer` renders each to an ST declaration (kind extension + text); lifts a function's
  self-named output pin into its declared return type; enum vs GVL disambiguated by member typing.
- [x] 3.3 `FetchRequest.verbose` flag; `FetchService` folds the signatures into the response, pathed under each
  library's Library Manager folder (`<lib folder>/<lib name>/<Element>.<kind>`), joined to the `.library` ref by
  RESOLUTION. The interim `POST /lib-symbols` endpoint is removed (folded in). Beckhoff returns none.

## 4. LSP: resolve library symbols + rider precision fixes — DONE

- [x] 4.1 Element signatures ingest via the existing kind-extension source scan (no ambient scope needed); bare
  elements + member access resolve. `.library` NAMESPACE registers namespace roots (existing `loadLibraryNamespaces`).
- [x] 4.2 VG `vg-undeclared-identifier` check now consults `libraryNamespaces` + `deviceInstances` (parity with ST).
- [x] 4.3 Bare members of a non-`{attribute 'qualified_only'}` enum resolve (cached set in the unresolved check;
  `qualifiedOnly` tracked on the enum scope).
- [x] 4.4 Parser: `FUNCTION_BLOCK X EXTENDS Y;` trailing `;` consumed so the VAR section still parses.
- [x] 4.5 VG opaque-leaf identifier scan skips `.`-preceded member segments (deep chain `a.b.c.d/10`).

## 5. Harvest / corpus — DONE

- [x] 5.1 `harvest-lsp-corpus.ts` makes ONE `/fetch?verbose` call and writes `changed` + `librarySignatures`.
- [x] 5.2 All four real corpora re-harvested from the cleaned `_Codesys` project variants (lenze/pro2193 v21,
  awa v18, bakon v21). Ratchet baselines updated. Built-only precision across the four: **405 → 32**
  (pro2193 17, bakon 11, awa 0, lenze 4).

## 6. Verify — DONE

- [x] 6.1 `bun test` (volt-lsp-iec full suite green incl. new renderer/enum/parser/VG tests); `bun typecheck` clean;
  C# `dotnet test` 202 pass; both bridges build.

## 7. Deferred / follow-ups (NOT in this change — closed as won't-fix-now)

These are consciously deferred: none is easily fixable and none blocks this change (which is complete).
Tracked in `openspec/specs/language-server/toolchain-map.md` so they aren't lost after archive.

- **7.1 Corpus signature VOLUME** (~18k stub files across 4 corpora) — a referenced-only filter would trim it,
  but it's a size optimization, not correctness. Deferred.
- **7.2 lenze `EXECUTE` residual (4)** — ST inside a CODESYS "Execute" box is dropped by the bridge PlcOpen
  round-trip (`EXECUTE()`). A separate **bridge** fix, not an LSP one. Deferred to a bridge change.
- **7.3 Full nav for bare enum members** (go-to-def/hover/completion) — current fix is resolution-only. This is
  a **member-chain nav** concern that the AST-treewalker work (`st-body-ast` consumers) is the right home for.
- **7.4 `volt-control` `isLibraryPath` + VS Code read-only affordance** — minor editor polish. Deferred.
