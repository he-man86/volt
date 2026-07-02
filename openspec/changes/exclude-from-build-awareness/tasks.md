## 1. Verify the live scripting read (spike)

- [x] 1.1 Bring the headless bridge up on the Pro2193 project; extend `/debug` (`IDebugIntrospect`) to read a named ScriptObject member and confirm `effectively_excluded_from_build` returns `true` for `MagazineBaseFB` and `false` for a built sibling. **DONE 2026-07-02: `MagazineBaseFB`→True (methods inherit True), `ActuatorFB`/`BFU`/`SER`→False. Reflection via `GetMember` works.**
- [x] 1.2 Confirm the fallback member `build_properties.exclude_from_build` is reachable by the same reflection path; note in design.md if member names differ. **DONE: both `effectively_excluded_from_build` and `build_properties.exclude_from_build` read live. Key finding: use the EFFECTIVE one — methods report direct=False but effective=True (inherited); the direct property would wrongly diagnose inlined methods of an excluded FB.**

## 2. Bridge: emit excludeFromBuild

- [x] 2.1 `CodesysObjectModel`: add `IsExcludedFromBuild(node)` = `GetMember(Unwrap(node), "effectively_excluded_from_build")` with fallback to `build_properties.exclude_from_build` then `false` (mirror `IsFolder`).
- [x] 2.2 Carry the boolean on `ProjectItem` (populate in `CodesysDriver.Tree.Walk`).
- [x] 2.3 Add `excludeFromBuild` to the `/refs` per-item response (parallel map) and to the `/fetch` `FetchedItem`. Additive/optional; absent ⇒ `false`. `structureVersion`/`projectVersion` unchanged (still hash bare names).
- [x] 2.4 Beckhoff/TwinCAT driver: return `excludeFromBuild: false` (documented parity gap) so wire responses stay identical in shape.

## 3. Bridge: replace the READONLY marker with an informational marker

- [x] 3.1 `Materializer`: emit `(* Graphical <LANG> — edit in the IDE; Volt does not represent it as text *)` for CFC/SFC bodies instead of `READONLY <LANG>`.
- [x] 3.2 `VgBody`: remove `IsReadOnly` / `ReadOnlyLanguageOf` / `ReadOnlyHeader`.
- [~] 3.3 `PushService`: remove the now-dead marker-based refusal (line ~227). Confirm the live-state body-type guard (CFC/SFC via `BodyLanguage`, lines ~272-285) still refuses graphical pushes — this is the retained safety net; add/adjust a test proving refusal with no marker present.
- [x] 3.4 Update `ItemKind`/comments and any C# tests/fixtures asserting the `READONLY` marker.

## 4. Wire types + CLI/manifest

- [x] 4.1 `volt-git bridge/types.ts`: add optional `excludeFromBuild` to `FetchedItemSchema`; add the per-item map to `RefsResponseSchema`. No `readOnly` field.
- [x] 4.2 `volt-git` fetch/materialize + sidecar: persist `excludeFromBuild` per item.
- [x] 4.3 `volt-control`: add `readExcludedFromBuild(workspaceRoot)` returning a per-path set (mirror `readExtensionAccess`). Remove `bodyIsReadOnly`/`READONLY`-marker logic. Leave the config-kind read-only access map (feeds the `RO` badge) unchanged.

## 5. LSP: gate diagnostics + honest ground truth

- [x] 5.1 Remove the `isReadOnlyBody` / `READONLY`-marker path; a graphical body is now a comment and needs no special handling.
- [~] 5.2 Tag each parsed unit with its item's `excludeFromBuild` (from the workspace manifest); `computeSemanticDiagnostics` skips units whose item is excluded.
- [x] 5.3 `scripts/coverage-report.ts`: partition the corpus built vs excluded (from a committed excluded-paths manifest); report precision over built only + excluded count separately.
- [x] 5.4 `real-corpus.test.ts`: ratchet on built-only precision; record the new baseline. Regenerate the excluded-paths manifest from a `/refs` against the real project and commit it beside the corpus.

## 6. VS Code decorations

- [x] 6.1 `providers/decorations.ts`: add an `EX` badge (`disabledForeground`, tooltip about skipped diagnostics) from `readExcludedFromBuild`, populated in `refresh()`. Keep the `RO` badge fed by the config-kind access map; confirm graphical POUs no longer get `RO`.

## 7. Verify + sync

- [ ] 7.1 `dotnet test` (bridge) + `bun test` in each touched TS package (`volt-git`, `volt-lsp-codesys`, `volt-vscode`); `bun typecheck`, `bun lint`.
- [ ] 7.2 Live round-trip: pull Pro2193, confirm `MagazineBaseFB` yields zero diagnostics (excluded) and a CFC POU materializes the informational marker; a textual push over it is refused by live state.
- [ ] 7.3 `bun volt-scripts/check-divergence.ts` + `check-volt-integration.ts` green (all changes additive within `packages/volt-*`).
