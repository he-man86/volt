## Why

**The CLI decides what a DUT is.** On the wire a DUT is one kind, `X.dut`; on disk it is `X.struct`, `X.enum`,
`X.union` or `X.alias`. The split is made in the CLI, in both directions:

| where | what it does |
|---|---|
| `Volt.Cli/Sync/Materialize.FileNameFor` | pull: reads the declaration (`CodeHelper.DutSubtype`) to pick the file extension |
| `Volt.Cli/Sync/Extensions.FullNameFromPath` | push: maps the four extensions back to `.dut` (`ItemKind.WireExtFor`) |
| `Volt.Cli/Sync/IdeTree.cs:66-80` | a guard for the bug the split caused: a STRUCT rewritten as an ENUM left the old `X.struct` beside the new `X.enum`, still mapping to the live item — editing it pushed the old shape back, deleting it deleted the live DUT |
| `Volt.Cli/Sync/Commands.cs`, `Scaffold.cs` | refusal text and the scaffolded workspace doc naming the four extensions |

The CLI's job is git: files in, ops out. Knowing that a `.enum` is "really" a `.dut` is item-kind knowledge, and it
belongs where every other kind fact lives — the engine, once, at the name the wire publishes.

**The wire is already inconsistent.** `Volt.Engine/Library/LibSignatureRenderer` renders a library's DUTs as
`.enum` / `.struct` / `.union` itself. Only the project's own DUTs travel as `.dut`.

**Why it was put there** (`ItemKind.DutFileExtensions`): with the subtype in the wire identity, editing a struct
into an enum "would present as a DELETE plus a CREATE of the same underlying object". That is true, and it is a
fact about the vendor object — so it is answered below the wire (one push rule, below), not by hiding the subtype
from the wire and re-deriving it in every client.

## What Changes

- **The wire name of a DUT is its subtype name.** `Materializer.FullWireName` (the one place a full wire name is
  minted, feeding `VersionedItem.Identity`) names a DUT `X.struct|enum|union|alias` from its declaration
  (`CodeHelper.DutSubtype`, already engine code). `refs`, `fetch`, push ops, version maps and folder maps all
  carry that name. `.dut` disappears from the wire; `ItemKind.Kinds.Dut` stays the internal kind.
- **Push accepts a subtype change as an update.** Below the wire the four names are one vendor object (bare
  name `X`). In ONE push, for a DUT:
  - `set X.struct → toName X.enum` (git saw the rename) is a content update of `X`, not a rename;
  - `delete X.struct` + `set X.enum` (git saw delete + add — a struct→enum rewrite shares little text) coalesce
    into one content update of `X`, guarded by the delete's `ifVersion`;
  - anything else that lands two ops on one bare DUT is refused by name (`BAD_REQUEST`, naming both ops), never ordered.
  After the push, `refs` reports `X.enum`.
- **The CLI loses its DUT logic.** `FileNameFor` → the wire name IS the file name. `FullNameFromPath` → the file
  name IS the wire name. The `IdeTree` stale-subtype guard is deleted: a subtype change is now a removed name plus
  an added one in `refs`, which the ordinary `removedNames` sweep already handles. The library-signature exclusion
  beside it STAYS (it is about path-identified library files, not DUTs).
- **`ItemKind.WireExtFor` / `IsDutFileExtension` leave the CLI's reach**: the extension table
  (`SourceKindExtensions`, the wiring check's source) lists the four DUT extensions as plain source extensions.
- **Migration.** Workspace files were already written `.struct` etc., so most keep their names — but the subtype
  reader tightened (whole tokens, every comment and pragma after the colon skipped, a declaration stating no subtype
  refused), so a DUT the previous reader misread comes back from the recovery pull RENAMED, and one stating no
  subtype comes back UNREADABLE (file kept, pushes refused); `docs/items.html#dut-migration` lists the shapes. The sidecar
  `.git/volt/ide-refs.json` is keyed by wire name and holds `X.dut` keys; a sidecar with a `.dut` key is refused
  by name exactly as a malformed one is: the refusal names the key, `.git/volt/ide-refs.json` to delete, and
  `volt pull`. Every command that loads the baseline refuses — `volt pull` included, since it cannot rebuild a
  baseline it first has to load. No translator.

## Non-goals

- The LSP and `volt-vscode` already see `.struct`/`.enum`/… files — no change there beyond docs.
- No change to how a DUT is CREATED in the IDE (CODESYS `create_dut`; TwinCAT creates 606 and takes any shape).
- No new "duplicate name" guard: `X.struct` and `X.fb` are still two items (CLAUDE.md, the item-name invariant).

## Impact

- `Volt.Engine`: `Sync/Materializer.cs`, `Sync/PushService.cs` (the coalesce rule), `Item/ItemKind.cs`
  (drop `WireExtFor`, `IsDutFileExtension`; DUT extensions become ordinary entries), `Format/St/CodeHelper.cs`
  (doc only), `Library/LibSignatureRenderer.cs` (already split — verify it uses the same `DutSubtype`).
- `Volt.Cli`: `Sync/Materialize.cs`, `Sync/Extensions.cs`, `Sync/IdeTree.cs`, `Sync/Commands.cs`,
  `Sync/Scaffold.cs`, `Sync/Sidecar.cs` (the `.dut` refusal).
- `Volt.Contracts/Wire/RefsFetch.cs` doc (`"MyDut.dut"` example).
- Tests: `DutSubtypeFileTests`, `ItemKindTests`, `DutSubtypeCodeTests`, `PushServiceTests`,
  `TransportMatrixTests`, `WireVocabularyGuardTests`, `FakeIde`, e2e `vendor-parity`, `name-clash`,
  `crud-cycle`, `kinds/top-level`.
- Docs: `packages/volt-cli/docs/items.html` (generated + gated — `VOLT_WRITE_DOCS=1`), `wire.html`, DIALECT.md,
  `volt-control/src/state/files.ts` and `volt-lsp-iec/src/source-extensions.ts` comments ("one wire kind").
- Live: both vendors — a struct→enum rewrite pushed as rename and as delete+add; TwinCAT's tree code after it.
