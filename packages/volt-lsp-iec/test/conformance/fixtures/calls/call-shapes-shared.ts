/**
 * the helpers `call-shapes.ts`'s parts share: the fixture builders and the data they are built from (openspec
 * lsp-same-standard 4.4).
 */
import type { LanguageTest } from "../../types.js"

export const doc = "transpile-st-to-rust phase 3½ — call shapes"

export function fb(name: string, pouName: string, feature: string, source: string, plcPrgVar: string, plcPrgBody: string, cycles?: number): LanguageTest {
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar, plcPrgBody, ...(cycles === undefined ? {} : { cycles }) }
}

/** A fixture whose root cause is an open transpile-review task: the vendor's answer is recorded, ours is known wrong. */
export function withDeferred(transpile: string, t: LanguageTest): LanguageTest {
  return { ...t, deferred: { transpile } }
}

/** A FUNCTION whose VAR_OUTPUT `o` (`out`, set to `value`) PLC_PRG binds `o => t` into a `into` variable. */
export function routineOutput(name: string, pouName: string, out: string, value: string, into: string): LanguageTest {
  return {
    name,
    pouName,
    kind: "function",
    feature: `a FUNCTION's ${out} output (${value}) bound => a${into === "INT" ? "n" : ""} ${into} variable`,
    fromDoc: doc,
    source: `FUNCTION ${pouName} : BOOL\nVAR_OUTPUT\n\to : ${out};\nEND_VAR\no := ${value};\n${pouName} := TRUE;\nEND_FUNCTION\n`,
    plcPrgVar: `t : ${into}; ok : BOOL;`,
    plcPrgBody: `ok := ${pouName}(o => t);`,
  }
}
