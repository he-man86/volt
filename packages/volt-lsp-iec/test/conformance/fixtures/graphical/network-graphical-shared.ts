/**
 * the helpers `network-graphical.ts`'s parts share: the fixture builders and the data they are built from (openspec
 * lsp-same-standard 4.4).
 */
import type { LanguageTest } from "../../types.js"

export const doc = "network-text.html"

/** Why none of these reach the EXECUTION recorder — and the reason is SCOPE, not difficulty.
 *
 *  That oracle exists to check the ST transpiler, whose input contract is "code CODESYS compiles"
 *  (`src/transpile/index.ts`) — ST. There is no graphical lowering in `src/transpile/` and none planned here, so
 *  a recording of a network's variable values would have no consumer.
 *
 *  It is worth being exact about this, because the mechanical symptom invites a more flattering explanation.
 *  `record:exec` writes declaration and implementation text straight into a POU, so a `NETWORK` header reaches the
 *  compiler verbatim and is answered "';' expected instead of 'FBD'". That LOOKS like an unfinished recorder —
 *  and the ground truth is in fact obtainable, since the BRIDGE turns network text into a real graphical body
 *  and that is how the BUILD recording of these very fixtures was taken. So the honest reason is not "it cannot
 *  be measured"; it is "nothing would read it". If a graphical lowering is ever built, this line is what has to
 *  change first. */
export const NOT_ST = "the exec oracle checks the ST transpiler, which has no graphical lowering — nothing would read it"

/** A graphical FB, instantiated in PLC_PRG — an uninstantiated POU is dead code CODESYS never compiles. */

export function ng(name: string, pouName: string, feature: string, source: string, fromDoc = doc, note?: string): LanguageTest {
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc,
    ...(note === undefined ? {} : { note }),
    source,
    plcPrgVar: `inst : ${pouName};`,
    plcPrgBody: "inst();",
    execSkip: NOT_ST,
    ...(TWINCAT_REFUSES[name] === undefined ? {} : { vendorRefuses: { twincat: TWINCAT_REFUSES[name]! } }),
  }
}

/**
 * The bodies VOLT'S TWINCAT DRIVER refuses, in its own words — as the push gives them (Project13, LCID 1033): an enabled
 * bit operator read through its ENO does not compile as built, TwinCAT never wrote a parallel branch, and a 2R.5 shape no
 * TwinCAT build has measured yet (`TcUnmeasured`). `volt-cli`'s `test/e2e/graphical/stored-shapes.test.ts` holds the same
 * shapes against a LIVE IDE.
 */
export const TWINCAT_REFUSES: Record<string, string | undefined> = {
  network_unnamed_target_behind_enable:
    "TwinCAT: the 'NOT' box has an EN pin, and TwinCAT does not compile an enabled NOT built with only its ENO output (measured: \"__ImpVar not defined\"); the box its editor draws keeps a result slot the text has no position for. Draw it in the IDE, or feed the rung into the box as an input.",
  ng_en_eno_sink:
    "TwinCAT: the 'AND' box has an EN pin, and TwinCAT does not compile an enabled AND built with only its ENO output (measured: \"__ImpVar not defined\"); the box its editor draws keeps a result slot the text has no position for. Draw it in the IDE, or feed the rung into the box as an input.",
  ng_en_eno_named_wire:
    "TwinCAT: the 'OR' box has an EN pin, and TwinCAT does not compile an enabled OR built with only its ENO output (measured: \"__ImpVar not defined\"); the box its editor draws keeps a result slot the text has no position for. Draw it in the IDE, or feed the rung into the box as an input.",
  ng_r5_split_before_definition:
    "TwinCAT: network 1 is built and holds a wire referenced above its definition, which no TwinCAT build has been measured for (stored, reloaded, built and pulled back), so Volt does not write it by a guess. The IDE can make this change.",
  ng_r5_split_nested:
    "TwinCAT: network 1 is built and holds a wire defined below the top level, which no TwinCAT build has been measured for (stored, reloaded, built and pulled back), so Volt does not write it by a guess. The IDE can make this change.",
  ng_r5_empty_branch:
    "TwinCAT: this network holds a parallel branch (`BRANCH(FEED := feed, a, b)`), and TwinCAT has never been seen to write one: its own importer lowers parallel contacts to an OR box (the native corpus, Vn_ld_parallel*), and the editor cannot be driven to draw one, so there is no TwinCAT-written BoxTreeParallel to build it from. Draw it in the IDE.",
}
