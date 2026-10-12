/**
 * the helpers `check-coverage.ts`'s parts share: the fixture builders and the data they are built from (openspec
 * lsp-same-standard 4.4).
 */
import type { LanguageTest } from "../../types.js"

/** A single self-contained FB fixture, instantiated in PLC_PRG so the compiler reaches it. */
export function fb(name: string, feature: string, decls: string, body = ""): LanguageTest {
  const pou = `FB_LANG_${name}`
  return {
    name,
    pouName: pou,
    kind: "function_block",
    feature,
    fromDoc: "check-coverage",
    plcPrgVar: `inst_${name} : ${pou};`,
    plcPrgBody: `inst_${name}();`,
    source: `FUNCTION_BLOCK ${pou}\nVAR\n\t${decls}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}
