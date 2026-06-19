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
| 605 | `PLCDUTENUM` | `PlcDutEnum` | `enumeration` | both | ✅ | ✅ | ✅ | |
| 606 | `PLCDUTSTRUCT` | `PlcDutStruct` | `structure` | both | ✅ | ✅ | ✅ | |
| 607 | `PLCDUTUNION` | `PlcDutUnion` | `union` | both | ✅ | ✅ | ✅ | |
| 608 | `PLCACTION` | `PlcAction` | `action` | both | ✅ | ✅ | ✅ | body-only (no declaration) |
| 609 | `PLCMETHOD` | `PlcMethod` | `method` | both | ✅ | ✅ | ✅ | |
| 610 | `PLCITFMETH` | `PlcItfMeth` | `method` | both | ✅ | ✅ | ✅ | decl-only; vInfo = return type |
| 611 | `PLCPROP` | `PlcProp` | `property` | both | ✅ | ✅ | ✅ | |
| 612 | `PLCITFPROP` | `PlcItfProp` | `property` | both | ✅ | ✅ | ✅ | vInfo = data type |
| 613 | `PLCPROPGET` | `PlcPropGet` | `property_get` | both | ✅ | ✅ | ✅ | CODESYS maps its iface accessors here too |
| 614 | `PLCPROPSET` | `PlcPropSet` | `property_set` | both | ✅ | ✅ | ✅ | |
| 615 | `PLCGVL` | `PlcGvl` | `gvl` | both | ✅ | ✅ | ✅ | |
| 616 | `PLCTRANS` | `PlcTrans` | `transition` | both | ✅ | graphical | ⚠️ | SFC transition; read-only, never created. Unobserved live |
| 617 | `PLCLIBMAN` | `PlcLibMan` | `library_manager` | both | ✅ | opaque | ✅ | |
| 618 | `PLCITF` | `PlcItf` | `interface` | both | ✅ | ✅ | ✅ | accessors are bodiless stubs — never write text to them |
| 619 | `PLCVISOBJ` | `PlcVisObj` | `visualization` | both | ✅ | opaque | ✅ | |
| 620 | `PLCVISMAN` | `PlcVisMan` | `visualization_manager` | both | ✅ | opaque | ✅ | |
| 621 | `PLCTASK` | `PlcTask` | `task` | both | ✅ | opaque | ✅ | |
| 623 | `PLCDUTALIAS` | `PlcDutAlias` | `alias` | both | ✅ | ✅ | ✅ | |
| 625 | *(unconfirmed)* | `PlcTextList` | `text_list` | both | ✅ | opaque | ✅ | confirmed `text_list` on this build (was `PLCTMCDESCRIPTION` in the old enum; tmc → 653) |
| 628 | *(unconfirmed)* | `PlcImagePool` | `image_pool` | both | ✅ | opaque | ✅ | RE'd number |
| 629 | *(unconfirmed)* | `PlcParamList` | `parameter_list` | TC | ✅ | opaque | ✅ | was unmapped (→ null), now fixed. TC-only: CODESYS has no parameter-list object type (confirmed via docs + Hauzer) |
| 631 | *(unconfirmed)* | `PlcClassDiagram` | `class_diagram` | TC | ✅ | opaque | ✅ | RE'd number |
| 632 | *(unconfirmed)* | `PlcRecipeMan` | `recipe_manager` | both | ✅ | opaque | ✅ | |
| 633 | *(unconfirmed)* | `PlcRecipes` | `recipe_manager` | TC | ✅ | opaque | ⚠️ | container under recipe mgr; only appears once a recipe definition exists |
| 650 | `PLCPROGREF` *(published 622)* | `PlcProgRef` | `task_call_reference` | TC | ✅ | opaque | ✅ | renumbered 622→650; CODESYS folds into the task |
| 652 | `PLCEXTDATATYPECONT` *(published 624)* | `PlcExtDataTypeCont` | `external_types` | TC | ✅ | opaque | ✅ | renumbered 624→652 |
| 653 | `PLCTMCDESCRIPTION` *(published 625)* | `PlcTmcDescription` | `tmc_file` | TC | ✅ | opaque | ✅ | renumbered 625→653 |
| 654 | `PLCITFPROPGET` | `PlcItfPropGet` | `interface_property_get` | TC | ✅ | ✅ | ✅ | create vInfo = `"ST"`, write no text |
| 655 | `PLCITFPROPSET` | `PlcItfPropSet` | `interface_property_set` | TC | ✅ | ✅ | ✅ | create vInfo = `"ST"`, write no text |
| 657 | *(unconfirmed)* | `PlcLibRef` | `library` | both | ✅ | opaque | ✅ | individual lib ref (CODESYS: synthetic from LibManObject) |
| 0 | — | `PlcSystemRoot` | `system_root`* | TC | ✅ | — | — | system/solution root sentinel; *Map returns a string — verify if it ever reaches /refs |
| 690-693 | — | `Application`/`PlcLogic`/`Device`/`TaskConfig` | — | CDS | recurse | — | ✅ | CODESYS-only containers; recursed, never emitted |

## Work ahead

1. **Remaining ⚠️ kinds** — only two left to confirm live: `transition` 616 (add an SFC POU with a step+transition)
   and `PlcRecipes` 633 (add a recipe *definition* under a Recipe Manager). Everything else is ✅ live-confirmed
   (sweep 2026-06-19: 619/620/625/628/629/631/632 + 657).
2. **Fill the remaining unknown ranges** — 626, 627, 630, 634-649, 656, 658+ are still unmapped. Sweep a project
   with persistent GVLs, CNC/NC, EtherCAT-mapped items, etc. to discover any other kind volt drops to `null`.
4. **Decide on naming** — keep vendor-neutral C# constants (recommended; preserves CODESYS parity) with the
   official `TREEITEMTYPE` name as the documented cross-reference, vs. a deeper rename. This table is that
   cross-reference either way.
