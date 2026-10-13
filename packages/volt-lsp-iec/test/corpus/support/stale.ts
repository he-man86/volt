/**
 * THE CORPUS FILES THAT ARE NOT THE CURRENT BRIDGE'S ANSWER — recorded, so the corpus says which of its files are stale
 * and why (`corpus-provenance.test.ts`; gate review of bridge-one-to-one step 4b, finding 3). A corpus refresh that
 * rewrites one of these makes the test fail: remove it here. Never add a file to make the test pass — a NEW stale file is
 * a pull that was reverted, and it is recorded with its reason or not reverted at all.
 *
 * The LSP reads none of the manifest lines that differ (`SYSTEM`, `REDIRECT`, `LINKALLCONTENT`, `QUALIFIEDONLY`:
 * `src/` has no reader for any of them), so no LSP figure depends on which spelling a file is in.
 */

/** Library manifests in the RETIRED spelling (a `SYSTEM false` line — `LibraryManifest.Write` spells `SYSTEM` only where
 *  it is true), per corpus, each group with its reason. Paths are relative to the corpus folder. */
export const STALE_MANIFESTS: Readonly<Record<string, { why: string; files: readonly string[] }>> = {
  "awa-palletizer": {
    why: "re-pulled 2026-10-13 (bridge-one-to-one step 4b) on a machine whose CODESYS resolves this library's placeholder elsewhere (`Library Manager/(unresolved)/…`); that move is the pulling IDE's, not the change's, so the file was kept as the last machine that resolved it pulled it — in the retired spelling: `SYSTEM false`, and none of the REDIRECT / LINKALLCONTENT / QUALIFIEDONLY lines the current bridge would write",
    files: [
      "Device/Plc Logic/Application/Library Manager/CmpCodeMeter/CmpCodeMeter.library",
      "Device/Plc Logic/Application/Library Manager/CmpEventMgr Implementation/CmpEventMgr Implementation.library",
      "Device/Plc Logic/Application/Library Manager/CmpEventMgr Interfaces, %2A (System)/CmpEventMgr Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/Library Manager/CmpIecVarAccess Implementation/CmpIecVarAccess Implementation.library",
      "Device/Plc Logic/Application/Library Manager/CmpIecVarAccess Interfaces, %2A (System)/CmpIecVarAccess Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/Library Manager/CmpIoMgr Implementation/CmpIoMgr Implementation.library",
      "Device/Plc Logic/Application/Library Manager/L_IE1P_ApplicationErrorsImplementation/L_IE1P_ApplicationErrorsImplementation.library",
      "Device/Plc Logic/Application/Library Manager/L_IMHP_ModuleHandler/L_IMHP_ModuleHandler.library",
      "Device/Plc Logic/Application/Library Manager/L_IPAP_ParameterManagerAccess/L_IPAP_ParameterManagerAccess.library",
      "Device/Plc Logic/Application/Library Manager/L_SEMP_ErrorManagement/L_SEMP_ErrorManagement.library",
      "Device/Plc Logic/Application/Library Manager/L_SI9P_IoDrvi900/L_SI9P_IoDrvi900.library",
      "Device/Plc Logic/Application/Library Manager/L_SMHP_ModuleHandler/L_SMHP_ModuleHandler.library",
      "Device/Plc Logic/Application/Library Manager/L_ST2I_ActivateTimeMeasurement, %2A (Lenze)/L_ST2I_ActivateTimeMeasurement, %2A (Lenze).library",
      "Device/Plc Logic/Application/Library Manager/SysCpuMultiCore/SysCpuMultiCore.library",
      "Device/Plc Logic/Application/Library Manager/SysProcess Implementation/SysProcess Implementation.library",
      "Device/Plc Logic/Application/Library Manager/SysProcess Interfaces, %2A (System)/SysProcess Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/Library Manager/SysSem Implementation/SysSem Implementation.library",
      "Device/Plc Logic/Application/Library Manager/SysSem Interfaces, %2A (System)/SysSem Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/Library Manager/SysSem/SysSem.library",
      "Device/Plc Logic/Application/Library Manager/SysTimeRtc/SysTimeRtc.library",
      "Device/Plc Logic/Application/Library Manager/TextListUtils/TextListUtils.library",
      "Device/Plc Logic/Application/Library Manager/Visu Interfaces, %2A (System)/Visu Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/Library Manager/VisuUtils/VisuUtils.library",
    ],
  },
  "bakon-nano": {
    why: "re-pulled 2026-10-13 (bridge-one-to-one step 4b) on a machine whose CODESYS resolves this library's placeholder elsewhere (`Library Manager/(unresolved)/…`); that move is the pulling IDE's, not the change's, so the file was kept as the last machine that resolved it pulled it — in the retired spelling: `SYSTEM false`, and none of the REDIRECT / LINKALLCONTENT / QUALIFIEDONLY lines the current bridge would write",
    files: [
      "Device/Plc Logic/Application/Library Manager/CmpCodeMeter/CmpCodeMeter.library",
      "Device/Plc Logic/Application/Library Manager/CmpEventMgr Implementation/CmpEventMgr Implementation.library",
      "Device/Plc Logic/Application/Library Manager/CmpEventMgr Interfaces, %2A (System)/CmpEventMgr Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/Library Manager/CmpIecVarAccess Implementation/CmpIecVarAccess Implementation.library",
      "Device/Plc Logic/Application/Library Manager/CmpIecVarAccess Interfaces, %2A (System)/CmpIecVarAccess Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/Library Manager/CmpIoMgr Implementation/CmpIoMgr Implementation.library",
      "Device/Plc Logic/Application/Library Manager/L_IE1P_ApplicationErrorsImplementation/L_IE1P_ApplicationErrorsImplementation.library",
      "Device/Plc Logic/Application/Library Manager/L_IMHP_ModuleHandler/L_IMHP_ModuleHandler.library",
      "Device/Plc Logic/Application/Library Manager/L_IPAP_ParameterManagerAccess/L_IPAP_ParameterManagerAccess.library",
      "Device/Plc Logic/Application/Library Manager/L_SEMP_ErrorManagement/L_SEMP_ErrorManagement.library",
      "Device/Plc Logic/Application/Library Manager/L_SI9P_IoDrvi900/L_SI9P_IoDrvi900.library",
      "Device/Plc Logic/Application/Library Manager/L_SMHP_ModuleHandler/L_SMHP_ModuleHandler.library",
      "Device/Plc Logic/Application/Library Manager/L_ST2I_ActivateTimeMeasurement, %2A (Lenze)/L_ST2I_ActivateTimeMeasurement, %2A (Lenze).library",
      "Device/Plc Logic/Application/Library Manager/SysCpuMultiCore/SysCpuMultiCore.library",
      "Device/Plc Logic/Application/Library Manager/SysProcess Implementation/SysProcess Implementation.library",
      "Device/Plc Logic/Application/Library Manager/SysProcess Interfaces, %2A (System)/SysProcess Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/Library Manager/SysSem Implementation/SysSem Implementation.library",
      "Device/Plc Logic/Application/Library Manager/SysSem Interfaces, %2A (System)/SysSem Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/Library Manager/SysSocket Implementation/SysSocket Implementation.library",
      "Device/Plc Logic/Application/Library Manager/SysSocket Interfaces, %2A (System)/SysSocket Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/Library Manager/TextListUtils/TextListUtils.library",
      "Device/Plc Logic/Application/Library Manager/Visu Interfaces, %2A (System)/Visu Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/Library Manager/VisuUtils/VisuUtils.library",
    ],
  },
  "CodesysTestProject": {
    why: "re-pulled 2026-10-13 (bridge-one-to-one step 4b) on a machine whose CODESYS resolves this library's placeholder elsewhere (`Library Manager/(unresolved)/…`); that move is the pulling IDE's, not the change's, so the file was kept as the last machine that resolved it pulled it — in the retired spelling: `SYSTEM false`, and none of the REDIRECT / LINKALLCONTENT / QUALIFIEDONLY lines the current bridge would write",
    files: [
      "Device/Plc Logic/Application/Library Manager/CmpCodeMeter/CmpCodeMeter.library",
      "Device/Plc Logic/Application/Library Manager/CmpEventMgr Implementation/CmpEventMgr Implementation.library",
      "Device/Plc Logic/Application/Library Manager/CmpEventMgr Interfaces, %2A (System)/CmpEventMgr Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/Library Manager/CmpIoMgr Implementation/CmpIoMgr Implementation.library",
    ],
  },
  "lenze-mid": {
    why: "re-pulled 2026-10-13 (bridge-one-to-one step 4b) on a machine whose CODESYS resolves this library's placeholder elsewhere (`Library Manager/(unresolved)/…`); that move is the pulling IDE's, not the change's, so the file was kept as the last machine that resolved it pulled it — in the retired spelling: `SYSTEM false`, and none of the REDIRECT / LINKALLCONTENT / QUALIFIEDONLY lines the current bridge would write",
    files: [
      "Device/Plc Logic/Application/Library Manager/CmpCodeMeter/CmpCodeMeter.library",
      "Device/Plc Logic/Application/Library Manager/CmpEventMgr Implementation/CmpEventMgr Implementation.library",
      "Device/Plc Logic/Application/Library Manager/CmpEventMgr Interfaces, %2A (System)/CmpEventMgr Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/Library Manager/CmpIecVarAccess Implementation/CmpIecVarAccess Implementation.library",
      "Device/Plc Logic/Application/Library Manager/CmpIecVarAccess Interfaces, %2A (System)/CmpIecVarAccess Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/Library Manager/CmpIoMgr Implementation/CmpIoMgr Implementation.library",
      "Device/Plc Logic/Application/Library Manager/IoDriver Parameter Interfaces, %2A (System)/IoDriver Parameter Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/Library Manager/L_IE1P_ApplicationErrorsImplementation/L_IE1P_ApplicationErrorsImplementation.library",
      "Device/Plc Logic/Application/Library Manager/L_IMHP_ModuleHandler/L_IMHP_ModuleHandler.library",
      "Device/Plc Logic/Application/Library Manager/L_IPAP_ParameterManagerAccess/L_IPAP_ParameterManagerAccess.library",
      "Device/Plc Logic/Application/Library Manager/L_MC4I_TestTools, %2A (Lenze)/L_MC4I_TestTools, %2A (Lenze).library",
      "Device/Plc Logic/Application/Library Manager/L_SEMP_ErrorManagement/L_SEMP_ErrorManagement.library",
      "Device/Plc Logic/Application/Library Manager/L_SI9P_IoDrvi900/L_SI9P_IoDrvi900.library",
      "Device/Plc Logic/Application/Library Manager/L_SMHP_ModuleHandler/L_SMHP_ModuleHandler.library",
      "Device/Plc Logic/Application/Library Manager/L_ST2I_ActivateTimeMeasurement, %2A (Lenze)/L_ST2I_ActivateTimeMeasurement, %2A (Lenze).library",
      "Device/Plc Logic/Application/Library Manager/SysCpuMultiCore/SysCpuMultiCore.library",
      "Device/Plc Logic/Application/Library Manager/SysProcess Implementation/SysProcess Implementation.library",
      "Device/Plc Logic/Application/Library Manager/SysProcess Interfaces, %2A (System)/SysProcess Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/Library Manager/SysSem Implementation/SysSem Implementation.library",
      "Device/Plc Logic/Application/Library Manager/SysSem Interfaces, %2A (System)/SysSem Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/Library Manager/SysTimeCore/SysTimeCore.library",
      "Device/Plc Logic/Application/Library Manager/SysTimeRtc/SysTimeRtc.library",
      "Device/Plc Logic/Application/Library Manager/TextListUtils/TextListUtils.library",
      "Device/Plc Logic/Application/Library Manager/Visu Interfaces, %2A (System)/Visu Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/Library Manager/VisuUtils/VisuUtils.library",
    ],
  },
  "pro2193": {
    why: "re-pulled 2026-10-13 (bridge-one-to-one step 4b) on a machine whose CODESYS resolves this library's placeholder elsewhere (`Library Manager/(unresolved)/…`); that move is the pulling IDE's, not the change's, so the file was kept as the last machine that resolved it pulled it — in the retired spelling: `SYSTEM false`, and none of the REDIRECT / LINKALLCONTENT / QUALIFIEDONLY lines the current bridge would write",
    files: [
      "Device/Plc Logic/Application/09 Misc/Library Manager/CAA DTUtility/CAA DTUtility.library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/CmpCodeMeter/CmpCodeMeter.library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/CmpEventMgr Implementation/CmpEventMgr Implementation.library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/CmpEventMgr Interfaces, %2A (System)/CmpEventMgr Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/CmpIecVarAccess Implementation/CmpIecVarAccess Implementation.library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/CmpIecVarAccess Interfaces, %2A (System)/CmpIecVarAccess Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/CmpIoMgr Implementation/CmpIoMgr Implementation.library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/IoDriver Parameter Interfaces, %2A (System)/IoDriver Parameter Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/L_IE1P_ApplicationErrorsImplementation/L_IE1P_ApplicationErrorsImplementation.library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/L_IMHP_ModuleHandler/L_IMHP_ModuleHandler.library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/L_IPAP_ParameterManagerAccess/L_IPAP_ParameterManagerAccess.library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/L_MC4I_TestTools, %2A (Lenze)/L_MC4I_TestTools, %2A (Lenze).library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/L_SEMP_ErrorManagement/L_SEMP_ErrorManagement.library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/L_SI9P_IoDrvi900/L_SI9P_IoDrvi900.library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/L_SMHP_ModuleHandler/L_SMHP_ModuleHandler.library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/L_ST2I_ActivateTimeMeasurement, %2A (Lenze)/L_ST2I_ActivateTimeMeasurement, %2A (Lenze).library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/SysProcess Implementation/SysProcess Implementation.library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/SysProcess Interfaces, %2A (System)/SysProcess Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/SysSem Implementation/SysSem Implementation.library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/SysSem Interfaces, %2A (System)/SysSem Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/SysSem/SysSem.library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/SysSocket Implementation/SysSocket Implementation.library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/SysSocket Interfaces, %2A (System)/SysSocket Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/TextListUtils/TextListUtils.library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/Visu Interfaces, %2A (System)/Visu Interfaces, %2A (System).library",
      "Device/Plc Logic/Application/09 Misc/Library Manager/VisuUtils/VisuUtils.library",
    ],
  },
}

/** Objects the bridge pulls that a corpus does NOT hold, per corpus, each with its reason. */
export const MISSING_OBJECTS: Readonly<Record<string, { why: string; files: readonly string[] }>> = {
  CodesysTestProject: {
    why:
      "authored in the fixture project 2026-09-28 (openspec implementation-keyword: the hidden-member case), after the " +
      "corpus and its recorded build (expected-build.codesys.json, 2026-09-20) were last taken; step 4b's re-pull brought " +
      "it and it was reverted, because adding it means re-recording the project's build oracle with it — the next corpus " +
      "refresh does both",
    files: ["Device/Plc Logic/Application/VltFixtureMembers.pou"],
  },
}
