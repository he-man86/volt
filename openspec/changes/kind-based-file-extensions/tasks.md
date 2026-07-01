## 1. Bridge (C# shared Core)

- [x] 1.1 `ItemKind.ExtFor`: re-added the source kinds (`function_block→fb`, `program→prg`, `function→fun`, `interface→itf`, DUTs, `gvl`); doc updated.
- [x] 1.2 `Materializer`: deleted `SourceExt`; source items use `ItemKind.ExtFor(build["kind"])` — the RESOLVED kind (refines DUTs). `.cfc`/`.sfc` no longer produced as extensions.
- [x] 1.3 `Materializer.BuildPou`: read-only graphical (non-editable) bodies emit `READONLY <LANG>` as the implementation; added `VgBody.IsReadOnly`/`ReadOnlyLanguageOf`.
- [x] 1.4 `PushService`: added a defensive refusal of a `READONLY`-marked body (new-item case); existing CFC/SFC already guarded by live `BodyLanguage`. Updated `item-kinds.json` `$comment`. (ITEM_KINDS.md prose has no per-kind ext table — no change needed.)
- [x] 1.5 Both bridges build clean (net48 + net8); `dotnet test` → 170 pass (fixed the `PLC_PRG.st`→`.prg` push-test names).

## 2. CLI (`volt-git`)

- [x] 2.1 `registry/extensions.ts`: per-kind table — `fb/prg/fun/itf/struct/enum/union/alias/gvl` = `rw`, reference extensions = `r`. Dropped `.st`/`.cfc`/`.sfc`.
- [x] 2.2 Added `bodyIsReadOnly(content)` (a `READONLY`-led body); `push.ts` filters read-only = `isReadOnly(path) || bodyIsReadOnly(headSrc(p))`. No wire flag, no sidecar.
- [x] 2.3 `materialize.ts`/`pathToItem` unchanged mechanics — verified against the new table.
- [x] 2.4 Updated `sync`/`live-roundtrip`/`graphical-roundtrip` for kind extensions; offline 32 pass, typecheck clean.

## 3. Editor + LSP

- [x] 3.1 `volt-vscode/package.json`: `structured-text` now owns `.fb/.prg/.fun/.itf/.struct/.enum/.union/.alias/.gvl`; dropped `.cfc`/`.sfc`; activation glob updated.
- [x] 3.2 `volt-vscode/src/lsp.ts`: watcher glob → the kind set.
- [x] 3.3 `dispatch.ts` `walkForStFiles` + `scripts/run-diagnostics.ts` scan the kind set. Also updated `verify-lsp.ts` (plants a `.fb`).
- [x] 3.3b `vg/index.ts` `isReadOnlyBody` + `buildBodyModel` `readonly` branch + `isStBody` exclusion — a `READONLY`-led body is not analyzed.
- [x] 3.4 LSP registration → kind set in `.opencode/opencode.json` + `volt-config/opencode.json`; agent docs (`.opencode/agent/volt.md`, `volt-config/agent/volt.md`) refreshed.
- [x] 3.5 Reinstated `KIND_EXT` in `conformance/_shared.ts`; snapshots regenerated (pure extension renames); LSP 5251 pass.

## 4. Verify end to end

- [x] 4.1 Typechecks clean (bridge/git/lsp/vscode/control). Lint at pre-existing baseline (1 error in an untouched file; my changes add none).
- [x] 4.2 Live headless CODESYS bridge (fresh build on the fixture): **bridge e2e 58 pass, volt-git 54 pass** — source fetches as `.fb`/`.prg`/`.fun`/`.itf`/`.struct`/…, push round-trips (kind from content). C# unit: **170 pass**.
- [x] 4.3 `verify-lsp.ts` → both phases PASS on a `.fb` file (dev auto-discovery + shipped `OPENCODE_CONFIG_DIR`).
- [x] 4.4 `openspec validate kind-based-file-extensions` → valid.

## 5. Ripple + supersede

- [x] 5.1 Added a superseding note to `harden-lsp-real-project/proposal.md` (corpus is kind-named, not `.st`; `READONLY` marker for read-only) rather than churning its prose before it's applied.
- [x] 5.2 Superseding of the archived `unify-item-file-extensions` recorded in proposal + design; noted for the PR.
- [x] 5.3 CLAUDE.md has no `.st` extension description to refresh (it's high-level; grep clean).
