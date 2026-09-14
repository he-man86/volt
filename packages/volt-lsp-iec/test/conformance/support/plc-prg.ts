/**
 * The PLC_PRG a fixture is built and run under — the one text the bridge recorder pushes, the LSP replay analyzes, the
 * simulator recorder wraps and the transpiler lowers. Each built it inline before (unify-conformance-suite).
 */
import type { LanguageTest } from "../types.js"

export function plcPrgSource(t: Pick<LanguageTest, "plcPrgVar" | "plcPrgBody">): string {
  return `PROGRAM PLC_PRG\nVAR\n${t.plcPrgVar ?? ""}\nEND_VAR\n${t.plcPrgBody ?? ""}\nEND_PROGRAM\n`
}
