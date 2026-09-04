# TwinCAT PLC item-kind coverage

The authoritative inventory of TwinCAT `TREEITEMTYPE` codes (PLC range) vs what the bridge implements.
Source of names: Beckhoff InfoSys *TE1000 Automation Interface → ITcSmTreeItem Item Types*. Source of
**numbers**: the live IDE via the read-only `GET /debug` sweep (authoritative per build — Beckhoff has
renumbered this enum across versions). Constants live in `Core/Workspace/ItemKind.cs` and are **vendor-neutral**
(CODESYS classifies its object model onto the *same* constants via `CodesysTypeMap`), so the C# names stay
clear/neutral and the official `PLCxxx` name is carried here as the cross-reference — not as a rename.

Legend — **Read**: classified by `ItemKind.Map` → emits a wire kind. **Create**: writable via push
(`opaque` = read-only passthrough, never created by the bridge; `graphical` = read-only graphical view).
**CDS**: vendor reuse — `both` = TC-native AND produced by `CodesysTypeMap`; `TC` = TwinCAT-only (no CODESYS
arm); `CDS` = CODESYS-only. **Live**: ✅ seen/exercised on a live TwinCAT; ⚠️ mapped but not yet observed.

| Code | Official `TREEITEMTYPE` | C# constant | wire kind | CDS | Read | Create | Live | Notes |
|---|---|---|---|:--:|:--:|:--:|:--:|---|
| 600 | `PLCAPP` | — (root) | — | both | recurse | — | ✅ | PLC project root container; recursed, never emitted |
| 601 | `PLCFOLDER` | `PlcFolder` | `folder` | both | ✅ | ✅ | ✅ | |
| 602 | `PLCPOUPROG` | `PlcPouProg` | `program` | both | ✅ | ✅ | ✅ | |
| 603 | `PLCPOUFUNC` | `PlcPouFunc` | `function` | both | ✅ | ✅ | ✅ | create needs `Type.Missing` vInfo (no body lang) |
| 604 | `PLCPOUFB` | `PlcPouFb` | `function_block` | both | ✅ | ✅ | ✅ | |
| 605–607 | `PLCDUTENUM/STRUCT/UNION` | `PlcDutEnum`/`PlcDutStruct`/`PlcDutUnion` | `dut` | `.dut` | ✅ | ✅ | ✅ | the DUT SUBTYPE codes TwinCAT actually stores — a DUT authored in the IDE, or re-created from its item archive, carries one of these; 623 is only the code `CreateChild` accepts. All four map onto the one wire kind `dut`; struct/enum/union/alias lives only in the declaration text. This row said "not used by Volt" and they were therefore unmapped, so every such item was silently dropped from `refs`/`fetch` — measured on `E_PackML_Mode` in the committed `TwinCAT Project14` fixture |
| 608 | `PLCACTION` | `PlcAction` | `action` | both | ✅ | ✅ | ✅ | body-only (no declaration) |
| 609 | `PLCMETHOD` | `PlcMethod` | `method` | both | ✅ | ✅ | ✅ | |
| 610 | `PLCITFMETH` | `PlcItfMeth` | `method` | both | ✅ | ✅ | ✅ | decl-only; vInfo = return type |
| 611 | `PLCPROP` | `PlcProp` | `property` | both | ✅ | ✅ | ✅ | |
| 612 | `PLCITFPROP` | `PlcItfProp` | `property` | both | ✅ | ✅ | ✅ | vInfo = data type |
| 613 | `PLCPROPGET` | `PlcPropGet` | `property_get` | both | ✅ | ✅ | ✅ | CODESYS maps its iface accessors here too |
| 614 | `PLCPROPSET` | `PlcPropSet` | `property_set` | both | ✅ | ✅ | ✅ | |
| 615 | `PLCGVL` | `PlcGvl` | `gvl` | both | ✅ | ✅ | ✅ | |
| 616 | `PLCTRANS` | `PlcTrans` | `transition` | both | ✅ | graphical | ✅ | transition; read-only, never created. Live-confirmed under POU_1 |
| 617 | `PLCLIBMAN` | `PlcLibMan` | `library_manager` | both | ✅ | opaque | ✅ | |
| 618 | `PLCITF` | `PlcItf` | `interface` | both | ✅ | ✅ | ✅ | accessors are bodiless stubs — never write text to them |
| 619 | `PLCVISOBJ` | `PlcVisObj` | `visualization` | both | ✅ | opaque | ✅ | |
| 620 | `PLCVISMAN` | `PlcVisMan` | `visualization_manager` | both | ✅ | opaque | ✅ | |
| 621 | `PLCTASK` | `PlcTask` | `task` | both | ✅ | read-only descriptor | ✅ | CODESYS `.task` body = scheduling descriptor (Type/Interval/Priority/Watchdog/called-POUs) via `ScriptTaskObject`; TC still emits `Name=/linked-task=` (parity gap) |
| 623 | `PLCDUTALIAS` | `PlcDut` | `dut` | both | ✅ | ✅ | ✅ | the ONE DUT code. TwinCAT reports EVERY DUT (struct/enum/union/alias) as 623 and creates every DUT with it; CODESYS classifies every `IDUTObject` here and creates with one `create_dut` call. One wire kind `dut`; struct/enum/union/alias lives only in the declaration text — the IDE derives the subtype from it on both read and create. Volt never picks a subkind. |
| 625 | *(unconfirmed)* | `PlcTextList` | `text_list` | both | ✅ | opaque | ✅ | confirmed `text_list` on this build (was `PLCTMCDESCRIPTION` in the old enum; tmc → 653) |
| 628 | *(unconfirmed)* | `PlcImagePool` | `image_pool` | both | ✅ | opaque | ✅ | RE'd number |
| 629 | *(unconfirmed)* | `PlcParamList` | `parameter_list` | TC | ✅ | opaque | ✅ | was unmapped (→ null), now fixed. TC-only: CODESYS has no parameter-list object type (confirmed via docs + Hauzer) |
| 631 | *(unconfirmed)* | `PlcClassDiagram` | `class_diagram` | TC | ✅ | opaque | ✅ | RE'd number |
| 632 | *(unconfirmed)* | `PlcRecipeMan` | `recipe_manager` | both | ✅ | opaque | ✅ | |
| 633 | *(unconfirmed)* | `PlcRecipes` | `recipe_manager` | TC | ✅ | opaque | ✅ | recipes container under the recipe manager |
| 650 | `PLCPROGREF` *(published 622)* | `PlcProgRef` | `task_call_reference` | TC | ✅ | opaque | ✅ | renumbered 622→650; CODESYS folds into the task |
| 652 | `PLCEXTDATATYPECONT` *(published 624)* | `PlcExtDataTypeCont` | `external_types` | TC | ✅ | opaque | ✅ | renumbered 624→652 |
| 653 | `PLCTMCDESCRIPTION` *(published 625)* | `PlcTmcDescription` | `tmc_file` | TC | ✅ | opaque | ✅ | renumbered 625→653 |
| 654 | `PLCITFPROPGET` | `PlcItfPropGet` | `interface_property_get` | TC | ✅ | ✅ | ✅ | create vInfo = `"ST"`, write no text |
| 655 | `PLCITFPROPSET` | `PlcItfPropSet` | `interface_property_set` | TC | ✅ | ✅ | ✅ | create vInfo = `"ST"`, write no text |
| 657 | *(unconfirmed)* | `PlcLibRef` | `library` | both | ✅ | opaque | ✅ | individual lib ref (CODESYS: synthetic from LibManObject) |
| 0 | — | `PlcSystemRoot` | — | TC | — | — | — | solution/system root — *above* the PLC project, never reached by the walk → `Map` returns null (not emitted). Const kept only so read-failures use -2, not 0 |
| 690-693 | — | `Application`/`PlcLogic`/`Device`/`TaskConfig` | — | CDS | recurse | — | ✅ | CODESYS-only containers; recursed, never emitted |
| 694 | — | `GenericContainer` | — | CDS | recurse | — | ✅ | bare grouping node (SoftMotion "Kinematics", the drive "Functions" group); recursed — inside the device tree it nests as a folder to mirror the hierarchy |
| 695 | — | `PlcDevice` | `device` | CDS | ✅ | opaque | ✅ | EMITTED device-tree instance (read-only `.device` descriptor: Name/Vendor/Type/ID/Version/…). Distinct from 692 (the recurse-only controller/spine). CODESYS-first; a TC bridge would map its I/O tree here |
| 696 | — | `PlcProjectInfo` | `project_info` | CDS | ✅ | opaque | ✅ | the project's "Project Information" metadata (read-only `.projectinfo`: Title/Version/Company/Author/…). IProjectInfoObject. Project SETTINGS (IWorkspaceObject) is row 700. CODESYS-first |
| 697 | — | `PlcTrace` | `trace` | CDS | ✅ | opaque | ✅ | a trace/recording config (read-only `.trace`: task/trigger/resolution/samples). ITraceObject. CODESYS-first |
| 698 | — | `PlcRecipe` | `recipe` | CDS | ✅ | opaque | ✅ | a recipe definition's variable list (read-only `.recipe`: `var : type (column)`). IRecipeDefinitionObject, nested under the recurse-emitted Recipe Manager. CODESYS-first |
| 699 | — | `PlcSymbolConfig` | `symbol_config` | CDS | ✅ | opaque | ✅ | the symbol-configuration flags (read-only `.symbols`: OPC UA / direct-I/O / filter). ISymbolConfigObject. CODESYS-first |
| 700 | — | `PlcProjectSettings` | `project_settings` | CDS | ✅ | opaque | ✅ | the project's COMPILER settings (read-only `.projectsettings`: disabled warnings / warnings-as-errors / compile options). IWorkspaceObject. **Was a known-skip** — correctly, while the only way in was the scripting api, which exposes nothing readable for it; the object model does, via `APEnvironment.LMServiceProvider → ConfigurationService`. Bind a version-INDEPENDENT APEnvironment (`_3S.CoDeSys.Engine`), never `Compiler352x0`. Ids arrive as bare ints (371 → C0371) and the collection is null, not empty, when unset. The LSP consumes it so a warning the project switched OFF is not reported — which is what pro2193's C0371 VAR_IN_OUT conformance failure always was. CODESYS-first |

## Complete coverage map — what could exist vs. what we map

### TwinCAT — `TREEITEMTYPE` PLC range (600–657), contiguous

`✅` mapped+live · `⚠️` mapped, not yet seen live · `❌` NOT mapped (gap — would skip to `null`).
Numbers are the LIVE build's values; the published-enum name is shown where it differs (Beckhoff renumbered).

| Code | Published name | wire kind | St. | Note |
|---|---|---|:--:|---|
| 600 | `PLCAPP` | — | ✅ | PLC project root (recurse) |
| 601–615 | `PLCFOLDER`…`PLCGVL` | folder/program/function/function_block/dut (623 create-only; 605–607 are the stored subtypes)/action/method/property(+get/set)/gvl | ✅ | the source + inlined kinds |
| 616 | `PLCTRANS` | transition | ✅ | live-confirmed (transition under POU_1) |
| 617–621 | `PLCLIBMAN`…`PLCTASK` | library_manager/interface/visualization/visualization_manager/task | ✅ | |
| 622 | `PLCPROGREF` | — | ❌ | published code; **live build uses 650** instead |
| 623 | `PLCDUTALIAS` | dut | ✅ | every DUT (struct/enum/union/alias) reports as 623 → one wire kind `dut` |
| 624 | `PLCEXTDATATYPECONT` | — | ❌ | published; **live uses 652** |
| 625 | *(pub. `PLCTMCDESCRIPTION`)* | text_list | ✅ | live build repurposed 625 for text_list |
| **626** | — | — | ❌ | not in published enum, never seen live — **unknown** |
| **627** | — | — | ❌ | **unknown** |
| 628 | — | image_pool | ✅ | live (post-published addition) |
| 629 | — | parameter_list | ✅ | live; TC-only |
| **630** | — | — | ❌ | **unknown** |
| 631 | — | class_diagram | ✅ | live |
| 632 | — | recipe_manager | ✅ | live |
| 633 | — | recipe_manager | ✅ | live (recipes container under recipe manager) |
| **634–649** | — | — | ❌ | 16-code gap, never seen — **unknown** (persistent vars? param mgr? cam? CNC?) |
| 650 | `PLCPROGREF` | task_call_reference | ✅ | live (renumbered from 622) |
| **651** | — | — | ❌ | **unknown** |
| 652 | `PLCEXTDATATYPECONT` | external_types | ✅ | live (from 624) |
| 653 | `PLCTMCDESCRIPTION` | tmc_file | ✅ | live (from 625) |
| 654–655 | `PLCITFPROPGET/SET` | interface_property_get/set | ✅ | |
| **656** | — | — | ❌ | **unknown** |
| 657 | — | library | ✅ | live (post-published addition) |
| **658+** | — | — | ❌ | never seen — **unknown** |

**TC "might be missing": 626, 627, 630, 634–649, 651, 656, 658+** — discover by sweeping a project with
persistent GVLs, a parameter manager, CNC/NC, image/cam objects, etc. (a `/debug` sweep prints the raw number).

### CODESYS — by `IObject` interface (CodesysTypeMap)

CODESYS has no numbers; it classifies by interface. `→` = recognized; the rest fall through to `Unknown`.

- **Recognized → emitted:** IPOUObject(→fb/func/prog), IDUTObject(→`dut`, one kind — subkind derived on create), IGVLObject/INVLObject→gvl,
  IInterfaceObject→interface, IInterfaceMethodObject→method, IPOUMethodObject→method, IPropertyObject/IInterfacePropertyObject→property,
  IPropertyAccessorObject/IInterfacePropertyAccessorObject→property_get/set, IActionObject→action, ITransitionObject→transition,
  ILibManObject→library_manager (+ synthetic library refs), IVisualManagerObject→visualization_manager, IVisualObject→visualization,
  IRecipeManObject→recipe_manager, IImagePoolObject→image_pool, IGlobalTextListObject/ITextListObject→text_list, ITaskObject→task.
- **Recognized → recurse-only container:** IApplicationObject, IPlcLogicObject, IDeviceObject, ITaskConfigObject.
- **Recognized → skip (never emit):** ITransientObject, IHiddenObject, IUnknownObject (CODESYS's own "no plugin loaded" marker).
- **Falls through to Unknown (intentional but NOT explicit):** ITraceObject, ISymbolConfigObject, IWorkspaceObject, IRecipeDefinitionObject.

**CODESYS "might be missing": any IObject interface not above** — currently indistinguishable from the intentional
skips. This is exactly why the **explicit-skip + log-the-unknown** change (above) is the professional fix: it would
turn "silently Unknown" into a visible "unrecognized CODESYS type: {interfaces}" warning.

## Work ahead

1. **All mapped PLC kinds are now live-confirmed** (2026-06-19 sweeps): every code 600–657 we map has been
   observed live, including `transition` 616 (under POU_1) and `PlcRecipes` 633. No ⚠️ rows remain.
2. **Fill the remaining unknown ranges** — 626, 627, 630, 634-649, 656, 658+ are still unmapped. Sweep a project
   with persistent GVLs, CNC/NC, EtherCAT-mapped items, etc. to discover any other kind volt drops to `null`.
3. **Surface unknowns instead of silently skipping** — make `CodesysTypeMap`'s known-skip set explicit
   (ITraceObject/ISymbolConfigObject/IWorkspaceObject/IRecipeDefinitionObject) and log a warning for any other
   unrecognized object; likewise log an unmapped TwinCAT PLC-range code during the walk. Never throw mid-walk
   (a single trace/symbol object would crash `/refs`). This is the professional version of "know what we're missing".
