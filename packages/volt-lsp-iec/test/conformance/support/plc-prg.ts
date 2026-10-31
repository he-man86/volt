/**
 * The PLC_PRG a fixture is built and run under — the one text the bridge recorder pushes, the LSP replay analyzes, the
 * simulator recorder wraps and the transpiler lowers. Each built it inline before (unify-conformance-suite).
 */
import type { LanguageTest } from "../types.js"

/** A fixture whose PLC_PRG body is plain-ST network text (`ExecCase.language`): only a bridge makes it a network. */
export const isNetworkCase = (t: Pick<LanguageTest, "plcPrgBody">): boolean => /^%LANGUAGE (LD|FBD)\s/.test(t.plcPrgBody ?? "")

export function plcPrgSource(t: Pick<LanguageTest, "plcPrgVar" | "plcPrgBody">): string {
  return `PROGRAM PLC_PRG\nVAR\n${t.plcPrgVar ?? ""}\nEND_VAR\n${t.plcPrgBody ?? ""}\nEND_PROGRAM\n`
}
