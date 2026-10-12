/**
 * the helpers `data-type.ts`'s parts share: the fixture builders and the data they are built from (openspec
 * lsp-same-standard 4.4).
 */
import type { LanguageTest } from "../../types.js"

/** One UNION overlay fixture: `type_dut_union_<name>`, its own DUT of `members`, stored by `body` in PLC_PRG's `u`. */
export function unionOverlay(name: string, members: string, body: string): LanguageTest[] {
  const dut = `DUT_LANG_union_${name}`
  return [
    {
      name: `type_dut_union_${name}`,
      pouName: dut,
      kind: "dut",
      feature: "UNION — a member stored, every other member read over its bytes",
      fromDoc: "06-data-types.md",
      plcPrgVar: `u : ${dut};`,
      plcPrgBody: body,
      source: `TYPE ${dut} :\nUNION\n\t${members}\nEND_UNION\nEND_TYPE\n`,
    },
  ]
}
