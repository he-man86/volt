## Why

Browsing a real full-option CODESYS project makes it obvious that a file's extension should tell you *what the item is*. The just-shipped `unify-item-file-extensions` collapsed every writable source item to `.st`, which throws that away — and the original scheme was never right either (all POUs were `.st` regardless of kind, so you couldn't tell a function block from a program from a function). Kind-in-the-extension (`Motor.fb`, `Main.prg`, `Ramp.fun`, `IMotor.itf`, `Recipe.struct`) is the more useful scheme, and it stays round-trip-safe because kind is recovered from file **content** on push regardless of the extension.

## What Changes

- **BREAKING (wire):** Every writable source item materializes with a **kind-based** extension instead of `.st`:
  `function_block → .fb`, `program → .prg`, `function → .fun`, `interface → .itf`, `structure → .struct`,
  `enumeration → .enum`, `union → .union`, `alias → .alias`, `gvl → .gvl`.
- Editable graphical **FBD/LD** POUs are named by **kind** too (`.fb`/`.prg`/`.fun`) — graphical-ness is detected from the leading `NETWORK` content marker (as the LSP/editor already do), not the extension.
- Read-only graphical **CFC/SFC** POUs are **also** kind-named (`.fb`/`.prg`/`.fun`), and their materialized body carries an **in-content read-only marker** — a leading `READONLY <LANG>` line (e.g. `READONLY CFC`) stating the body is read-only because it is graphical. Read-only is thus **self-describing in the committed file**: no extension encoding, **no wire field, no sidecar**. The marker parallels the `NETWORK` VG marker, giving the LSP/editor/CLI a clean 3-way body discriminator (`NETWORK` → editable VG, `READONLY` → read-only graphical, else ST).
- **Opaque reference kinds** (`library`, `task`, `image_pool`, `text_list`, `recipe_manager`, `visualization`, `visualization_manager`, `library_manager`, `class_diagram`, `external_types`, `tmc`) keep their own extensions and read-only access — unchanged.
- Kind is still recovered from content on push (`ParseCodeHeader`), so the extension carries **no** kind and the round-trip is lossless. Because the wire name includes the extension, `structureVersion` is unaffected (it hashes bare names).
- **Supersedes** the archived `unify-item-file-extensions`; a one-time re-materialization renames `*.st` → the kind extensions on the next pull.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `workspace-file-extensions`: the writable-source rule becomes **kind-based** extensions (`.fb`/`.prg`/`.fun`/`.itf`/`.struct`/`.enum`/`.union`/`.alias`/`.gvl`) rather than a single `.st`; read-only status for POUs comes from an in-content `READONLY <LANG>` marker, not the extension or a wire field.
- `bridge-protocol`: the wire name is the full kind-based name; read-only items are refused by the bridge's live body language (no `.cfc`/`.sfc` extension to key on, no new wire field).
- `vg-language`: an editable graphical POU materializes as its kind extension (`.fb`/`.prg`/`.fun`) detected as VG by the `NETWORK` marker; a read-only CFC/SFC POU materializes with a `READONLY <LANG>` body marker and is not analyzed as VG.

## Impact

- **Bridge (`packages/volt-bridge`, shared Core):** `Materializer` (kind-based extension for source POUs; drop `SourceExt`→`.st`; emit the `READONLY <LANG>` body for CFC/SFC POUs instead of an empty declaration-only body), `ItemKind.ExtFor` (add POU kinds), a `VgBody.IsReadOnly`/marker helper. No wire-model change.
- **CLI (`packages/volt-git`):** `registry/extensions.ts` (per-kind table again; reference kinds read-only by extension), **read-only for POUs detected from the `READONLY` body marker** (content-based `isReadOnly`), `.gitattributes` generator (already `* text=auto eol=lf` — covers any extension), materialize/pathToItem, tests.
- **`volt-vscode`:** re-add per-kind language/grammar/icon associations (all mapping to the `structured-text` language) + activation/watcher globs.
- **LSP (`packages/volt-lsp-codesys`):** `dispatch.ts` `walkForStFiles` + `scripts/run-diagnostics.ts` scan the new extension set; `.opencode/opencode.json` + `volt-config/opencode.json` LSP `extensions` list.
- **Ripple:** the in-flight `harden-lsp-real-project` corpus becomes `.fb`/`.prg`/`.fun`/`.itf`/`.struct`/… (not `.st`); its `language-server` delta + tasks that mention `.st` update when this lands.
- **Migration:** one-time re-materialization on first pull (native git delete+add); no custom migration. No new upstream seams (all fork-owned).
