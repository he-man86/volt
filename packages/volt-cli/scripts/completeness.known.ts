/**
 * THE COMPLETENESS ORACLE'S EXPECTED FAILURES (openspec `bridge-one-to-one` design §2.1):
 * `<vendor>:<class>.<member> — <kind>` → the SUBJECTS (`<project>/<wire name>`) that fail it and its first finding.
 * The KIND is what is wrong with the member (value-free), so a known failure hides no other failure of the same member,
 * and its subjects name who fails it, so it hides no other subject's. A listed subject the run ran that no longer
 * fails FAILS the run — remove it; a failure not listed here fails it too. An `--only` run judges and rewrites only
 * the subjects it ran. Step 3 removes the entries its tasks close; task 4.2 requires this list
 * empty except entries whose reason is a named refusal or a niche. Written by `completeness.ts --write-known` and
 * then reviewed — never edited to make a run pass.
 */
import type { Known } from "./completeness"

export const KNOWN: Known = {
  "codesys:ActionObject.ActionObject.Implementation.TextDocument.Text — a trailing newline folded by the create": {
    subjects: ["Pro2193/IQ_Handling.pou"],
    why: "differs after the create (Pro2193/IQ_Handling.pou/G1_mapping Implementation.TextDocument.Text): at character 14948 of 14949 -> 14948: \"co - Cavity reset\\n);\\n\" -> \"co - Cavity reset\\n);\"",
  },
  "codesys:ActionObject.ActionObject.Implementation.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/IQ_Handling.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:DUTObject.DUTObject.Interface.TextDocument.Text — a trailing newline folded by the create": {
    subjects: ["Pro2193/BFU_InputsType.dut"],
    why: "differs after the create (Pro2193/BFU_InputsType.dut Interface.TextDocument.Text): at character 401 of 402 -> 401: \"\\nEND_STRUCT\\nEND_TYPE\\n\" -> \"\\nEND_STRUCT\\nEND_TYPE\"",
  },
  "codesys:DUTObject.DUTObject.Interface.TextDocument.Text — a trailing newline folded by the update": {
    subjects: ["Pro2193/BFU_InputsType.dut"],
    why: "differs after the update (Pro2193/BFU_InputsType.dut Interface.TextDocument.Text): at character 401 of 402 -> 401: \"\\nEND_STRUCT\\nEND_TYPE\\n\" -> \"\\nEND_STRUCT\\nEND_TYPE\"",
  },
  "codesys:DUTObject.DUTObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/BFU_InputsType.dut"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:GVLObject.GVLObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/GVL_Errorlists.gvl"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:GVLObject.GVLObject.meta.Properties[] — changed by the create": {
    subjects: ["Pro2193/GVL_Errorlists.gvl"],
    why: "differs after the create (Pro2193/GVL_Errorlists.gvl meta.Properties[]): [\"LanguageModelManager.BuildProperty\"] -> []",
  },
  "codesys:GVLObject.GVLObject.meta.Properties[BuildProperty] — lost by the create": {
    subjects: ["Pro2193/GVL_Errorlists.gvl"],
    why: "differs after the create (Pro2193/GVL_Errorlists.gvl meta.Properties[BuildProperty]): \"<LanguageModelManager.BuildProperty>\" -> null",
  },
  "codesys:GVLObject.GVLObject.meta.Properties[BuildProperty].CompilerDefines — lost by the create": {
    subjects: ["Pro2193/GVL_Errorlists.gvl"],
    why: "differs after the create (Pro2193/GVL_Errorlists.gvl meta.Properties[BuildProperty].CompilerDefines): \"\" -> null",
  },
  "codesys:GVLObject.GVLObject.meta.Properties[BuildProperty].EnableSystemCall — lost by the create": {
    subjects: ["Pro2193/GVL_Errorlists.gvl"],
    why: "differs after the create (Pro2193/GVL_Errorlists.gvl meta.Properties[BuildProperty].EnableSystemCall): false -> null",
  },
  "codesys:GVLObject.GVLObject.meta.Properties[BuildProperty].ExcludeFromBuild — lost by the create": {
    subjects: ["Pro2193/GVL_Errorlists.gvl"],
    why: "differs after the create (Pro2193/GVL_Errorlists.gvl meta.Properties[BuildProperty].ExcludeFromBuild): false -> null",
  },
  "codesys:GVLObject.GVLObject.meta.Properties[BuildProperty].External — lost by the create": {
    subjects: ["Pro2193/GVL_Errorlists.gvl"],
    why: "differs after the create (Pro2193/GVL_Errorlists.gvl meta.Properties[BuildProperty].External): false -> null",
  },
  "codesys:GVLObject.GVLObject.meta.Properties[BuildProperty].LinkAlways — lost by the create": {
    subjects: ["Pro2193/GVL_Errorlists.gvl"],
    why: "differs after the create (Pro2193/GVL_Errorlists.gvl meta.Properties[BuildProperty].LinkAlways): true -> null",
  },
  "codesys:GVLObject.GVLObject.meta.Properties[BuildProperty].MemoryReserveForOnlineChange — lost by the create": {
    subjects: ["Pro2193/GVL_Errorlists.gvl"],
    why: "differs after the create (Pro2193/GVL_Errorlists.gvl meta.Properties[BuildProperty].MemoryReserveForOnlineChange): 0 -> null",
  },
  "codesys:GVLObject.GVLObject.meta.Properties[BuildProperty].Undefines — lost by the create": {
    subjects: ["Pro2193/GVL_Errorlists.gvl"],
    why: "differs after the create (Pro2193/GVL_Errorlists.gvl meta.Properties[BuildProperty].Undefines): \"<System.String[]>\" -> null",
  },
  "codesys:GVLObject.GVLObject.meta.Properties[BuildProperty].Undefines#count — lost by the create": {
    subjects: ["Pro2193/GVL_Errorlists.gvl"],
    why: "differs after the create (Pro2193/GVL_Errorlists.gvl meta.Properties[BuildProperty].Undefines#count): 0 -> null",
  },
  "codesys:GVLObject.GVLObject.meta.Properties#count — changed by the create": {
    subjects: ["Pro2193/GVL_Errorlists.gvl"],
    why: "differs after the create (Pro2193/GVL_Errorlists.gvl meta.Properties#count): 1 -> 0",
  },
  "codesys:GVLObject.VarPersistentObject.$class — changed by the create": {
    subjects: ["Pro2193/PersistentVars.gvl"],
    why: "differs after the create (Pro2193/PersistentVars.gvl $class): at character 10 of 29 -> 19: \"GVLObject.VarPersistentObject\" -> \"GVLObject.GVLObject\"",
  },
  "codesys:GVLObject.VarPersistentObject.Interface.TextDocument.Text — a trailing newline folded by the create": {
    subjects: ["Pro2193/PersistentVars.gvl"],
    why: "differs after the create (Pro2193/PersistentVars.gvl Interface.TextDocument.Text): at character 9381 of 9382 -> 9381: \"lt_DataType;\\nEND_VAR\\n\" -> \"lt_DataType;\\nEND_VAR\"",
  },
  "codesys:GVLObject.VarPersistentObject.Interface.TextDocument.Text — a trailing newline folded by the update": {
    subjects: ["Pro2193/PersistentVars.gvl"],
    why: "differs after the update (Pro2193/PersistentVars.gvl Interface.TextDocument.Text): at character 9381 of 9382 -> 9381: \"lt_DataType;\\nEND_VAR\\n\" -> \"lt_DataType;\\nEND_VAR\"",
  },
  "codesys:GVLObject.VarPersistentObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/PersistentVars.gvl"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:GVLObject.VarPersistentObject.meta.TypeGuid — changed by the create": {
    subjects: ["Pro2193/PersistentVars.gvl"],
    why: "differs after the create (Pro2193/PersistentVars.gvl meta.TypeGuid): {\"$guid\":\"261bd6e6-249c-4232-bb6f-84c2fbeef430\"} -> {\"$guid\":\"ffbfa93a-b94d-45fc-a329-229860183b1d\"}",
  },
  "codesys:InterfaceObject.InterfaceObject.Interface.TextDocument.Text — a trailing newline folded by the create": {
    subjects: ["Pro2193/IBoxCenterUnit_WithPneumatic_Commands.itf"],
    why: "differs after the create (Pro2193/IBoxCenterUnit_WithPneumatic_Commands.itf Interface.TextDocument.Text): at character 104 of 105 -> 104: \"STEM.IQueryInterface\\n\" -> \"STEM.IQueryInterface\"",
  },
  "codesys:InterfaceObject.InterfaceObject.Interface.TextDocument.Text — a trailing newline folded by the update": {
    subjects: ["Pro2193/IBoxCenterUnit_WithPneumatic_Commands.itf"],
    why: "differs after the update (Pro2193/IBoxCenterUnit_WithPneumatic_Commands.itf Interface.TextDocument.Text): at character 104 of 105 -> 104: \"STEM.IQueryInterface\\n\" -> \"STEM.IQueryInterface\"",
  },
  "codesys:InterfaceObject.InterfaceObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/IBoxCenterUnit_WithPneumatic_Commands.itf"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:MethodObject.AbstractPOUMethodObject.$class — changed by the create": {
    subjects: ["CodesysOneToOne/VltOto_AbsBase.pou","Pro2193/ActuatorWithAlarm_BaseFB.pou"],
    why: "differs after the create (CodesysOneToOne/VltOto_AbsBase.pou/Pick $class): at character 13 of 36 -> 28: \"MethodObject.AbstractPOUMethodObj\" -> \"MethodObject.POUMethodObject\"",
  },
  "codesys:MethodObject.AbstractPOUMethodObject.Interface.TextDocument.Text — a trailing newline folded by the create": {
    subjects: ["CodesysOneToOne/VltOto_AbsBase.pou","Pro2193/ActuatorWithAlarm_BaseFB.pou"],
    why: "differs after the create (CodesysOneToOne/VltOto_AbsBase.pou/Pick Interface.TextDocument.Text): at character 26 of 27 -> 26: \" ABSTRACT Pick : INT\\n\" -> \" ABSTRACT Pick : INT\"",
  },
  "codesys:MethodObject.AbstractPOUMethodObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["CodesysOneToOne/VltOto_AbsBase.pou","Pro2193/ActuatorWithAlarm_BaseFB.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:MethodObject.AbstractPOUMethodObject.meta.EmbeddedTypeGuids#count — changed by the create": {
    subjects: ["CodesysOneToOne/VltOto_AbsBase.pou","Pro2193/ActuatorWithAlarm_BaseFB.pou"],
    why: "differs after the create (CodesysOneToOne/VltOto_AbsBase.pou/Pick meta.EmbeddedTypeGuids#count): 1 -> 2",
  },
  "codesys:MethodObject.AbstractPOUMethodObject.meta.TypeGuid — changed by the create": {
    subjects: ["CodesysOneToOne/VltOto_AbsBase.pou","Pro2193/ActuatorWithAlarm_BaseFB.pou"],
    why: "differs after the create (CodesysOneToOne/VltOto_AbsBase.pou/Pick meta.TypeGuid): {\"$guid\":\"62ebfd1c-d342-43e5-8efb-f22b6d8e4a04\"} -> {\"$guid\":\"f8a58466-d7f6-439f-bbb8-d4600e41d099\"}",
  },
  "codesys:MethodObject.InterfaceMethodObject.Interface.TextDocument.Text — a trailing newline folded by the create": {
    subjects: ["Pro2193/IBoxCenterUnit_WithPneumatic_Commands.itf"],
    why: "differs after the create (Pro2193/IBoxCenterUnit_WithPneumatic_Commands.itf/AddToBox Interface.TextDocument.Text): at character 101 of 102 -> 101: \"enumBoxItem;\\nEND_VAR\\n\" -> \"enumBoxItem;\\nEND_VAR\"",
  },
  "codesys:MethodObject.InterfaceMethodObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/IBoxCenterUnit_WithPneumatic_Commands.itf"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:MethodObject.POUMethodObject.Implementation.TextDocument.Text — a trailing newline folded by the create": {
    subjects: ["Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/IQ_Handling.pou","Pro2193/StackingControlFB.pou","Pro2193/VacuumPumpDualFB.pou"],
    why: "differs after the create (Pro2193/BoxCenterUnit_WithPneumaticFB.pou/Alarms Implementation.TextDocument.Text): at character 240 of 241 -> 240: \"ion,\\n\\tactive\\t\\t\\t=> );\\n\" -> \"ion,\\n\\tactive\\t\\t\\t=> );\"",
  },
  "codesys:MethodObject.POUMethodObject.Implementation.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["CodesysOneToOne/VltFixtureMembers.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/IQ_Handling.pou","Pro2193/SetErrorFB.pou","Pro2193/StackingControlFB.pou","Pro2193/VacuumPumpDualFB.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:MethodObject.POUMethodObject.Interface.TextDocument.Text — a trailing newline folded by the create": {
    subjects: ["Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/IQ_Handling.pou","Pro2193/StackingControlFB.pou","Pro2193/VacuumPumpDualFB.pou"],
    why: "differs after the create (Pro2193/BoxCenterUnit_WithPneumaticFB.pou/Alarms Interface.TextDocument.Text): at character 83 of 84 -> 83: \" SetErrorFB;\\nEND_VAR\\n\" -> \" SetErrorFB;\\nEND_VAR\"",
  },
  "codesys:MethodObject.POUMethodObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["CodesysOneToOne/VltFixtureMembers.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/IQ_Handling.pou","Pro2193/SetErrorFB.pou","Pro2193/StackingControlFB.pou","Pro2193/VacuumPumpDualFB.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:MethodObject.POUMethodObject.meta.Properties[] — changed by the create": {
    subjects: ["Pro2193/StackingControlFB.pou"],
    why: "differs after the create (Pro2193/StackingControlFB.pou/Execute_Sequence2 meta.Properties[]): [\"LanguageModelManager.BuildProperty\"] -> []",
  },
  "codesys:MethodObject.POUMethodObject.meta.Properties[BuildProperty] — lost by the create": {
    subjects: ["Pro2193/StackingControlFB.pou"],
    why: "differs after the create (Pro2193/StackingControlFB.pou/Execute_Sequence2 meta.Properties[BuildProperty]): \"<LanguageModelManager.BuildProperty>\" -> null",
  },
  "codesys:MethodObject.POUMethodObject.meta.Properties[BuildProperty].CompilerDefines — lost by the create": {
    subjects: ["Pro2193/StackingControlFB.pou"],
    why: "differs after the create (Pro2193/StackingControlFB.pou/Execute_Sequence2 meta.Properties[BuildProperty].CompilerDefines): \"\" -> null",
  },
  "codesys:MethodObject.POUMethodObject.meta.Properties[BuildProperty].EnableSystemCall — lost by the create": {
    subjects: ["Pro2193/StackingControlFB.pou"],
    why: "differs after the create (Pro2193/StackingControlFB.pou/Execute_Sequence2 meta.Properties[BuildProperty].EnableSystemCall): false -> null",
  },
  "codesys:MethodObject.POUMethodObject.meta.Properties[BuildProperty].ExcludeFromBuild — lost by the create": {
    subjects: ["Pro2193/StackingControlFB.pou"],
    why: "differs after the create (Pro2193/StackingControlFB.pou/Execute_Sequence2 meta.Properties[BuildProperty].ExcludeFromBuild): true -> null",
  },
  "codesys:MethodObject.POUMethodObject.meta.Properties[BuildProperty].External — lost by the create": {
    subjects: ["Pro2193/StackingControlFB.pou"],
    why: "differs after the create (Pro2193/StackingControlFB.pou/Execute_Sequence2 meta.Properties[BuildProperty].External): false -> null",
  },
  "codesys:MethodObject.POUMethodObject.meta.Properties[BuildProperty].LinkAlways — lost by the create": {
    subjects: ["Pro2193/StackingControlFB.pou"],
    why: "differs after the create (Pro2193/StackingControlFB.pou/Execute_Sequence2 meta.Properties[BuildProperty].LinkAlways): false -> null",
  },
  "codesys:MethodObject.POUMethodObject.meta.Properties[BuildProperty].MemoryReserveForOnlineChange — lost by the create": {
    subjects: ["Pro2193/StackingControlFB.pou"],
    why: "differs after the create (Pro2193/StackingControlFB.pou/Execute_Sequence2 meta.Properties[BuildProperty].MemoryReserveForOnlineChange): 0 -> null",
  },
  "codesys:MethodObject.POUMethodObject.meta.Properties[BuildProperty].Undefines — lost by the create": {
    subjects: ["Pro2193/StackingControlFB.pou"],
    why: "differs after the create (Pro2193/StackingControlFB.pou/Execute_Sequence2 meta.Properties[BuildProperty].Undefines): \"<System.String[]>\" -> null",
  },
  "codesys:MethodObject.POUMethodObject.meta.Properties[BuildProperty].Undefines#count — lost by the create": {
    subjects: ["Pro2193/StackingControlFB.pou"],
    why: "differs after the create (Pro2193/StackingControlFB.pou/Execute_Sequence2 meta.Properties[BuildProperty].Undefines#count): 0 -> null",
  },
  "codesys:MethodObject.POUMethodObject.meta.Properties#count — changed by the create": {
    subjects: ["Pro2193/StackingControlFB.pou"],
    why: "differs after the create (Pro2193/StackingControlFB.pou/Execute_Sequence2 meta.Properties#count): 1 -> 0",
  },
  "codesys:POUObject.POUObject.$create — create refused: UNSUPPORTED": {
    subjects: ["CodesysOneToOne/VltFixtureCfc.pou","CodesysOneToOne/VltFixtureMembers.pou","CodesysOneToOne/VltFixtureSfc.pou","Pro2193/SetErrorFB.pou"],
    why: "create refused: refused: UNSUPPORTED: 'CfcStep' is 'IMPLEMENTATION CFC UNSUPPORTED', a body Volt cannot author — there is no text form for it, so it can only be created in the IDE. Remove it from this push.",
  },
  "codesys:POUObject.POUObject.Implementation.TextDocument.Text — a trailing newline folded by the create": {
    subjects: ["CodesysOneToOne/VltOto_Excluded.pou","Pro2193/ActuatorWithAlarm_BaseFB.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/IQ_Handling.pou","Pro2193/VacuumPumpDualFB.pou"],
    why: "differs after the create (CodesysOneToOne/VltOto_Excluded.pou Implementation.TextDocument.Text): at character 11 of 12 -> 11: \"n := n + 1;\\n\" -> \"n := n + 1;\"",
  },
  "codesys:POUObject.POUObject.Implementation.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["CodesysOneToOne/VltFixtureMembers.pou","CodesysOneToOne/VltOto_AbsBase.pou","CodesysOneToOne/VltOto_Excluded.pou","Pro2193/ActuatorWithAlarm_BaseFB.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/IQ_Handling.pou","Pro2193/StackingControlFB.pou","Pro2193/VacuumPumpDualFB.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:POUObject.POUObject.Interface.TextDocument.Text — a trailing newline folded by the create": {
    subjects: ["CodesysOneToOne/VltOto_AbsBase.pou","CodesysOneToOne/VltOto_Excluded.pou","Pro2193/ActuatorWithAlarm_BaseFB.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/IQ_Handling.pou","Pro2193/StackingControlFB.pou","Pro2193/VacuumPumpDualFB.pou"],
    why: "differs after the create (CodesysOneToOne/VltOto_Excluded.pou Interface.TextDocument.Text): at character 52 of 53 -> 52: \"AR\\n\\tn : INT;\\nEND_VAR\\n\" -> \"AR\\n\\tn : INT;\\nEND_VAR\"",
  },
  "codesys:POUObject.POUObject.Interface.TextDocument.Text — a trailing newline folded by the update": {
    subjects: ["CodesysOneToOne/VltFixtureCfc.pou","CodesysOneToOne/VltFixtureMembers.pou","CodesysOneToOne/VltFixtureSfc.pou","CodesysOneToOne/VltOto_AbsBase.pou","CodesysOneToOne/VltOto_Excluded.pou","Pro2193/ActuatorWithAlarm_BaseFB.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/IQ_Handling.pou","Pro2193/SetErrorFB.pou","Pro2193/StackingControlFB.pou","Pro2193/VacuumPumpDualFB.pou"],
    why: "differs after the update (CodesysOneToOne/VltFixtureMembers.pou Interface.TextDocument.Text): at character 89 of 90 -> 89: \"nTick : INT;\\nEND_VAR\\n\" -> \"nTick : INT;\\nEND_VAR\"",
  },
  "codesys:POUObject.POUObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["CodesysOneToOne/VltFixtureCfc.pou","CodesysOneToOne/VltFixtureMembers.pou","CodesysOneToOne/VltFixtureSfc.pou","CodesysOneToOne/VltOto_AbsBase.pou","CodesysOneToOne/VltOto_Excluded.pou","Pro2193/ActuatorWithAlarm_BaseFB.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/IQ_Handling.pou","Pro2193/SetErrorFB.pou","Pro2193/StackingControlFB.pou","Pro2193/VacuumPumpDualFB.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:POUObject.POUObject.meta.Properties[] — changed by the create": {
    subjects: ["CodesysOneToOne/VltOto_Excluded.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/VacuumPumpDualFB.pou"],
    why: "differs after the create (CodesysOneToOne/VltOto_Excluded.pou meta.Properties[]): [\"LanguageModelManager.BuildProperty\"] -> []",
  },
  "codesys:POUObject.POUObject.meta.Properties[BuildProperty] — lost by the create": {
    subjects: ["CodesysOneToOne/VltOto_Excluded.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou"],
    why: "differs after the create (CodesysOneToOne/VltOto_Excluded.pou meta.Properties[BuildProperty]): \"<LanguageModelManager.BuildProperty>\" -> null",
  },
  "codesys:POUObject.POUObject.meta.Properties[BuildProperty].CompilerDefines — lost by the create": {
    subjects: ["CodesysOneToOne/VltOto_Excluded.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou"],
    why: "differs after the create (CodesysOneToOne/VltOto_Excluded.pou meta.Properties[BuildProperty].CompilerDefines): \"\" -> null",
  },
  "codesys:POUObject.POUObject.meta.Properties[BuildProperty].EnableSystemCall — lost by the create": {
    subjects: ["CodesysOneToOne/VltOto_Excluded.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou"],
    why: "differs after the create (CodesysOneToOne/VltOto_Excluded.pou meta.Properties[BuildProperty].EnableSystemCall): false -> null",
  },
  "codesys:POUObject.POUObject.meta.Properties[BuildProperty].ExcludeFromBuild — lost by the create": {
    subjects: ["CodesysOneToOne/VltOto_Excluded.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou"],
    why: "differs after the create (CodesysOneToOne/VltOto_Excluded.pou meta.Properties[BuildProperty].ExcludeFromBuild): true -> null",
  },
  "codesys:POUObject.POUObject.meta.Properties[BuildProperty].External — lost by the create": {
    subjects: ["CodesysOneToOne/VltOto_Excluded.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou"],
    why: "differs after the create (CodesysOneToOne/VltOto_Excluded.pou meta.Properties[BuildProperty].External): false -> null",
  },
  "codesys:POUObject.POUObject.meta.Properties[BuildProperty].LinkAlways — lost by the create": {
    subjects: ["CodesysOneToOne/VltOto_Excluded.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou"],
    why: "differs after the create (CodesysOneToOne/VltOto_Excluded.pou meta.Properties[BuildProperty].LinkAlways): false -> null",
  },
  "codesys:POUObject.POUObject.meta.Properties[BuildProperty].MemoryReserveForOnlineChange — lost by the create": {
    subjects: ["CodesysOneToOne/VltOto_Excluded.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou"],
    why: "differs after the create (CodesysOneToOne/VltOto_Excluded.pou meta.Properties[BuildProperty].MemoryReserveForOnlineChange): 0 -> null",
  },
  "codesys:POUObject.POUObject.meta.Properties[BuildProperty].Undefines — lost by the create": {
    subjects: ["CodesysOneToOne/VltOto_Excluded.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou"],
    why: "differs after the create (CodesysOneToOne/VltOto_Excluded.pou meta.Properties[BuildProperty].Undefines): \"<System.String[]>\" -> null",
  },
  "codesys:POUObject.POUObject.meta.Properties[BuildProperty].Undefines#count — lost by the create": {
    subjects: ["CodesysOneToOne/VltOto_Excluded.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou"],
    why: "differs after the create (CodesysOneToOne/VltOto_Excluded.pou meta.Properties[BuildProperty].Undefines#count): 0 -> null",
  },
  "codesys:POUObject.POUObject.meta.Properties[POUImageProperty] — held but not refused": {
    subjects: ["Pro2193/VacuumPumpDualFB.pou"],
    why: "held (Pro2193/VacuumPumpDualFB.pou meta.Properties[POUImageProperty] = \"<POUImage.POUImageProperty>\") but neither the pull nor the push refused 'POUImageProperty'",
  },
  "codesys:POUObject.POUObject.meta.Properties[POUImageProperty].ImageData — held but not refused": {
    subjects: ["Pro2193/VacuumPumpDualFB.pou"],
    why: "held (Pro2193/VacuumPumpDualFB.pou meta.Properties[POUImageProperty].ImageData = \"bytes(448974) 1a3c582a7c9dfd8bcb49d8809e9cb3c61e955024\") but neither the pull nor the push refused 'POUImageProperty'",
  },
  "codesys:POUObject.POUObject.meta.Properties[POUImageProperty].MakeTransparent — held but not refused": {
    subjects: ["Pro2193/VacuumPumpDualFB.pou"],
    why: "held (Pro2193/VacuumPumpDualFB.pou meta.Properties[POUImageProperty].MakeTransparent = false) but neither the pull nor the push refused 'POUImageProperty'",
  },
  "codesys:POUObject.POUObject.meta.Properties[POUImageProperty].TransparencyColor — held but not refused": {
    subjects: ["Pro2193/VacuumPumpDualFB.pou"],
    why: "held (Pro2193/VacuumPumpDualFB.pou meta.Properties[POUImageProperty].TransparencyColor = \"White\") but neither the pull nor the push refused 'POUImageProperty'",
  },
  "codesys:POUObject.POUObject.meta.Properties#count — changed by the create": {
    subjects: ["CodesysOneToOne/VltOto_Excluded.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/VacuumPumpDualFB.pou"],
    why: "differs after the create (CodesysOneToOne/VltOto_Excluded.pou meta.Properties#count): 1 -> 0",
  },
  "codesys:POUObject.POUObjectCheckFunction.$class — changed by the create": {
    subjects: ["CodesysOneToOne/CheckDivDInt.pou","Pro2193/CheckPointer.pou"],
    why: "differs after the create (CodesysOneToOne/CheckDivDInt.pou $class): at character 19 of 32 -> 19: \"POUObject.POUObjectCheckFunction\" -> \"POUObject.POUObject\"",
  },
  "codesys:POUObject.POUObjectCheckFunction.Implementation.TextDocument.Text — a trailing newline folded by the create": {
    subjects: ["CodesysOneToOne/CheckDivDInt.pou","Pro2193/CheckPointer.pou"],
    why: "differs after the create (CodesysOneToOne/CheckDivDInt.pou Implementation.TextDocument.Text): at character 77 of 78 -> 77: \"t := divisor;\\nEND_IF\\n\" -> \"t := divisor;\\nEND_IF\"",
  },
  "codesys:POUObject.POUObjectCheckFunction.Implementation.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["CodesysOneToOne/CheckDivDInt.pou","Pro2193/CheckPointer.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:POUObject.POUObjectCheckFunction.Interface.TextDocument.Text — a trailing newline folded by the create": {
    subjects: ["CodesysOneToOne/CheckDivDInt.pou","Pro2193/CheckPointer.pou"],
    why: "differs after the create (CodesysOneToOne/CheckDivDInt.pou Interface.TextDocument.Text): at character 63 of 64 -> 63: \"isor : DINT;\\nEND_VAR\\n\" -> \"isor : DINT;\\nEND_VAR\"",
  },
  "codesys:POUObject.POUObjectCheckFunction.Interface.TextDocument.Text — a trailing newline folded by the update": {
    subjects: ["CodesysOneToOne/CheckDivDInt.pou","Pro2193/CheckPointer.pou"],
    why: "differs after the update (CodesysOneToOne/CheckDivDInt.pou Interface.TextDocument.Text): at character 63 of 64 -> 63: \"isor : DINT;\\nEND_VAR\\n\" -> \"isor : DINT;\\nEND_VAR\"",
  },
  "codesys:POUObject.POUObjectCheckFunction.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["CodesysOneToOne/CheckDivDInt.pou","Pro2193/CheckPointer.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:POUObject.POUObjectCheckFunction.meta.Properties[] — changed by the create": {
    subjects: ["Pro2193/CheckPointer.pou"],
    why: "differs after the create (Pro2193/CheckPointer.pou meta.Properties[]): [\"LanguageModelManager.BuildProperty\",\"ObjectManager.SVFoldersProperty\"] -> [\"ObjectManager.SVFoldersProperty\"]",
  },
  "codesys:POUObject.POUObjectCheckFunction.meta.Properties[BuildProperty] — lost by the create": {
    subjects: ["Pro2193/CheckPointer.pou"],
    why: "differs after the create (Pro2193/CheckPointer.pou meta.Properties[BuildProperty]): \"<LanguageModelManager.BuildProperty>\" -> null",
  },
  "codesys:POUObject.POUObjectCheckFunction.meta.Properties[BuildProperty].CompilerDefines — lost by the create": {
    subjects: ["Pro2193/CheckPointer.pou"],
    why: "differs after the create (Pro2193/CheckPointer.pou meta.Properties[BuildProperty].CompilerDefines): \"\" -> null",
  },
  "codesys:POUObject.POUObjectCheckFunction.meta.Properties[BuildProperty].EnableSystemCall — lost by the create": {
    subjects: ["Pro2193/CheckPointer.pou"],
    why: "differs after the create (Pro2193/CheckPointer.pou meta.Properties[BuildProperty].EnableSystemCall): false -> null",
  },
  "codesys:POUObject.POUObjectCheckFunction.meta.Properties[BuildProperty].ExcludeFromBuild — lost by the create": {
    subjects: ["Pro2193/CheckPointer.pou"],
    why: "differs after the create (Pro2193/CheckPointer.pou meta.Properties[BuildProperty].ExcludeFromBuild): true -> null",
  },
  "codesys:POUObject.POUObjectCheckFunction.meta.Properties[BuildProperty].External — lost by the create": {
    subjects: ["Pro2193/CheckPointer.pou"],
    why: "differs after the create (Pro2193/CheckPointer.pou meta.Properties[BuildProperty].External): false -> null",
  },
  "codesys:POUObject.POUObjectCheckFunction.meta.Properties[BuildProperty].LinkAlways — lost by the create": {
    subjects: ["Pro2193/CheckPointer.pou"],
    why: "differs after the create (Pro2193/CheckPointer.pou meta.Properties[BuildProperty].LinkAlways): false -> null",
  },
  "codesys:POUObject.POUObjectCheckFunction.meta.Properties[BuildProperty].MemoryReserveForOnlineChange — lost by the create": {
    subjects: ["Pro2193/CheckPointer.pou"],
    why: "differs after the create (Pro2193/CheckPointer.pou meta.Properties[BuildProperty].MemoryReserveForOnlineChange): 0 -> null",
  },
  "codesys:POUObject.POUObjectCheckFunction.meta.Properties[BuildProperty].Undefines — lost by the create": {
    subjects: ["Pro2193/CheckPointer.pou"],
    why: "differs after the create (Pro2193/CheckPointer.pou meta.Properties[BuildProperty].Undefines): \"<System.String[]>\" -> null",
  },
  "codesys:POUObject.POUObjectCheckFunction.meta.Properties[BuildProperty].Undefines#count — lost by the create": {
    subjects: ["Pro2193/CheckPointer.pou"],
    why: "differs after the create (Pro2193/CheckPointer.pou meta.Properties[BuildProperty].Undefines#count): 0 -> null",
  },
  "codesys:POUObject.POUObjectCheckFunction.meta.Properties#count — changed by the create": {
    subjects: ["Pro2193/CheckPointer.pou"],
    why: "differs after the create (Pro2193/CheckPointer.pou meta.Properties#count): 2 -> 1",
  },
  "codesys:POUObject.POUObjectCheckFunction.meta.TypeGuid — changed by the create": {
    subjects: ["CodesysOneToOne/CheckDivDInt.pou","Pro2193/CheckPointer.pou"],
    why: "differs after the create (CodesysOneToOne/CheckDivDInt.pou meta.TypeGuid): {\"$guid\":\"c3fc9989-e24b-4002-a2c7-827a0a2595f4\"} -> {\"$guid\":\"6f9dac99-8de1-4efc-8465-68ac443b7d08\"}",
  },
  "codesys:POUObject.POUObjectCheckFunction.SpecialFunc — changed by the create": {
    subjects: ["CodesysOneToOne/CheckDivDInt.pou","Pro2193/CheckPointer.pou"],
    why: "differs after the create (CodesysOneToOne/CheckDivDInt.pou SpecialFunc): at character 0 of 13 -> 4: \"CheckDivInt32\" -> \"None\"",
  },
  "codesys:PropertyObject.InterfacePropertyAccessorObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/IBoxCenterUnit_WithPneumatic_Commands.itf"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:PropertyObject.PropertyAccessorObject.Implementation.TextDocument.Text — a trailing newline folded by the create": {
    subjects: ["Pro2193/BoxCenterUnit_WithPneumaticFB.pou"],
    why: "differs after the create (Pro2193/BoxCenterUnit_WithPneumaticFB.pou/Properties/BoxAreaFreeForFanuc/Get Implementation.TextDocument.Text): at character 42 of 43 -> 42: \" Lift.IsOut;\\t// down\\n\" -> \" Lift.IsOut;\\t// down\"",
  },
  "codesys:PropertyObject.PropertyAccessorObject.Implementation.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/SetErrorFB.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:PropertyObject.PropertyAccessorObject.Interface.TextDocument.Text — a trailing newline folded by the create": {
    subjects: ["Pro2193/BoxCenterUnit_WithPneumaticFB.pou"],
    why: "differs after the create (Pro2193/BoxCenterUnit_WithPneumaticFB.pou/Properties/BoxAreaFreeForFanuc/Get Interface.TextDocument.Text): at character 11 of 12 -> 11: \"VAR\\nEND_VAR\\n\" -> \"VAR\\nEND_VAR\"",
  },
  "codesys:PropertyObject.PropertyAccessorObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/SetErrorFB.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:PropertyObject.PropertyObject.Interface.TextDocument.Text — a trailing newline folded by the create": {
    subjects: ["Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/IBoxCenterUnit_WithPneumatic_Commands.itf"],
    why: "differs after the create (Pro2193/BoxCenterUnit_WithPneumaticFB.pou/Properties/BoxAreaFreeForFanuc Interface.TextDocument.Text): at character 68 of 69 -> 68: \"aFreeForFanuc : BOOL\\n\" -> \"aFreeForFanuc : BOOL\"",
  },
  "codesys:PropertyObject.PropertyObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/IBoxCenterUnit_WithPneumatic_Commands.itf","Pro2193/SetErrorFB.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:TaskObject.TaskObject.Event — changed by the create": {
    subjects: ["CodesysOneToOne/VltOto_ExtTask.task"],
    why: "differs after the create (CodesysOneToOne/VltOto_ExtTask.task Event): at character 0 of 0 -> 12: \"\" -> \"VltOto_Event\"",
  },
  "codesys:TaskObject.TaskObject.Event — changed by the update": {
    subjects: ["CodesysOneToOne/VltOto_ExtTask.task"],
    why: "differs after the update (CodesysOneToOne/VltOto_ExtTask.task Event): at character 0 of 0 -> 12: \"\" -> \"VltOto_Event\"",
  },
  "codesys:TaskObject.TaskObject.ExternalEvent — changed by the create": {
    subjects: ["CodesysOneToOne/VltOto_ExtTask.task"],
    why: "differs after the create (CodesysOneToOne/VltOto_ExtTask.task ExternalEvent): at character 0 of 12 -> 0: \"VltOto_Event\" -> \"\"",
  },
  "codesys:TaskObject.TaskObject.PouList[].Comment — changed by the create": {
    subjects: ["CodesysOneToOne/VltOto_CommentTask.task"],
    why: "differs after the create (CodesysOneToOne/VltOto_CommentTask.task PouList[0].Comment): at character 0 of 10 -> 0: \"runs first\" -> \"\"",
  },
  "codesys:TaskObject.TaskPOUCallObject.Commet — changed by the create": {
    subjects: ["CodesysOneToOne/VltOto_CommentTask.task"],
    why: "differs after the create (CodesysOneToOne/VltOto_CommentTask.task/VltOto_Called Commet): at character 0 of 10 -> 0: \"runs first\" -> \"\"",
  },
  "codesys:TextList.TextListEnumerationObject.$class — changed by the create": {
    subjects: ["CodesysOneToOne/VltOto_TextEnum.dut","Pro2193/IQSlices.dut"],
    why: "differs after the create (CodesysOneToOne/VltOto_TextEnum.dut $class): at character 0 of 34 -> 19: \"TextList.TextListEnu\" -> \"DUTObject.DUTObject\"",
  },
  "codesys:TextList.TextListEnumerationObject.Interface.TextDocument.Text — a trailing newline folded by the create": {
    subjects: ["CodesysOneToOne/VltOto_TextEnum.dut","Pro2193/IQSlices.dut"],
    why: "differs after the create (CodesysOneToOne/VltOto_TextEnum.dut Interface.TextDocument.Text): at character 66 of 67 -> 66: \"5,\\n\\tBlue\\n);\\nEND_TYPE\\n\" -> \"5,\\n\\tBlue\\n);\\nEND_TYPE\"",
  },
  "codesys:TextList.TextListEnumerationObject.Interface.TextDocument.Text — a trailing newline folded by the update": {
    subjects: ["CodesysOneToOne/VltOto_TextEnum.dut","Pro2193/IQSlices.dut"],
    why: "differs after the update (CodesysOneToOne/VltOto_TextEnum.dut Interface.TextDocument.Text): at character 66 of 67 -> 66: \"5,\\n\\tBlue\\n);\\nEND_TYPE\\n\" -> \"5,\\n\\tBlue\\n);\\nEND_TYPE\"",
  },
  "codesys:TextList.TextListEnumerationObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["CodesysOneToOne/VltOto_TextEnum.dut","Pro2193/IQSlices.dut"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:TextList.TextListEnumerationObject.meta.TypeGuid — changed by the create": {
    subjects: ["CodesysOneToOne/VltOto_TextEnum.dut","Pro2193/IQSlices.dut"],
    why: "differs after the create (CodesysOneToOne/VltOto_TextEnum.dut meta.TypeGuid): {\"$guid\":\"40989022-e4d2-4dc7-89d2-9a412930b20e\"} -> {\"$guid\":\"2db5746d-d284-4425-9f7f-2663a34b0ebc\"}",
  },
  "codesys:TextList.TextListEnumerationObject.RemovedTextListEntries — lost by the create": {
    subjects: ["CodesysOneToOne/VltOto_TextEnum.dut","Pro2193/IQSlices.dut"],
    why: "differs after the create (CodesysOneToOne/VltOto_TextEnum.dut RemovedTextListEntries): \"<System.Collections.ArrayList>\" -> null",
  },
  "codesys:TextList.TextListEnumerationObject.RemovedTextListEntries#count — lost by the create": {
    subjects: ["CodesysOneToOne/VltOto_TextEnum.dut","Pro2193/IQSlices.dut"],
    why: "differs after the create (CodesysOneToOne/VltOto_TextEnum.dut RemovedTextListEntries#count): 0 -> null",
  },
  "codesys:TextList.TextListEnumerationObject.TextListObject — lost by the create": {
    subjects: ["CodesysOneToOne/VltOto_TextEnum.dut","Pro2193/IQSlices.dut"],
    why: "differs after the create (CodesysOneToOne/VltOto_TextEnum.dut TextListObject): \"<TextList.TextListEnumerationTextListObject>\" -> null",
  },
  "codesys:TextList.TextListEnumerationObject.TextListObject.Languages — lost by the create": {
    subjects: ["CodesysOneToOne/VltOto_TextEnum.dut","Pro2193/IQSlices.dut"],
    why: "differs after the create (CodesysOneToOne/VltOto_TextEnum.dut TextListObject.Languages): \"<System.Collections.ArrayList>\" -> null",
  },
  "codesys:TextList.TextListEnumerationObject.TextListObject.Languages#count — lost by the create": {
    subjects: ["CodesysOneToOne/VltOto_TextEnum.dut","Pro2193/IQSlices.dut"],
    why: "differs after the create (CodesysOneToOne/VltOto_TextEnum.dut TextListObject.Languages#count): 0 -> null",
  },
  "codesys:TextList.TextListEnumerationObject.TextListObject.TextList[].LanguageTexts — lost by the create": {
    subjects: ["CodesysOneToOne/VltOto_TextEnum.dut","Pro2193/IQSlices.dut"],
    why: "differs after the create (CodesysOneToOne/VltOto_TextEnum.dut TextListObject.TextList[0].LanguageTexts): \"<System.Collections.ArrayList>\" -> null",
  },
  "codesys:TextList.TextListEnumerationObject.TextListObject.TextList[].LanguageTexts#count — lost by the create": {
    subjects: ["CodesysOneToOne/VltOto_TextEnum.dut","Pro2193/IQSlices.dut"],
    why: "differs after the create (CodesysOneToOne/VltOto_TextEnum.dut TextListObject.TextList[0].LanguageTexts#count): 0 -> null",
  },
  "codesys:TransitionObject.TransitionObject.$class — held but not refused": {
    subjects: ["CodesysOneToOne/VltFixtureSfc.pou"],
    why: "held (CodesysOneToOne/VltFixtureSfc.pou/VltOto_Trans $class = \"TransitionObject.TransitionObject\") but neither the pull nor the push refused 'transition'",
  },
  "codesys:TransitionObject.TransitionObject.Implementation — held but not refused": {
    subjects: ["CodesysOneToOne/VltFixtureSfc.pou"],
    why: "held (CodesysOneToOne/VltFixtureSfc.pou/VltOto_Trans Implementation = \"<STObject.STImplementationObject>\") but neither the pull nor the push refused 'transition'",
  },
  "codesys:TransitionObject.TransitionObject.Implementation.TextDocument — held but not refused": {
    subjects: ["CodesysOneToOne/VltFixtureSfc.pou"],
    why: "held (CodesysOneToOne/VltFixtureSfc.pou/VltOto_Trans Implementation.TextDocument = \"<TextDocument.TextDocument>\") but neither the pull nor the push refused 'transition'",
  },
  "codesys:TransitionObject.TransitionObject.Implementation.TextDocument.LineInfoPersistence — held but not refused": {
    subjects: ["CodesysOneToOne/VltFixtureSfc.pou"],
    why: "held (CodesysOneToOne/VltFixtureSfc.pou/VltOto_Trans Implementation.TextDocument.LineInfoPersistence = \"4a156f7b-f51d-4ef4-8f5c-680ff3378b00_Impl_LineIds\") but neither the pull nor the push refused 'transition'",
  },
  "codesys:TransitionObject.TransitionObject.Implementation.TextDocument.Text — held but not refused": {
    subjects: ["CodesysOneToOne/VltFixtureSfc.pou"],
    why: "held (CodesysOneToOne/VltFixtureSfc.pou/VltOto_Trans Implementation.TextDocument.Text = \"\") but neither the pull nor the push refused 'transition'",
  },
  "codesys:TransitionObject.TransitionObject.meta.EmbeddedTypeGuids — held but not refused": {
    subjects: ["CodesysOneToOne/VltFixtureSfc.pou"],
    why: "held (CodesysOneToOne/VltFixtureSfc.pou/VltOto_Trans meta.EmbeddedTypeGuids = \"<System.Guid[]>\") but neither the pull nor the push refused 'transition'",
  },
  "codesys:TransitionObject.TransitionObject.meta.EmbeddedTypeGuids[] — held but not refused": {
    subjects: ["CodesysOneToOne/VltFixtureSfc.pou"],
    why: "held (CodesysOneToOne/VltFixtureSfc.pou/VltOto_Trans meta.EmbeddedTypeGuids[0] = {\"$guid\":\"3b83b776-fb25-43b8-99f2-3c507c9143fc\"}) but neither the pull nor the push refused 'transition'",
  },
  "codesys:TransitionObject.TransitionObject.meta.EmbeddedTypeGuids#count — held but not refused": {
    subjects: ["CodesysOneToOne/VltFixtureSfc.pou"],
    why: "held (CodesysOneToOne/VltFixtureSfc.pou/VltOto_Trans meta.EmbeddedTypeGuids#count = 1) but neither the pull nor the push refused 'transition'",
  },
  "codesys:TransitionObject.TransitionObject.meta.Guid — held but not refused": {
    subjects: ["CodesysOneToOne/VltFixtureSfc.pou"],
    why: "held (CodesysOneToOne/VltFixtureSfc.pou/VltOto_Trans meta.Guid = {\"$guid\":\"4a156f7b-f51d-4ef4-8f5c-680ff3378b00\"}) but neither the pull nor the push refused 'transition'",
  },
  "codesys:TransitionObject.TransitionObject.meta.Name — held but not refused": {
    subjects: ["CodesysOneToOne/VltFixtureSfc.pou"],
    why: "held (CodesysOneToOne/VltFixtureSfc.pou/VltOto_Trans meta.Name = \"VltOto_Trans\") but neither the pull nor the push refused 'transition'",
  },
  "codesys:TransitionObject.TransitionObject.meta.ParentGuid — held but not refused": {
    subjects: ["CodesysOneToOne/VltFixtureSfc.pou"],
    why: "held (CodesysOneToOne/VltFixtureSfc.pou/VltOto_Trans meta.ParentGuid = {\"$guid\":\"51d23c98-17bf-4c59-95d8-ad5e4487739f\"}) but neither the pull nor the push refused 'transition'",
  },
  "codesys:TransitionObject.TransitionObject.meta.Properties[] — held but not refused": {
    subjects: ["CodesysOneToOne/VltFixtureSfc.pou"],
    why: "held (CodesysOneToOne/VltFixtureSfc.pou/VltOto_Trans meta.Properties[] = []) but neither the pull nor the push refused 'transition'",
  },
  "codesys:TransitionObject.TransitionObject.meta.Properties#count — held but not refused": {
    subjects: ["CodesysOneToOne/VltFixtureSfc.pou"],
    why: "held (CodesysOneToOne/VltFixtureSfc.pou/VltOto_Trans meta.Properties#count = 0) but neither the pull nor the push refused 'transition'",
  },
  "codesys:TransitionObject.TransitionObject.meta.Timestamp — held but not refused": {
    subjects: ["CodesysOneToOne/VltFixtureSfc.pou"],
    why: "held (CodesysOneToOne/VltFixtureSfc.pou/VltOto_Trans meta.Timestamp = 639274653487735800) but neither the pull nor the push refused 'transition'",
  },
  "codesys:TransitionObject.TransitionObject.meta.TypeGuid — held but not refused": {
    subjects: ["CodesysOneToOne/VltFixtureSfc.pou"],
    why: "held (CodesysOneToOne/VltFixtureSfc.pou/VltOto_Trans meta.TypeGuid = {\"$guid\":\"a10c6218-cb94-436f-91c6-e1652575253d\"}) but neither the pull nor the push refused 'transition'",
  },
  "codesys:TransitionObject.TransitionObject.UniqueIdGenerator — held but not refused": {
    subjects: ["CodesysOneToOne/VltFixtureSfc.pou"],
    why: "held (CodesysOneToOne/VltFixtureSfc.pou/VltOto_Trans UniqueIdGenerator = \"1\") but neither the pull nor the push refused 'transition'",
  },
  "twincat:TcPOU.POU.$create — create refused: NETWORK_UNSUPPORTED": {
    subjects: ["Project14/POUexecute.pou"],
    why: "create refused: refused: NETWORK_UNSUPPORTED: TwinCAT: network 3 changes shape and holds the wire g1 fed by the leaf 'b'. Volt rebuilds a changed network through TwinCAT's PLCopen import, which is not measured for that shape, so the push is refused before the import rather than risk a network that comes back different. The IDE can make this change.",
  },
  "twincat:TcPOU.POU.$create — create refused: UNSUPPORTED": {
    subjects: ["Project14/VltFixtureCfc.pou","Project14/VltFixtureMembers.pou","Project14/VltFixtureSfc.pou","Project14/ladderLabel.pou"],
    why: "create refused: refused: UNSUPPORTED: TwinCAT: this push changes the number of networks (1 -> 2). Volt cannot ADD one through the archive: a new network needs elements whose member contract only the IDE produces. Add it in the IDE and pull it. — 'ladderLabel' is not created (the create is rolled back)",
  },
  "twincat:TcPOU.POU.TcPlcObject/POU[]/Action[]/ObjectProperties#xml — held but not refused": {
    subjects: ["Project14/VltFixtureMembers.pou"],
    why: "held (Project14/VltFixtureMembers.pou TcPlcObject/POU[VltFixtureMembers]/Action[SfcRun]/ObjectProperties#xml = \"1d0df49182a1337e5da11f1e7394d5cdca22b21b\") but neither the pull nor the push refused 'ObjectProperties'",
  },
  "twincat:TcPOU.POU.TcPlcObject/POU[]/Declaration#text — a trailing newline folded by the update": {
    subjects: ["Project14/VltFixtureMembers.pou"],
    why: "differs after the update (Project14/VltFixtureMembers.pou TcPlcObject/POU[VltFixtureMembers]/Declaration#text): at character 95 of 97 -> 95: \"Tick : INT;\\r\\nEND_VAR\\r\\n\" -> \"Tick : INT;\\r\\nEND_VAR\"",
  },
  "twincat:TcPOU.POU.TcPlcObject/POU[]/ObjectProperties#xml — held but not refused": {
    subjects: ["Project14/VltFixtureSfc.pou"],
    why: "held (Project14/VltFixtureSfc.pou TcPlcObject/POU[VltFixtureSfc]/ObjectProperties#xml = \"704d587efe658c250d4af60f25263e9c8b872741\") but neither the pull nor the push refused 'ObjectProperties'",
  },
}
