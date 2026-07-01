## 1. Bridge (C# shared Core)

- [x] 1.1 In `Materializer.cs`, normalize the source-item extension via new `SourceExt(lang)`: textual (ST) or editable-graphical (FBD/LD) → `st`; read-only graphical (CFC/SFC) → body language. Non-source (references) still `ItemKind.ExtFor`.
- [x] 1.2 Remove the collapsed textual entries from `ItemKind.ExtFor` (`interface`, `structure`, `enumeration`, `union`, `alias`, `gvl`); keep only the reference kinds + `folder`. Doc comment updated.
- [x] 1.3 `Sync/DebugService.cs` `RawBodies` left as-is: it's a raw-PLCopen-XML diagnostic that only emits graphical POUs (textual return no XML, skipped) — keeping the true body language (`fbd`/`ld`/`cfc`/`sfc`) preserves diagnostic fidelity. Fixed stale extension doc comments in `StAssembler`/`RefsFetch`/`Hasher`/`Materializer`.
- [x] 1.4 Built both bridges (Core+Codesys net48, Beckhoff net8) clean; `dotnet test test/Volt.Bridge.Tests/` → 170 pass. Live e2e (`test/e2e`) against headless CODESYS on :8556 → 58 pass (graphical + DUT/interface roundtrip now `.st`, kind recovered from content).

## 2. CLI (`volt-git`)

- [x] 2.1 In `src/registry/extensions.ts`, dropped `fbd, ld, itf, gvl, struct, union, enum, alias` rows (all fold into `st (rw)`); kept `cfc`/`sfc` + read-only reference extensions.
- [x] 2.2 `gitattributesContent()` now emits `* text=auto eol=lf` (blanket LF) — fixes pre-existing Windows CRLF drift on un-attributed read-only manifests (`.library`/`.task`) that spuriously blocked push. Removed now-dead `sourceExtensions`/`isSourcePou`.
- [x] 2.3 Updated `packages/volt-bridge/item-kinds.json` `$comment` (many-kinds→one-`.st`). Fixed stale doc comments in `scaffold.ts` + `bridge/types.ts`. (ITEM_KINDS.md untouched — no per-source-kind extension claims found.)
- [x] 2.4 `graphical-roundtrip.test.ts` updated (provision/assert `.st`, prove graphical by NETWORK content). `vocabulary`/`sync`/`live-roundtrip` needed no extension edits. `bun test` → 54 pass live on :8556; typecheck clean.
- [x] 2.5 `graphical-roundtrip.test.ts` now asserts an FBD/LD POU materializes as `.st` and round-trips (edit VG → push → pull), locking in content-based routing.

## 3. Editor surface (`volt-vscode`) + LSP registration

- [x] 3.1 `package.json`: `structured-text` now owns `.st`+`.cfc`+`.sfc`; removed `plc-interface`/`plc-gvl`/`plc-dut` languages + their grammars. Reference-kind languages/icons kept. Deleted 5 orphaned icons (dut/fbd/gvl/itf/ld.svg) + pruned `volt-icons.json`.
- [x] 3.2 Simplified the `activationEvents` `workspaceContains` glob (`st,cfc,sfc`+references) and removed the dead `onLanguage:` entries; grammars reduced to `structured-text` + the `vg.injection`.
- [x] 3.3 `src/lsp.ts`: document selector reduced to `structured-text`; watcher glob `**/*.{st,cfc,sfc}`.
- [x] 3.4 LSP file-association updated to `[".st",".sfc",".cfc"]` in `.opencode/opencode.json` and the shipped `volt-config/opencode.json`. (No `volt init` emitter — unify model ships `volt-config`.) Also collapsed the LSP's own workspace scan (`dispatch.ts` `ST_LIKE_EXTENSIONS` → `.st`) and refreshed agent docs.

## 4. Verify end to end

- [x] 4.1 All Volt packages typecheck clean (bridge/git/lsp/vscode). Repo-wide typecheck's only failure is a pre-existing upstream `packages/app/src/custom-elements.d.ts` issue, unrelated.
- [x] 4.2 Live headless CODESYS bridge (:8556): bridge e2e 58 pass, volt-git 54 pass — real project fetches source (incl. graphical + DUT/interface) as `.st` and pushes back with kinds recovered from content.
- [x] 4.3 LSP suite 5251 pass (walkForStFiles `.st`-only verified); C# 170 pass.
- [x] 4.4 `openspec validate unify-item-file-extensions` → valid. One-time re-materialization on first pull noted in proposal/design.
- [x] 4.5 Bonus fix bundled: `.gitattributes` now normalizes all workspace files to LF (`* text=auto eol=lf`), fixing pre-existing Windows CRLF drift on read-only manifests that spuriously blocked push.
