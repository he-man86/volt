/**
 * THE BODY LOWERING READS — `bodyStatements` under the world the transpiler compiles for: the project's names
 * (`symbols/condition-world`) and the EXEC ORACLE's device and project, the one environment whose answers the run
 * recordings hold (`CodesysTestProject.project` on CODESYS Control Win V3 x64, in simulation —
 * `recordings/codesys.run.json` "recorded.ide"). Each fact is measured by a `prag_if_*` fixture (frontend-conformance
 * 2.7.1, `record:exec` 2026-10-02); none is assumed:
 *
 *   IsLittleEndian TRUE, IsSimulationMode TRUE, IsFPUSupported TRUE    prag_if_is_little_endian / _simulation_mode / _fpu_supported
 *   RegisterSize '64' (not '32'), PackMode '8'                         prag_if_register_size(_32), prag_if_packmode
 *   the task MainTask (and no other name)                              prag_if_defined_task(_absent)
 *   no project compile define                                          prag_project_defined_in_body
 */
import { bodyStatements, type BodyParse, type BodySpan, type ConditionWorld, type DeviceFacts, type Target, type TopLevel } from "../../frontend/syntax/index.js"
import { bodyConditionWorld, type Scope } from "../../frontend/symbols/index.js"

const EXEC_ORACLE_DEVICE: DeviceFacts = Object.freeze({ littleEndian: true, simulation: true, fpu: true, registerSize: 64, packMode: 8 })
/** The exec oracle's TARGET — 64-bit: `SIZEOF` of each platform integer runs to 8 (`plat_*_sizeof`) and `__XINT` resolves to
 *  LINT (`plat_xint_into_lint`, `ty_dint_to_uxint`). Lowering binds its project with it (frontend-conformance 4.1.1; the
 *  transpiler's own platform-name rewrite is handed to transpile-restructure, task 5.3). */
export const EXEC_ORACLE_TARGET: Target = Object.freeze({ pointerBits: 64 as const })
const EXEC_ORACLE_PROJECT: NonNullable<ConditionWorld["project"]> = Object.freeze({ defines: new Set<string>(), tasks: new Set(["MainTask"]) })

/** One exec world per names world, so `bodyStatements`' cache keeps one tree per body (lowering keys maps on its nodes). */
const execWorlds = new WeakMap<ConditionWorld, ConditionWorld>()

/** `body` of `unit` as the exec oracle compiles it. */
export function execBodyStatements(project: Scope, unit: TopLevel, body: BodySpan): BodyParse {
  const names = bodyConditionWorld(project, unit, body)
  let world = execWorlds.get(names)
  if (world === undefined) execWorlds.set(names, (world = { ...names, device: EXEC_ORACLE_DEVICE, project: EXEC_ORACLE_PROJECT }))
  return bodyStatements(body, world)
}
