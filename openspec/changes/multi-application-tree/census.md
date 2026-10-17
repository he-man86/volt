# Census (2026-10-17, read-only)

About 60 sites: Engine 22, Contracts 4, CODESYS driver 3, TwinCAT driver 7, Volt.Cli 7, e2e 7, LSP 5, control 3, vscode 2.

## Where the collapse happens
- CODESYS's walk already carries the full path (`ProjectItem.Folder`, CodesysDriver.Tree.cs). Every map above it keys by
  `FullName`: Versioning.cs:116 `Identity`, ProjectSnapshot.cs:138-150, FetchService.cs `DedupeByFullName` (137/162/270, the
  CODESYS loss; LibraryFetch.cs:74-78 depends on its last-wins), Removal.cs, BuildService.cs:107-140.
- Push resolves by bare name anywhere in the tree: PushService.cs:52/60 `itemCache[it.Name]`, ApplyOp 668-676,
  RequireOneOpPerItem 813-840, move 936/988/1047, `ItemLookup.Find/Locate/Refind` (ItemLookup.cs:112/127/147). It can write
  or delete the wrong application's item.
- Per-project indexes: ProjectDeclarations.cs:45-66, PushedDeclarations.cs:44-47.
- Wire: Shared.cs:46/50, RefsFetch.cs, PushModels.cs (the doc at :52 says "names are globally unique"; no longer true),
  BuildModels.cs:55-59.
- CODESYS: `Build()` → `FindApplication()` first/active application only (CodesysDriver.cs:213, ObjectModel.cs:309); library
  precompile on the first application (Libraries.cs:282).
- TwinCAT: `FindPlcProject` `tipc.Child[1]` (TcObjectModel.Session.cs:284-289); `FindTwinCatProject` binds one system
  project (238-270); single-root state `PlcRoot()`/`_plcRootPath`, ExplorerSnapshot, TcHierarchy, BeckhoffDriver.Tree.cs
  (root = PLC project), project settings, TIID, library manager, TIRT. The pinned tests: TcSystemManagerTests,
  TcSilentFallbackTests, TcComTree.
- CLI: Commands.cs:495-597 (move pairing by name), 295/377-388 (sidecar), 1262-1278; Extensions.cs:41; Materialize.cs:30;
  IdeTree.cs:44-111; StatusModel/Types `PathByName`/Sidecar.
- LSP: one `projectScope` per workspace (workspace-store.ts, project-build.ts), workspace-refs.ts merges, name-index.ts:20,
  ambiguous-global.ts (cross-application GVLs would be a false C0136), server/state.ts.
- control: view/workspace.ts:136-141, state/status.ts:230, view/build.ts. vscode: decorations.ts, panel.ts.

## Decisions (defaults, 2026-10-17; the owner may override)
- Identity = the item's path in the IDE tree (owner).
- A move pairs a delete and an add only within one application; across applications it is a delete + a create.
- `build` builds every application / PLC project.
- TwinCAT paths gain the `<system project>/<PLC project>/` prefix; no migration (no users yet).
- TwinCAT paths MIRROR THE SOLUTION TREE, as CODESYS mirrors its device tree (owner, 2026-10-17: today we only see the inside of
  one PLC project, with its task beside the POUs): `<system project>/SYSTEM/Tasks/PlcTask.task`,
  `<system project>/PLC/<plc project>/POUs/MAIN.pou`. MOTION / I/O / SAFETY / C++ stay out (Volt edits none; CODESYS
  carries no hardware either) unless the owner wants read-only descriptors like `.device`.
