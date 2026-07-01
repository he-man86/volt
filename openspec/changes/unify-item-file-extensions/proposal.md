## Why

Volt materializes each IDE item as `name.<ext>` where the extension encodes the item's kind/body-language (`.st`, `.fbd`, `.ld`, `.itf`, `.gvl`, `.struct`, `.enum`, `.union`, `.alias`, …). But every one of those is Structured Text (or an editable graphical body that already round-trips through the NETWORK-token VG form), and the kind is fully recoverable from file **content** on push-back — so the per-kind extension buys nothing and instead fragments the editor/LSP/agent surface (nine file types, nine language ids, nine icons) and forces every consumer to enumerate a long extension list. Collapsing the writable source types to a single `.st` makes the workspace one coherent language.

## What Changes

- **BREAKING (wire):** The writable source kinds materialize with a single `.st` extension instead of per-kind ones. Collapsed: `st, fbd, ld, itf, gvl, struct, union, enum, alias → .st`. Because the wire item **name includes the extension**, the collapsed items get new wire names → `structureVersion` changes and a bound workspace re-materializes (old `.fbd`/`.itf`/… deleted, `.st` created) on the next pull. One-time churn; no data loss (kind is recovered from content).
- **Unchanged (deliberately out of scope):** read-only graphical bodies `.cfc`/`.sfc` keep their extension (declaration-only — language can't be content-detected, and they must stay flagged read-only), and every opaque reference kind (`.library`, `.task`, `.image_pool`, `.parameter_list`, `.text_list`, `.recipe_manager`, `.visualization(_manager)`, `.library_manager`, `.class_diagram`, `.external_types`, `.tmc`) keeps its extension and read-only access.
- The bridge's extension choice (`Materializer`) normalizes textual + editable-graphical source POUs to `.st`; `ItemKind.ExtFor` drops the collapsed textual entries.
- The CLI extension registry shrinks to `st (rw)` + the read-only extensions; `.gitattributes` generation follows.
- `volt-vscode` collapses its language/grammar/icon contributions and activation/watcher globs; the LSP document-selector reduces to the `.st` language. VG highlighting is unaffected (already NETWORK-token content injection).
- The LSP registration Volt writes (`.opencode/opencode.json`, the shipped `volt-config`, and what `volt init` emits) attaches to `.st` instead of the extension list.

## Capabilities

### New Capabilities
- `workspace-file-extensions`: The rule for which workspace file extension an IDE item materializes as — writable Structured Text and editable graphical (FBD/LD) source collapse to `.st`; read-only graphical (CFC/SFC) and opaque reference kinds keep distinct extensions; file access (read-only vs. writable) is derived from the extension, and item kind is recovered from file content on push-back.

### Modified Capabilities
- `vg-language`: The VG content-detection requirement currently frames coverage as "whole `.fbd`/`.ld` files *and* inlined `.st` methods." Editable graphical POUs now materialize as `.st`, so detection is uniformly the NETWORK token across `.st` bodies, with no `.fbd`/`.ld` extension.

## Impact

- **Bridge (C#, shared Core — parity preserved automatically):** `Volt.Bridge.Core/Workspace/Materializer.cs` (extension normalization), `ItemKind.cs` (`ExtFor` entries), `Sync/DebugService.cs` (debug-dump extension). No per-vendor code changes — both bridges stay byte-identical.
- **CLI (`volt-git`):** `src/registry/extensions.ts` (table + `.gitattributes`), tests (`vocabulary`, `sync`, `live-roundtrip`, `graphical-roundtrip`).
- **`volt-vscode`:** `package.json` (activation glob, `languages`, `grammars`, icons), `src/lsp.ts` (document selector, watcher glob).
- **Contracts/docs:** `packages/volt-bridge/item-kinds.json` (`$comment` invariant), `ITEM_KINDS.md`.
- **Additive config:** `.opencode/opencode.json` LSP registration + the shipped `volt-config` + `volt init` emitter.
- **Migration:** existing bound workspaces re-materialize collapsed items on next pull (one-time). No custom migration step — native git sees deletes + adds.
