## 1. Spike — DONE (2026-07-02, findings in design.md)

- [x] 1.1 Locate device instances: 106 `IDeviceObject` nodes live under the `Device` controller (not the
  Application) — reachable by name lookup, not the app-rooted `/debug` dump.
- [x] 1.2 Type reachability: exact IEC type only in `GetCompileContext(appGuid).GetAllSignaturesFlat()`,
  which needs a clean build — headless build fails (32 diags) → `GetCompileContext` null. Types NOT
  reliably reachable; and member access is uncheckable anyway → **names-only** decision.
- [x] 1.3 Descriptor reachability (build-free): `ScriptDeviceObject` facet (in Extender's DLR `Extensions`)
  → `GetReadable().DeviceInfo` (Name/Vendor/Description/OrderNumber) + `get_device_identification`
  (Type/Id/Version). Confirmed on Axis/Controller Sync Device/Kinematic_4dof.

## 2. Bridge (CODESYS) — DONE

- [x] 2.1 `ItemKind.PlcDevice = 695` in Core (wire `"device"`, ext `.device`, read-only) + `ITEM_KINDS.md`
  rows for 694/695.
- [x] 2.2 `DeviceDescriptor(node)` + `DeviceFacet(node)` in `CodesysObjectModel.cs` — Information-tab
  fields, plain `Key:` lines, empty omitted, no marker.
- [x] 2.3 `ReadManifest(item, "device")` → `DeviceDescriptor` in `CodesysDriver.Code.cs`.
- [x] 2.4 Walk = complete 1:1 mirror in `CodesysDriver.Tree.cs`: every device emits `.device`
  (descriptor-inside-folder for containers, controller included); every other container nests under its
  own name. `insideDevice` flag removed (emitting the controller made it unnecessary). `HasChildren` guard.

## 3. volt-git — DONE

- [x] 3.1 `.device` = read-only in `registry/extensions.ts`; `materializeItem` pass-through (no change).
- [x] 3.2 `harvest-lsp-corpus.ts` writes `.device` files.

## 4. LSP — DONE

- [x] 4.1 `device-catalog.ts` `loadDeviceInstances(root)` scans `.device` → lowercased filename stems.
- [x] 4.2 `Workspace.deviceInstances` + load at `initialize` (`dispatch.ts`) + thread through
  `diagnostics.ts`/`diagnostics-push.ts` → `check-unresolved-identifier.ts` skips known device names.
- [x] 4.3 `coverage-report.ts` loads device instances; `device-catalog.test.ts` unit test.

## 5. Corpus + verification — DONE

- [x] 5.1 Re-harvest pro2193 (106 `.device`, complete-mirror layout); `real-corpus.test.ts` ratchet
  95 → **55** (zero device stragglers).
- [x] 5.2 Full suite green: LSP 5266, C# bridge 191, volt-git 32, check-divergence clean.

## 6. Project-object completeness (non-source descriptors) — DONE

- [x] 6.1 Full skip audit: live skip-report walk over pro2193 (65 non-emitted nodes) + facet reflection per
  type. Inventory + decisions in design.md "Project-object completeness" (imported vs documented-skip).
- [x] 6.2 Kinds `PlcProjectInfo`=696 `.projectinfo`, `PlcTrace`=697 `.trace`, `PlcRecipe`=698 `.recipe`,
  `PlcSymbolConfig`=699 `.symbols` (all read-only) + `ITEM_KINDS.md` rows.
- [x] 6.3 Descriptors: `ProjectInfoDescriptor`/`TraceDescriptor`/`SymbolConfigDescriptor` share a
  `FacetDescriptor(node, facetName, fields…)` helper (device stays bespoke — two facets); `RecipeDescriptor`
  iterates `ScriptRecipeDefinitionObject.variables`. `ReadManifest` dispatch; registry read-only; harvest.
- [x] 6.4 Classify `IProjectInfoObject`/`ITraceObject`/`IRecipeDefinitionObject`/`ISymbolConfigObject` →
  their kinds (promoted from known-skip). Recurse the Recipe Manager (like the Library Manager) so recipe
  definitions materialize nested under it.
- [x] 6.5 `IWorkspaceObject` ("Project Settings") stays a deliberate known-skip — no readable content (only a
  `ScriptNoProjectInfoMarker`). `IUnknownObject` (`_Errors`, ×31) stays skipped — plugin-missing in the
  headless profile (environmental, not a code gap). Both documented.
- [x] 6.6 **Task descriptor** — `.task`/`PlcTask=621` already existed but emitted an empty `task\n` stub.
  `TaskDescriptor(node)` (bespoke, reads `ScriptTaskObject` + drills nested `watchdog` and the `pous` name
  list) → `ReadManifest(item, "task")`. Emits Type/Interval/Priority/Watchdog/Calls (empty omitted). Facet +
  property names confirmed live via a temporary `/debug` facet probe (since reverted); verified end-to-end on
  the fixture: `MainTask.task` body = `Type: Cyclic / Interval: t#20ms / Priority: 1 / Watchdog: off / Calls:
  PLC_PRG`. No new ItemKind/extension/tree/registry change (the kind already shipped read-only).

## 7. TwinCAT / Beckhoff — TODO (parity; see design.md "TwinCAT implementation")

- [ ] 7.1 Confirm how the TwinCAT automation interface enumerates the I/O device tree (EtherCAT master →
  boxes → terminals): names, hierarchy, and the vendor/product/revision identity per box.
- [ ] 7.2 `BeckhoffDriver.Tree.cs`: reach the I/O tree, classify its nodes onto `ItemKind.Device`, emit as
  `PlcDevice` with the SAME nesting rule (descriptor-inside-folder for containers; complete 1:1 mirror).
- [ ] 7.3 `BeckhoffDriver` `ReadManifest(item, "device")`: emit the SAME descriptor fields in the same
  order (Name/Vendor/Type/ID/Version/Order number/Description); omit fields with no TwinCAT equivalent
  (extractor already drops empties — wire stays shape-identical). No marker.
- [ ] 7.4 Decide + document (in `ARCHITECTURE.md`) where TwinCAT I/O devices (`TIID`) nest relative to the
  PLC project (`TIPC`) so ONE coherent tree is presented on the wire — the load-bearing CODESYS↔Beckhoff
  asymmetry.
- [ ] 7.5 Beckhoff e2e in `test/e2e/**`: fetch a fixture device tree, assert `.device` items + descriptor
  bytes match the CODESYS shape. (Downstream materialize/LSP/registry need NO change — already
  vendor-neutral.)
- [ ] 7.6 Until 7.1–7.5 land, Beckhoff emits no devices — verify the empty-set path keeps `/fetch`
  shape-identical (documented parity gap on `ItemKind.PlcDevice`).
- [ ] 7.7 TwinCAT non-source descriptor parity: map the TwinCAT analogs onto the same kinds/extensions —
  project metadata → `PlcProjectInfo`/`.projectinfo`, and (where TwinCAT has them) recipes → `.recipe`,
  scope/trace → `.trace`, symbol config → `.symbols`. Same fields, same extensions.
- [ ] 7.8 **Task descriptor parity**: Beckhoff already special-cases `.task` in `BeckhoffDriver.Code.cs`
  (emits `Name=`/`linked-task=` from the PLCopen XML) — enrich it to the SAME body fields as CODESYS
  (Type/Interval/Priority/Watchdog/Calls; TwinCAT's PlcTask exposes CycleTime/Priority). Until then the
  `.task` body differs by vendor — a documented parity gap (kind/extension already identical).
