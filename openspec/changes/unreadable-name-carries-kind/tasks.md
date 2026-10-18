## 1. Tests red

- [ ] 1.1 FakeIde: a classified POU whose read throws → `unreadable` holds `{ name: "<folder>/<name>.pou", reason }`, the
      path it had in `items`. Today: bare.
- [ ] 1.2 FakeIde: FB `CM_Carrier` unreadable beside a readable `CM_Carrier.visualization` → the entry names `…/CM_Carrier.pou`.
- [ ] 1.3 A verbatim-named kind (`Untitled2.tmc`) unreadable → its entry is `…/Untitled2.tmc`, and a client that knows
      `…/Untitled2.tmc` does not get it in `removed`. Today: reported removed.
- [ ] 1.4 A refused library reference → its entry sits in the library's own folder (`FolderOf`), not the manager's.
- [ ] 1.5 TwinCAT offline (`TcWalkUnreadableObjectTests`): a C2i POU's entry ends in `.pou`.
- [ ] 1.6 CODESYS offline: a container setting no text spells, and an object whose kind could not be read, are in
      `unreadableNodes` as `<folder>/<name>`, not in `unreadable`.
- [ ] 1.7 `PushService`: a `set` on `X.dut` is applied, not refused `UNREADABLE`, beside an unopened TwinCAT POU `X`
      (`notOpened`) AND beside an unreadable `X.pou` of known kind (`PushConflicts`). Beside an object of unknown kind
      `X` it is still refused.
- [ ] 1.8 `refs` and `fetch` over one walk give identical `unreadable` and `unreadableNodes` lists.
- [ ] 1.9 CODESYS offline: a container whose property read fails → a client that knows an item under it does not get it
      in `removed` (the subtree is in `unwalkedFolders`). Green today; must stay green through 2.1.

## 2. Implement

- [ ] 2.1 `UnreadableObject.Kinds` → `string? Kind`. Every producer states it; `CodesysDriver.Tree.cs:102` states `folder`
      and calls `unwalked.Add` for its subtree (as `:164`); `WalkResult`'s unwalked rule is `Kind is null` only. The same
      in `UnreadableItemException.Kinds`, `ItemLookup.Untouchable.Kinds` (`PushService.cs:763-765` compares one kind)
      and `ExplorerSnapshot.PouKinds`.
- [ ] 2.2 One function mints an item's full path (`FullWireName` + `FolderOf`), used by `VersionedItem` for both its
      `Identity` and its unreadable entry, and by `CountUnclassifiable`.
- [ ] 2.3 `ReadResponse.UnreadableNodes`; `CountUnclassifiable` routes `Kind` null or `folder` there, items to `Unreadable`.
- [ ] 2.4 `Removal`: the exemption is membership of the unreadable full paths. Delete `UnreadableKinds`, `AddUnreadable`
      and the bare-path/kind matching. `PushService.notOpened` keyed by full path. `PushService.cs:109` passes
      `PushConflicts` the bare paths of `Kind is null` objects only; delete the bare-path fallback in its key
      resolution (`PushConflicts.cs:46-56`) and its comment.
- [ ] 2.5 One ordering function for both lists in `refs` and `fetch`; drop the `Distinct` in `FetchService`.
- [ ] 2.6 Correct the comments that state the kindless premise (`Versioning.cs:109-112`, `Shared.cs:58-59`, `:104-106`,
      `Removal.cs:11-15`).
- [ ] 2.7 CLI (`Program.cs:195`, `:254`) and volt-control (`types.ts`) show both lists.
- [ ] 2.8 e2e: replace the 4 kind guesses with the entry's `name`; fix the dead check at `refusals/table.ts:327`.
      `push-without-header-check.test.ts` and `kind-name-cycle.test.ts` carry another session's uncommitted edits:
      commit by explicit pathspec, never `git add -A`.
- [ ] 2.9 Scripts on the full path: `volt-cli/scripts/vendor-facts.ts:741`, `completeness.ts:439-445` (`refusedAt`),
      `volt-lsp-iec/scripts/held-as.ts:46`, `:64`, `:77`; rewrite the `held-as.test.ts:60` fixture.

## 3. Docs

- [ ] 3.1 `wire.html`: the `unreadable` and `unreadableNodes` rows and the identity section (every item path on the wire
      is `<folder>/<name>.<kind>`). Regenerate OpenRPC.
- [ ] 3.2 `DIALECT.md` C2i, C7, V7: the entry's list and name.
