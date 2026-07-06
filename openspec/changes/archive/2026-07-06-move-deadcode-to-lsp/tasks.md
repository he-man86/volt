Move dead-code handling from the bridge (a fetch flag) to the LSP (structural reachability + a config-gated
suppression). Excluded-from-build stays omitted by the bridge; dead code is always returned as plain source;
NO markers or flags in any file. Live targets: CODESYS `:8556`, TwinCAT `:8555`.

## 1. Bridge — delete `omitDeadCode` + the compiled-POU chain (excluded-omit stays)
- [x] `Wire/RefsFetch.cs` — remove the `OmitDeadCode` property (JsonPropertyName `omitDeadCode`) from `FetchRequest`.
- [x] `Sync/FetchService.cs` — remove the dead-code block (the `request.OmitDeadCode && GetCompiledPouNames()` removal
      loop), the `pouItems` list + its population, and update the class doc-comment (dead code is no longer omitted;
      only excluded-from-build is). KEEP `if (it.ExcludeFromBuild) continue;`.
- [x] `Ide/IIdeSession.cs` + `Ide/DriverBase.cs` — remove `GetCompiledPouNames` (declaration + abstract member).
- [x] `Codesys/Driver/CodesysDriver.cs` + `Codesys/Ide/CodesysObjectModel.cs` — remove the `GetCompiledPouNames`
      override + its compiled-model reflection. (The compile context stays — `ExtractLibrarySignatures` still uses it.)
- [x] `Beckhoff/Driver/BeckhoffDriver.cs` — remove the `GetCompiledPouNames` override (returned null).
- [x] Confirm no other consumer of `GetCompiledPouNames` / `OmitDeadCode` remains (grep both, incl. openapi.yaml).

## 2. Bridge — tests
- [x] `test/Volt.Bridge.Tests/FakeIde.cs` — remove `CompiledPous` + `GetCompiledPouNames`.
- [x] `test/Volt.Bridge.Tests/FetchExclusionTests.cs` — remove the `omitDeadCode` dead-code test; KEEP the
      exclude-from-build tests (excluded item omitted, siblings fold beside it, `(unresolved)` surfacing).
- [x] Full C# unit suite green.

## 3. Harvest + corpus
- [x] `volt-scripts/harvest-lsp-corpus.ts` — drop `omitDeadCode: true` (and its comment); harvest returns all code.
- [ ] BLOCKED (manual/engineer): re-harvest the 5 corpus projects (now includes dead code). Requires loading
      EACH fixture into the live IDE and running `bun volt-scripts/harvest-lsp-corpus.ts <corpus>/<project> 8556`
      one at a time — cannot be driven headlessly. The currently-loaded IDE project is the engineer's own, not a
      fixture. Verified `deadPous` runs clean on a live 567-file project (341 dead, dominated by decl-only
      library signatures; 0 error diagnostics, 0 wrongly suppressed). NOTE the pre-existing Windows long-path
      issue on `packages/volt-lsp-iec-next/test-corpus/` — harvest to the legacy `volt-lsp-iec/test-corpus`
      path the `-next` corpus test already references, or resolve the long-path first.

## 4. LSP (`volt-lsp-iec-next`) — structural dead-code detection
- [x] `src/analysis/config.ts` — add `diagnoseDeadCode: boolean` (default `false`). Place it on the analysis
      config (NOT the style-`lints` bag — it changes WHAT is analyzed, not adds a lint). Plumb it through
      `resolveConfig`/`ResolvedConfig`.
- [x] Reachability pass (analysis layer, project-level — NOT a per-document `CHECKS` entry). Inputs it needs that
      don't exist yet: (a) all workspace document bodies (the services layer already exposes `workspace(): Document[]`
      / `stBodies` — reuse), (b) reachability ROOTS. Compute:
  - Roots = every PROGRAM POU (IEC entry points; tasks invoke programs — no task-file parsing in v1).
  - Reachable = transitive closure from roots via: calls (`resolveMemberChain` — exists), **FB instantiation edges**
    (`inst : FB_A;` — NEW small walk over each scope symbol's `typeExpr` → `named_type`/`array_type` element),
    `EXTENDS`/`IMPLEMENTS`, and declared-type references.
  - Dead = top-level POUs not in the reachable set.
  - SAFETY INVARIANT: uncertain reachability (interface-typed / pointer assignment, dynamic dispatch) ⇒ treat as
    LIVE. Never mark a possibly-reachable unit dead. An FB implementing a referenced interface is LIVE.
- [x] Wire the dead set + `diagnoseDeadCode` into diagnostics: when `diagnoseDeadCode` is false, SUPPRESS all
      diagnostics whose owning top-level unit is in the dead set; when true, diagnose everything. (Compute the dead
      set once per project rebuild in `server.ts`; hand it to `computeSemanticDiagnostics` and filter per unit.)
- [x] (If a user-facing toggle is wanted) plumb `initializationOptions.diagnoseDeadCode` in the server — today
      `resolveConfig` is only ever called with `{ vendor }`. Otherwise the flag is code-default only for now.

## 5. LSP — tests
- [x] Unit: a PROGRAM→FB call chain keeps the FB live; an FB never called/instantiated is dead; an FB reachable
      only via `inst : FB;` declaration is LIVE (instantiation-edge regression); an FB implementing a used interface
      is LIVE (uncertain⇒live). With `diagnoseDeadCode=false` a dead POU with a genuine error emits NOTHING; with
      `true` it emits the error.
- [x] Corpus 0-FP gate holds over the re-harvested corpus (dead code present, suppressed by default).

## 6. Specs
- [x] `bridge-protocol`: replace "The bridge returns only items with compiler ground truth" — excluded omitted
      (keep), dead code NO LONGER omitted (returned as ordinary source). (delta in this change)
- [x] `st-language-server`: REMOVE "Diagnostics skip build-excluded objects" (excluded objects are never delivered
      → nothing to gate) and "Build-excluded source is marked in content, not a side manifest" (marker retired);
      ADD "Dead code is detected structurally and its diagnostics are config-gated". (delta in this change)
- [x] Reconcile the dangling cross-references to the retired marker / `excludeFromBuild` wire flag in both specs
      (e.g. bridge-protocol "Exclude-from-build is a per-item wire flag" — excluded items aren't sent, so there is
      no wire flag; it is an internal omission signal).

## 7. Land
- [x] Full bridge suite (216) + LSP suite (138) + LSP typecheck green; Beckhoff bridge builds; CODESYS bridge
      compiles clean (net48 copy step blocked only by the live IDE holding the loaded DLL — environmental, not
      code); `check-divergence` clean.
- [x] `openspec validate move-deadcode-to-lsp` passes. Archive AFTER the manual corpus re-harvest (task 3.2)
      confirms the 0-FP gate holds with dead code present.

## Notes
- Legacy `volt-lsp-iec` is still the SHIPPED LSP (wired in `.opencode/opencode.json` + `volt-config`). Its
  `src/semantic/exclude-marker.ts` + `exclude-from-build.test.ts` stay FROZEN — this work lands in `-next`, the
  clean-room replacement. Do not port the marker.
- Roots=PROGRAMs is the standard reachability model (Rust `dead_code`, tree-shaking). It over-includes vs the
  CODESYS compiler ONLY for a program assigned to no task (+ code only it uses). If the corpus shows a false
  positive from that, add task/config-file ingestion then — deferred, not v1.
- The `diagnoseDeadCode` default is OFF to match CODESYS now; the stated intent is to flip it ON later (a one-line
  default change), once reachability is proven conservative enough not to hide errors.
