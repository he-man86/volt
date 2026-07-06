# Move dead-code handling out of the bridge and into the LSP

## Why

Two build-visibility concerns were entangled in the bridge (and, historically, an in-file marker):

- **Excluded-from-build** objects — the bridge already OMITS them entirely (no marker). Correct: an object the IDE won't compile has no ground truth, so delivering it would only produce false positives against code the toolchain never checks. Keep.
- **Dead / uncalled code** — the bridge could DROP it via an `omitDeadCode` fetch flag, driven by the CODESYS compiled-POU set (`GetCompiledPouNames`). This put reachability knowledge in the bridge and made the repo's *contents* depend on a flag. TwinCAT can't produce the compiled set at all, so behavior diverged.

The goal is simpler and marker-free:

- The repo always contains **all real source**, dead code included — no Volt flags or markers in any file.
- The bridge just doesn't send **excluded** objects (no ground truth). Everything it sends is analyzable.
- **Dead code is plain source.** The LSP decides — from the project's own call/instantiation graph — what is unreachable, and a config flag gates whether dead code is diagnosed. Default: suppress (match CODESYS, which never compiles dead code); intended to flip ON later.

This also retires the `(* @volt-exclude-from-build *)` marker mechanism completely — it is already absent from the committed corpus and already removed from volt-git push; only the specs (and the frozen legacy LSP) still describe it.

## What Changes

- **Bridge (Core + drivers) — deletion:** remove the `omitDeadCode` fetch flag and the entire `GetCompiledPouNames` chain (`IIdeSession`, `DriverBase`, `CodesysDriver`, `CodesysObjectModel`, `BeckhoffDriver`) — its only consumer was the dead-code omission block in `FetchService`. Excluded-from-build omission stays untouched. Dead code is always returned as ordinary source.
- **LSP (`volt-lsp-iec-next`) — new capability:** a project-level reachability pass. Roots = PROGRAM POUs; reachable = transitive closure via calls + FB instantiations + type/`EXTENDS`/`IMPLEMENTS` references; unreachable POUs = dead. A new `diagnoseDeadCode` config flag (default OFF): off ⇒ diagnostics suppressed on dead POUs (matches the compiler); on ⇒ everything diagnosed. **Uncertain reachability (dynamic dispatch, interface/pointer assignment) always resolves to LIVE** — never suppress a possibly-reachable unit, so real errors are never hidden.
- **Specs:** reconcile `bridge-protocol` (dead code no longer omitted) and `st-language-server` (drop the exclude-marker requirement; replace "skip build-excluded objects" with structural, config-gated dead-code suppression).
- **Corpus:** re-harvest without `omitDeadCode` (now includes dead code); the LSP's dead-code suppression keeps the 0-false-positive gate holding.

## Impact

- Affected specs: `bridge-protocol`, `st-language-server`.
- Affected code: `packages/volt-bridge` (Core + both drivers + tests), `packages/volt-lsp-iec-next` (analysis + server), `volt-scripts/harvest-lsp-corpus.ts`.
- **Not** touched: the shipped legacy `volt-lsp-iec` (its `exclude-marker.ts` stays frozen — the feature lands in the go-forward `-next`); volt-git (already clean — the mock-bridge's `excludeFromBuild` filter correctly mirrors the bridge omitting excluded items).
- Roots = PROGRAMs is the standard reachability-from-entry-points technique (cf. Rust `dead_code`); task-file parsing is a documented future refinement, only if the corpus shows a false positive from an unassigned program.
