/**
 * the helpers `library-bodies.ts`'s parts share: the fixture builders and the data they are built from (openspec
 * lsp-same-standard 4.4).
 */
import type { LanguageTest } from "../../types.js"

export const doc = "libraries — the library repo's bodies (plc-library-runtime design §6)"

/** One FB fixture, instantiated as `inst` in PLC_PRG and called once a scan. */
export function fb(name: string, feature: string, source: string, extra: Partial<LanguageTest> = {}): LanguageTest {
  const pouName = /FUNCTION_BLOCK (\w+)/.exec(source)![1]!
  return { name, pouName, kind: "function_block", feature, fromDoc: doc, source, plcPrgVar: `inst : ${pouName};`, plcPrgBody: "inst();", ...extra }
}

/** A clocked fixture over `cycles` scans: `now` records the clock every scan, and the replay runs on it. */
export const clocked = (cycles: number): Partial<LanguageTest> => ({ cycles, clock: "inst.now" })
