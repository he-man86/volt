# Design — expose device-tree instances

## The problem, precisely

CODESYS device-tree nodes are implicit IEC globals. In the resolver, a **bare** reference (`MagazineAxes`
passed as an argument, `grp := MagazineAxes`) is what flags — member access (`YDrive.lrActPosition`)
already falls through because the qualifier resolves nowhere. So the LSP needs exactly one thing per
device: its **name** as a known global. Not its type, not its members.

## Why names-only, not types (the spike result)

- `get_device_identification` gives the **hardware** id (`type=33601`, `Id='1028 0100'`, `Version`), not
  the IEC ST type. The connector `.interface` gives only a category (`Axis`/`AxesGroup`/`Drive`).
- The real ST type lives in the app compiled symbol table:
  `SystemInstances.LanguageModelMgr` → `GetCompileContext(appGuid)` → `GetAllSignaturesFlat()`. That needs
  a **successful build**, and the headless bridge can't build pro2193 (32 diagnostics — missing
  device-support packages the live IDE has), so `GetCompileContext` returns null.
- Member access into a device's internal type is not ours to validate anyway (those members are private,
  e.g. `lrActPosition`). So the type buys the LSP nothing and would couple the feature to a build that
  fails in our own harness. Decision: **descriptor metadata (names + Information-tab fields), no types.**
  A future "device member resolution" would ride the same `GetAllSignaturesFlat` path as library
  signatures Phase 2 — see `library-signature-index`.

## CODESYS implementation (DONE)

### 1. New item kind — `ItemKind.PlcDevice = 695`
`Volt.Bridge.Core/Workspace/ItemKind.cs`. Wire kind `"device"`, extension `.device`, read-only (opaque
passthrough). Distinct from `Device`=692 (the recurse-only container code the classifier still returns for
every `IDeviceObject`). The classifier is unchanged; the WALK decides which `Device` nodes emit as
`PlcDevice`.

### 2. The walk — a complete 1:1 mirror
`Volt.Bridge.Codesys/Driver/CodesysDriver.Tree.cs`, `Walk(node, folderPath, items)`. Two rules only:
- **A device** (`code == ItemKind.Device`, i.e. any `IDeviceObject`): emit a `.device` item + mirror its
  subtree. A device WITH children gets a folder named after it and keeps its descriptor INSIDE that folder
  (`Coupler_I_O_moduls/Coupler_I_O_moduls.device`); a childless leaf is a plain file at the parent level
  (`HasChildren` guarded helper). **Every** device emits — including the controller
  (`Device/Device.device` = the PLC's own info). Emitting the controller like any other device is what let
  us delete the earlier `insideDevice` flag (it existed only to suppress the controller) and makes
  multi-controller projects work.
- **Any other container** (user folder OR `PlcLogic`/`Application`/`TaskConfig`/`GenericContainer`): nest
  its children under its own name. This is the single line that turned the flattened layout into the full
  mirror: `Device → Plc Logic → Application → <usercode>`, hardware devices as siblings under `Device/`.
  The SoftMotion `Kinematics` (holds `MagazineAxes`) and the device-tree `Functions` (holds the drives)
  are `GenericContainer`s (694) and nest as folders too.

### 3. Descriptor extraction — build-free reflection
`Volt.Bridge.Codesys/Ide/CodesysObjectModel.cs`, `DeviceDescriptor(node)`:
- `DeviceFacet(node)`: the device API is NOT on the base `ScriptObject` — it's a `ScriptDeviceObject` in
  the Extender's DLR `Extensions` list. Navigate `Unwrap(node).Extender.Extensions`, find the facet whose
  type name is `ScriptDeviceObject`.
- `info = GetReadable().DeviceInfo` (`DeviceRepository.DeviceInfo` or `DefaultDeviceInfo`) →
  `Name`/`Vendor`/`Description`/`OrderNumber`.
- `devId = get_device_identification()` → `Type`/`Id`/`Version` (defensive member-name fallback for
  reflection robustness).
- Body = plain `Key:` padded lines, empty fields omitted. **No marker** — the `.device` extension
  identifies the kind; a `(* @volt-device *)` header was tried and removed as valueless.

`ReadManifest(item, kind)` (`CodesysDriver.Code.cs`) dispatches `kind == "device"` to `DeviceDescriptor`;
`FetchService`/`Materializer` are unchanged (non-source kinds already flow through `ReadManifest`).

### 4. LSP resolution
`volt-lsp-iec`: `device-catalog.ts` `loadDeviceInstances(root)` scans `.device` files and returns the
lowercased filename stems. `Workspace.deviceInstances` (parallel to `libraryNamespaces`, loaded at
`initialize` in `dispatch.ts`), threaded through `computeSemanticDiagnostics` to
`check-unresolved-identifier.ts`, which skips a bare identifier that is a known device name. A separate set
from library namespaces on purpose: different source (`.device` vs `.library`), and if devices ever gain
real types they migrate to real symbols while namespaces stay skips.

### 5. Materialize + registry
`volt-git/src/registry/extensions.ts`: `.device` = read-only (`defaultAccess: "r"`) — never pushed.
`materializeItem` is generic pass-through (the registry entry is all it needed). Corpus harvest
(`harvest-lsp-corpus.ts`) writes `.device` alongside KIND + `.library`.

### Result
pro2193: 106 `.device` files, diagnostics **95 → 55** (all ~40 device false-positives cleared, zero
device stragglers). Remaining 55 = bare library ELEMENTS (Phase 2) + project-local gaps.

## Project-object completeness — non-source descriptors (DONE)

Beyond the device tree, we audited EVERY node the mirror was dropping (a live skip-report walk over pro2193:
65 non-emitted nodes) and reflected into each type's scripting facet to decide, per type, whether it exposes
readable content worth mirroring. Types with a clean facet were **promoted from known-skip to emitted
read-only descriptors** (`ItemKind` 695-699; each dispatched by `ReadManifest(kind)` → a `*Descriptor`
method; the single-facet ones share a `FacetDescriptor(node, facetName, fields…)` helper, device stays
bespoke as it reads two facets):

| Object | Interface | Kind / ext | What the descriptor holds | Source |
|---|---|---|---|---|
| Device instance | `IDeviceObject` | 695 `.device` | Name/Vendor/Type/ID/Version/Order/Description | `DeviceInfo` + `get_device_identification` |
| Project Information | `IProjectInfoObject` | 696 `.projectinfo` | Title/Version/Company/Author/Namespace/Released/Description | `ScriptProjectInfo` |
| Trace | `ITraceObject` | 697 `.trace` | Task/Record/Resolution/Samples/Trigger config (17 in pro2193) | `ScriptTraceObject` |
| Recipe definition | `IRecipeDefinitionObject` | 698 `.recipe` | Full variable list: `var : type (column)` (3, under the Recipe Mgr) | `ScriptRecipeDefinitionObject.variables` |
| Symbol config | `ISymbolConfigObject` | 699 `.symbols` | Access flags: OPC UA / direct-I/O / attribute filter | `ScriptSymbolConfigObject` |

The Recipe Manager (already emitted) is now **recursed** (like the Library Manager) so its recipe-definition
children materialize nested under it. Trace/Symbols were already reached by the walk (under the Application);
only their classification changed. None are referenced by ST, so no LSP change — they ride along as context.

### Deliberate skips — what we do NOT mirror, and why (the frontier)

| Skipped | Count (pro2193) | Reason |
|---|---|---|
| `_Errors` etc. (`IUnknownObject`) | 31 | **Environmental, not a code gap.** CODESYS itself returns only `IUnknownObject` because the providing plugin (a Lenze error-list type) isn't in our headless profile — `has_textual_declaration=False`, no facet. On the engineer's full IDE they'd classify; the headless bridge can't. Not causing any LSP diagnostic. |
| `Project Settings` (`IWorkspaceObject`) | 1 | Scripting API exposes NO readable content (only a `ScriptNoProjectInfoMarker`). Nothing to mirror as text. |
| Task-call ref copies (`ITransientObject`) | 6 | Runtime duplicates of real POUs — same name, not source. |
| Embedded logo PNGs, `__VisualizationStyle` (`IHiddenObject`) | 4 | Binary assets / transient internal state — not text-mirrorable. |

Every node is now either mirrored or a **documented** skip — no Unknown residue and no `WarnUnrecognized`
noise. The only real remaining gap is the `IUnknownObject` bucket, which is a *plugin/environment* limitation,
not a classifier decision. (TwinCAT parity: these project objects have TwinCAT analogs; a Beckhoff bridge maps
them onto the same 696-699 kinds. CODESYS-first, like devices.)

## TwinCAT implementation (TODO — the parity plan)

The parity boundary is the **wire**: Beckhoff must produce the same `.device` items (name, folder path,
descriptor body) so both vendors serve byte-identical responses for the same project. Everything
downstream — `Materializer`, `FetchService`, the `.device` registry, the LSP `device-catalog`, the corpus
harness — is already vendor-neutral and needs **no change**. Only the Beckhoff driver's walk +
descriptor extraction are new. `ItemKind.PlcDevice` already lives in `Core` (shared).

1. **Walk the TwinCAT I/O tree.** TwinCAT projects have an I/O device tree (EtherCAT master → boxes →
   terminals) under the `TIID`/System-Manager side, distinct from the PLC project (`TIPC`). The Beckhoff
   driver (`BeckhoffDriver.Tree.cs`) currently walks the PLC project; it must additionally reach the I/O
   tree and classify its nodes onto `ItemKind.Device`, then emit them as `PlcDevice` with the SAME
   folder-nesting rule (device-with-children → descriptor inside its folder; complete 1:1 mirror). Confirm
   how the automation interface (TcSysManager / the `TcSmItem` COM tree, or the `TcXaeShell` automation)
   enumerates I/O boxes and their names — the TwinCAT analog of CODESYS's `IDeviceObject` subtree.
2. **Descriptor parity.** Emit the same fields in the same order via `ReadManifest(item, "device")`:
   `Name/Vendor/Type/ID/Version/Order number/Description`, plain `Key:` lines, empty omitted, no marker.
   Map from the TwinCAT box's identity — the EtherCAT vendor/product/revision IDs and the box name/type
   (`ITcSmTreeItem` XML `<ItemName>`/`<ItemSubType>`, or the ESI/device-description fields). Some CODESYS
   fields may have no TwinCAT equivalent — omit them (the extractor already drops empty fields), don't
   invent placeholders. The wire stays shape-identical because empty fields simply don't appear.
3. **Name = identity.** The `.device` filename is the referenceable instance name. Ensure the TwinCAT box
   instance name matches what PLC source references (TwinCAT exposes I/O via linked symbols / `AT %I*`
   mappings and instance names) — the LSP resolves purely on the filename stem, so the name must be the
   one used in ST.
4. **No push.** `.device` is read-only; the existing registry gate means Beckhoff never receives a device
   write. No push-path work.
5. **Test parity.** Add a Beckhoff e2e (`test/e2e/**`) that fetches a fixture project's device tree and
   asserts the `.device` items + descriptor bytes match the CODESYS shape. Reuse the CODESYS
   `real-corpus`-style resolution check if a TwinCAT corpus is harvested.

**Load-bearing asymmetry to respect:** CODESYS's device tree and PLC application share one object tree
(the walk mirrors it directly); TwinCAT splits System-Manager I/O (`TIID`) from the PLC project (`TIPC`).
The mirror must still present ONE tree on the wire — decide where the TwinCAT I/O devices nest relative to
the PLC project so the materialized layout stays coherent (likely: the I/O devices under the same
top-level `Device`/target root the PLC project already maps under). Document the choice in
`packages/volt-bridge/ARCHITECTURE.md` alongside the other CODESYS↔Beckhoff asymmetries.

## Alternatives considered / rejected

- **Types via the compiled model** — rejected: needs a build that fails headless; types buy the LSP
  nothing (members uncheckable). Deferred to a future member-resolution change on the library-signature
  path.
- **Per-vendor extension from the device Name (`.axis`, …)** — rejected: `"Controller Sync Device"` isn't
  a valid slug and it needs per-vendor knowledge (the exact "unknown component" case). One general
  `.device` extension + the standard descriptor inside is vendor-agnostic.
- **Folders-only + a name manifest** — rejected: empty folders don't persist in git and a side manifest is
  a catalog we didn't want; one `.device` file per node is the natural, diffable artifact.
- **`(* @volt-device *)` marker** — tried, removed: no added value (extension + fields self-identify).
