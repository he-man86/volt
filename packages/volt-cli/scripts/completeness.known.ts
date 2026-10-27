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
  "codesys:ActionObject.ActionObject.Implementation.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/IQ_Handling.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:DUTObject.DUTObject.$pull — pull refused": {
    subjects: ["Pro2193/MagazineMotors_TurnAround_Data.dut","Pro2193/MagazineMotors_TurnAround_Stateasdfasdfasdf.dut","Pro2193/MagazineMotors_Wrap_Data.dut","Pro2193/MagazineMotors_Wrap_State.dut","Pro2193/MagazinePeeling_Data.dut","Pro2193/MagazinePeeling_State.dut"],
    why: "pull: MagazineMotors_Wrap_Data.dut: refused: 'MagazineMotors_Wrap_Data' sits in the excluded folder 'Device/Plc Logic/Application/03 Hardware Units/31 SER/31.11 - Magazines/Motors/Wrap Magazine' — it is not built, so it is not pulled as a built one",
  },
  "codesys:DUTObject.DUTObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/BFU_InputsType.dut"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:GVLObject.GVLObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/GVL_Errorlists.gvl"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:GVLObject.VarPersistentObject.$create — create refused: UNSUPPORTED": {
    subjects: ["Pro2193/PersistentVars.gvl"],
    why: "create refused: refused: UNSUPPORTED: 'PersistentVars': a create carrying %CLASS PERSISTENT is not made — a persistent list's factory is measured, but its dymmattributecount is not: the completeness oracle has not reproduced a re-created list (openspec bridge-one-to-one §1.1). Create it in the IDE and pull; an update of an existing one is written.",
  },
  "codesys:GVLObject.VarPersistentObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/PersistentVars.gvl"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:InterfaceObject.InterfaceObject.$pull — pull refused": {
    subjects: ["Pro2193/IMagazinePeeling_Commands.itf"],
    why: "pull: IMagazinePeeling_Commands.itf: refused: 'IMagazinePeeling_Commands' sits in the excluded folder 'Device/Plc Logic/Application/03 Hardware Units/31 SER/31.11 - Magazines/Peeling' — it is not built, so it is not pulled as a built one",
  },
  "codesys:InterfaceObject.InterfaceObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/IBoxCenterUnit_WithPneumatic_Commands.itf"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:MethodObject.AbstractPOUMethodObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["CodesysOneToOne/VltOto_AbsBase.pou","Pro2193/ActuatorWithAlarm_BaseFB.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:MethodObject.InterfaceMethodObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/IBoxCenterUnit_WithPneumatic_Commands.itf"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:MethodObject.POUMethodObject.Implementation.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["CodesysOneToOne/VltFixtureMembers.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/IQ_Handling.pou","Pro2193/SetErrorFB.pou","Pro2193/StackingControlFB.pou","Pro2193/VacuumPumpDualFB.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:MethodObject.POUMethodObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["CodesysOneToOne/VltFixtureMembers.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/IQ_Handling.pou","Pro2193/SetErrorFB.pou","Pro2193/StackingControlFB.pou","Pro2193/VacuumPumpDualFB.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:POUObject.POUObject.$create — create refused: UNSUPPORTED": {
    subjects: ["CodesysOneToOne/VltFixtureCfc.pou","CodesysOneToOne/VltFixtureMembers.pou","Pro2193/SetErrorFB.pou"],
    why: "create refused: refused: UNSUPPORTED: 'CfcStep' is '%LANGUAGE CFC UNSUPPORTED', a body Volt cannot author — there is no text form for it, so it can only be created in the IDE. Remove it from this push.",
  },
  "codesys:POUObject.POUObject.$pull — pull refused": {
    subjects: ["CodesysOneToOne/VltFixtureSfc.pou","Pro2193/MagazineMotors_TurnAroundFB.pou","Pro2193/MagazineMotors_WrapFB.pou","Pro2193/MagazinePeeling_BeursFB.pou","Pro2193/RemoveStackStatusBFU.pou","Pro2193/ShiftStackStatusFB.pou"],
    why: "pull: VltFixtureSfc.pou: refused: 'VltFixtureSfc' holds the transition 'VltOto_Trans' as an object of its own — Volt has no text form for a standalone SFC transition (refused by name: niche, accepted loss, 0 occurrences in the corpora), so the item is not pulled rather than pulled without it.",
  },
  "codesys:POUObject.POUObject.Implementation.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["CodesysOneToOne/VltFixtureMembers.pou","CodesysOneToOne/VltOto_AbsBase.pou","CodesysOneToOne/VltOto_Excluded.pou","Pro2193/ActuatorWithAlarm_BaseFB.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/IQ_Handling.pou","Pro2193/StackingControlFB.pou","Pro2193/VacuumPumpDualFB.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:POUObject.POUObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["CodesysOneToOne/VltFixtureCfc.pou","CodesysOneToOne/VltFixtureMembers.pou","CodesysOneToOne/VltOto_AbsBase.pou","CodesysOneToOne/VltOto_Excluded.pou","Pro2193/ActuatorWithAlarm_BaseFB.pou","Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/IQ_Handling.pou","Pro2193/SetErrorFB.pou","Pro2193/StackingControlFB.pou","Pro2193/VacuumPumpDualFB.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:POUObject.POUObject.meta.Properties[] — changed by the create": {
    subjects: ["Pro2193/VacuumPumpDualFB.pou"],
    why: "niche: accepted loss (2 occurrences in the corpora, both Pro2193; gate review of step 4b, finding 2): a POU image (POUImageProperty, 449 KB of binary) has no text form - the pull logs the item and the property at Warn, an in-place push never touches it, and a create from the text makes the POU without it, because no line of the text marks it and a create cannot refuse what it cannot see (a marker line would be a new text form, not approved). First finding: differs after the create (Pro2193/VacuumPumpDualFB.pou meta.Properties[]): [\"ObjectManager.SVFoldersProperty\",\"POUImage.POUImageProperty\"] -> [\"ObjectManager.SVFoldersProperty\"]",
  },
  "codesys:POUObject.POUObject.meta.Properties[POUImageProperty] — held but not refused": {
    subjects: ["Pro2193/VacuumPumpDualFB.pou"],
    why: "niche: accepted loss (2 occurrences in the corpora, both Pro2193; gate review of step 4b, finding 2): a POU image (POUImageProperty, 449 KB of binary) has no text form - the pull logs the item and the property at Warn, an in-place push never touches it, and a create from the text makes the POU without it, because no line of the text marks it and a create cannot refuse what it cannot see (a marker line would be a new text form, not approved). First finding: held (Pro2193/VacuumPumpDualFB.pou meta.Properties[POUImageProperty] = \"<POUImage.POUImageProperty>\") but neither the pull nor the push refused 'POUImageProperty'",
  },
  "codesys:POUObject.POUObject.meta.Properties[POUImageProperty].ImageData — held but not refused": {
    subjects: ["Pro2193/VacuumPumpDualFB.pou"],
    why: "niche: accepted loss (2 occurrences in the corpora, both Pro2193; gate review of step 4b, finding 2): a POU image (POUImageProperty, 449 KB of binary) has no text form - the pull logs the item and the property at Warn, an in-place push never touches it, and a create from the text makes the POU without it, because no line of the text marks it and a create cannot refuse what it cannot see (a marker line would be a new text form, not approved). First finding: held (Pro2193/VacuumPumpDualFB.pou meta.Properties[POUImageProperty].ImageData = \"bytes(448974) 1a3c582a7c9dfd8bcb49d8809e9cb3c61e955024\") but neither the pull nor the push refused 'POUImageProperty'",
  },
  "codesys:POUObject.POUObject.meta.Properties[POUImageProperty].MakeTransparent — held but not refused": {
    subjects: ["Pro2193/VacuumPumpDualFB.pou"],
    why: "niche: accepted loss (2 occurrences in the corpora, both Pro2193; gate review of step 4b, finding 2): a POU image (POUImageProperty, 449 KB of binary) has no text form - the pull logs the item and the property at Warn, an in-place push never touches it, and a create from the text makes the POU without it, because no line of the text marks it and a create cannot refuse what it cannot see (a marker line would be a new text form, not approved). First finding: held (Pro2193/VacuumPumpDualFB.pou meta.Properties[POUImageProperty].MakeTransparent = false) but neither the pull nor the push refused 'POUImageProperty'",
  },
  "codesys:POUObject.POUObject.meta.Properties[POUImageProperty].TransparencyColor — held but not refused": {
    subjects: ["Pro2193/VacuumPumpDualFB.pou"],
    why: "niche: accepted loss (2 occurrences in the corpora, both Pro2193; gate review of step 4b, finding 2): a POU image (POUImageProperty, 449 KB of binary) has no text form - the pull logs the item and the property at Warn, an in-place push never touches it, and a create from the text makes the POU without it, because no line of the text marks it and a create cannot refuse what it cannot see (a marker line would be a new text form, not approved). First finding: held (Pro2193/VacuumPumpDualFB.pou meta.Properties[POUImageProperty].TransparencyColor = \"White\") but neither the pull nor the push refused 'POUImageProperty'",
  },
  "codesys:POUObject.POUObject.meta.Properties#count — changed by the create": {
    subjects: ["Pro2193/VacuumPumpDualFB.pou"],
    why: "niche: accepted loss (2 occurrences in the corpora, both Pro2193; gate review of step 4b, finding 2): a POU image (POUImageProperty, 449 KB of binary) has no text form - the pull logs the item and the property at Warn, an in-place push never touches it, and a create from the text makes the POU without it, because no line of the text marks it and a create cannot refuse what it cannot see (a marker line would be a new text form, not approved). First finding: differs after the create (Pro2193/VacuumPumpDualFB.pou meta.Properties#count): 2 -> 1",
  },
  "codesys:POUObject.POUObjectCheckFunction.Implementation.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["CodesysOneToOne/CheckDivDInt.pou","Pro2193/CheckPointer.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:POUObject.POUObjectCheckFunction.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["CodesysOneToOne/CheckDivDInt.pou","Pro2193/CheckPointer.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:PropertyObject.InterfacePropertyAccessorObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/IBoxCenterUnit_WithPneumatic_Commands.itf"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:PropertyObject.PropertyAccessorObject.Implementation.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/SetErrorFB.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:PropertyObject.PropertyAccessorObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/SetErrorFB.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:PropertyObject.PropertyObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["Pro2193/BoxCenterUnit_WithPneumaticFB.pou","Pro2193/IBoxCenterUnit_WithPneumatic_Commands.itf","Pro2193/SetErrorFB.pou"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "codesys:TextList.TextListEnumerationObject.Interface.TextDocument.TextBlobForSerialisation — a cache citing no vendor-facts row": {
    subjects: ["CodesysOneToOne/VltOto_TextEnum.dut","Pro2193/IQSlices.dut"],
    why: "a cache citing no vendor-facts row ('text-blob-serialisation')",
  },
  "twincat:TcPOU.POU.$create — create refused: NETWORK_UNSUPPORTED": {
    subjects: ["Project14/POUexecute.pou"],
    why: "create refused: refused: NETWORK_UNSUPPORTED: TwinCAT: network 3 changes shape and holds the wire g1 fed by the leaf 'b'. Volt rebuilds a changed network through TwinCAT's PLCopen import, which is not measured for that shape, so the push is refused before the import rather than risk a network that comes back different. The IDE can make this change.",
  },
  "twincat:TcPOU.POU.$create — create refused: UNSUPPORTED": {
    subjects: ["Project14/VltFixtureCfc.pou","Project14/VltFixtureMembers.pou","Project14/VltFixtureSfc.pou","Project14/ladderLabel.pou"],
    why: "create refused: refused: UNSUPPORTED: TwinCAT: the import built 1 network(s) for the 2 pushed, so its networks cannot be stamped one for one: the import drops an empty network and builds one network per connected rung (DIALECT D25). — 'ladderLabel' is not created (the create is rolled back)",
  },
  "twincat:TcPOU.POU.TcPlcObject/POU[]/Action[]/ObjectProperties#xml — held but not refused": {
    subjects: ["Project14/VltFixtureMembers.pou"],
    why: "niche: accepted loss (0 occurrences in the corpora beyond the two authored SFC fixtures, VltFixtureSfc and VltFixtureMembers.SfcRun) — a TwinCAT SFC body's ObjectProperties block is held, not refused; SFC bodies are %LANGUAGE SFC UNSUPPORTED (an update keeps the block, a create is refused), so no push writes it (bridge-one-to-one 4.2)",
  },
  "twincat:TcPOU.POU.TcPlcObject/POU[]/ObjectProperties#xml — held but not refused": {
    subjects: ["Project14/VltFixtureSfc.pou"],
    why: "niche: accepted loss (0 occurrences in the corpora beyond the two authored SFC fixtures, VltFixtureSfc and VltFixtureMembers.SfcRun) — a TwinCAT SFC body's ObjectProperties block is held, not refused; SFC bodies are %LANGUAGE SFC UNSUPPORTED (an update keeps the block, a create is refused), so no push writes it (bridge-one-to-one 4.2)",
  },
}
