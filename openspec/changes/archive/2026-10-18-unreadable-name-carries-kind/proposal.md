> One wire release (protocol number kept at 1 by owner decision, 2026-10-18), together with `refuse-unknown-request-members` and `relay-protocol-tracks-wire-breaks`
> (which carries the shared tasks). This changes what a response member means, so it must ride the same bump.

## Why

On the path wire every item identity is `<folder>/<name>.<kind>` (`docs/wire.html:58-64`). `unreadable[].name` is the one
exception. It is `<folder>/<bare name>`, with no kind (`Volt.Contracts/Wire/Shared.cs:58-59`, `:104-106`), and the list
mixes two different things:

- **Items** the walk classified and could not read or must not open. A read that failed (`VersionedItem.Unread`,
  `Volt.Engine/Sync/Versioning.cs:122`, kind in hand at `ProjectSnapshot.cs:139`), an item in an excluded folder
  (`CodesysDriver.Tree.cs:126`), a refused library reference (`:171`), and a TwinCAT POU Volt must not open (DIALECT C2i,
  `BeckhoffDriver.Tree.cs:98`). Each has a known kind and so a full path.
- **Tree nodes with no file.** A container or manager whose setting no text spells (`Kinds = []`,
  `CodesysDriver.Tree.cs:115`, `:164`, `:177`; measured live: the SP18 Library Manager, DIALECT V7), and an object whose
  kind could not be read (`Kinds = null`, `:72`, `BeckhoffDriver.Tree.cs:126`). `:102` also emits `null` for a container
  whose properties failed to read, though its kind (folder) is known.

What the kindless name costs:

- **A client cannot address an unreadable item.** The documented repair (DIALECT C2i: a forced push deletes it) needs a
  `deleteItem` with the full path, so the client must guess the kind. A wrong guess addresses a neighbour of the same bare
  name (`CM_Carrier.pou` beside `CM_Carrier.visualization`, two such pairs in V71_PackML_Hauzer) or nothing. Volt's own e2e
  harness guesses it in 4 places: `push-without-header-check.test.ts:31-46`, `kind-name-cycle.test.ts:103-106`,
  `refusals/table.ts:91`, `lib/workspace.ts:182-195`.
- **The engine keeps a second identity.** `Removal` keys its exemption by bare path + walked kind (`Removal.cs:11-15`,
  `:68-88`) because the wire has no kind. For a verbatim-named kind (TwinCAT `Untitled2.tmc`, `Materializer.IsVerbatimKind`),
  `AddUnreadable` keys `<f>/Untitled2.tmc` and `IsUnreadable` looks up `<f>/Untitled2`, which misses, so an unreadable
  `.tmc` would be reported removed. `PushService.cs:76`, `:152` keys `notOpened` by bare path, so a `set` on `X.dut` beside
  an unopened TwinCAT POU `X` is refused `UNREADABLE`.
- **A refused library is named in the wrong folder.** `CountUnclassifiable` uses `o.Folder` (`Versioning.cs:61`); the item's
  folder is `FolderOf(kind, …)`, the library's own.
- **`refs` and `fetch` disagree.** `fetch` applies `.Distinct()` (`FetchService.cs:249`), `refs` does not
  (`RefsService.cs:41`).

Every producer emits at most one kind, so `UnreadableObject.Kinds` (a list) describes a state none can create.

## What Changes

- **`unreadable` holds items only**, each `{ name, reason }`, with `name` the item's full path, minted by the one minter
  the wire already uses (`Materializer.FullWireName` + `Versioning.FolderOf`, exposed as one function). It is exactly the
  path the item has in `items` while readable, so `Untitled2.tmc` stays `Untitled2.tmc` and a library sits in its own
  folder.
- **`unreadableNodes` holds tree nodes with no file**, each `{ name, reason }`, with `name` the node's path
  `<folder>/<name>`: a container setting no text spells, or an object whose kind could not be read. Both members are
  required on both lists.
- **Engine:** `UnreadableObject.Kinds` becomes one `string? Kind` (null: unknown; `folder`: a container node; else the
  item's kind). `CodesysDriver.Tree.cs:102` records `folder` AND adds the container's subtree to `unwalked` itself, as
  `:164` does: today that subtree reaches `UnwalkedFolders` only through `WalkResult`'s `Kinds is null` rule
  (`WalkResult.cs:41-43`), so without it every known item under the container would be reported removed. That rule
  stays for `Kind is null` only. The same list becomes one `Kind` in `UnreadableItemException.Kinds`,
  `ItemLookup.Untouchable.Kinds` (`PushService.ApplyToUnopened`, `:763-765`) and `ExplorerSnapshot.PouKinds`.
  `Removal`'s exemption is membership of the unreadable full paths; `UnreadableKinds`, `AddUnreadable` and the
  bare-path/kind matching are deleted. `PushService`'s `notOpened` is keyed by full path. `PushConflicts` gets the bare
  paths of `Kind is null` objects only (`PushService.cs:109` passes every unreadable object today, so `set X.dut` beside
  an unreadable `X.pou` is still refused), and the bare-path fallback in its key resolution (`PushConflicts.cs:46-56`)
  is deleted: every unreadable item is keyed by its full path.
- `refs` and `fetch` emit both lists through one ordering function; neither collapses entries.
- CLI and volt-control print both lists. The 4 e2e kind guesses are replaced by the entry's `name`. The dead check at
  `refusals/table.ts:327` (an `UnreadableItem` compared to a string) is fixed.
- The scripts that match the bare name switch to the full path: `volt-cli/scripts/vendor-facts.ts:741`,
  `completeness.ts:439-445` (`refusedAt`), `volt-lsp-iec/scripts/held-as.ts:46`, `:64`, `:77` and its test fixture
  (`held-as.test.ts:60`). Each would otherwise silently stop matching.

## Impact

- `Volt.Contracts/Wire/Shared.cs` (`unreadable` meaning, `unreadableNodes`), `Volt.Engine/Item/WalkResult.cs`
  (`UnreadableObject.Kind`), `Volt.Engine/Ide/UnreadableItemException.cs`, `ItemLookup.cs`,
  `Volt.Engine/Sync/Versioning.cs`, `Removal.cs`, `Materializer.cs`, `PushService.cs`, `PushConflicts.cs`,
  `RefsService.cs`, `FetchService.cs`, both vendors' `*.Tree.cs`, `Volt.Ide.Twincat/Ide/ExplorerSnapshot.cs`, `FakeIde`.
- Scripts: `volt-cli/scripts/vendor-facts.ts`, `completeness.ts`; `volt-lsp-iec/scripts/held-as.ts`, `held-as.test.ts`.
- `Volt.Cli` (`Program.cs:195`, `:254`), `packages/volt-control` (`types.ts:18`), e2e harness.
- `docs/wire.html`, OpenRPC (regenerated), `Volt.Engine/Ide/DIALECT.md` (C2i, C7, V7 wording).
