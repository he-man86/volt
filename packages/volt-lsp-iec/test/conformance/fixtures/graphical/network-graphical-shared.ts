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
/** Volt's push refusing an operator box with EN read through its ENO, its value wired nowhere (X3, v2-measurements 3c: it
 *  stores and does not build — the recordings of the shape fail on both vendors) — the shared validator's words. */
export const x3 = (box: string): string =>
  `NETWORK_UNSUPPORTED: an operator box read through its ENO with no output wired: the '${box}' box is read through its ENO and writes its value nowhere: it stores and does not build (X3) — wire it, \`=> t\`. — Volt's push, before the IDE is asked (2R.6b)`

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
 * The bodies VOLT'S TWINCAT DRIVER refuses, in its own words — as the push gives them, re-recorded 2026-10-17 (Project13,
 * LCID 1033) after the native archive writer replaced TwinCAT's PLCopen import (openspec twincat-inproc-host). Every
 * shape the import refused or reshaped and the writer builds left this list with a TwinCAT recording (an output pin, an
 * Execute box, a nested assignment, a leaf-fed split, a SUPER^ call, a result pin, a nested jump, a named ENO, an array
 * element's call, …). What stays is refused by the native builder for a reason of its own — an enabled bit operator
 * read through ENO does not compile as built, this reader cannot read a pin's InputFlags back, TwinCAT never wrote a
 * parallel branch — or is a 2R.5 shape no TwinCAT build has measured yet (`TcUnmeasured`). `volt-cli`'s
 * `test/e2e/graphical/stored-shapes.test.ts` holds the same shapes against a LIVE IDE.
 */
export const TWINCAT_REFUSES: Record<string, string | undefined> = {
  ng_s6_negated_pin:
    "TwinCAT: the 'AND' box carries a modifier on its input pin (positional), which TwinCAT keeps in the box's InputFlags — a member this vendor's reader cannot read back (TcNetworkReader refuses a populated InputFlags), so the next pull could not show it. Put the modifier on what feeds the pin.",
  ng_s6_negated_int_pin:
    "TwinCAT: the 'ADD' box carries a modifier on its input pin (positional), which TwinCAT keeps in the box's InputFlags — a member this vendor's reader cannot read back (TcNetworkReader refuses a populated InputFlags), so the next pull could not show it. Put the modifier on what feeds the pin.",
  ng_r5_coil_and_jump:
    "TwinCAT: network 1 is built and holds a jump or a return beside another coil on one rung, which no TwinCAT build has been measured for (stored, reloaded, built and pulled back), so Volt does not write it by a guess. The IDE can make this change.",
  ng_r5_coil_and_return:
    "TwinCAT: network 1 is built and holds a jump or a return beside another coil on one rung, which no TwinCAT build has been measured for (stored, reloaded, built and pulled back), so Volt does not write it by a guess. The IDE can make this change.",
  ng_r5_two_jumps:
    "TwinCAT: network 1 is built and holds a jump or a return beside another coil on one rung, which no TwinCAT build has been measured for (stored, reloaded, built and pulled back), so Volt does not write it by a guess. The IDE can make this change.",
  ng_r5_jump_set:
    "TwinCAT: network 1 is built and holds a jump or a return with S= or R=, which no TwinCAT build has been measured for (stored, reloaded, built and pulled back), so Volt does not write it by a guess. The IDE can make this change.",
  ng_r5_return_set:
    "TwinCAT: network 1 is built and holds a jump or a return with S= or R=, which no TwinCAT build has been measured for (stored, reloaded, built and pulled back), so Volt does not write it by a guess. The IDE can make this change.",
  ng_r5_negated_coil:
    "TwinCAT: network 1 is built and holds a negated coil on 'x', which no TwinCAT build has been measured for (stored, reloaded, built and pulled back), so Volt does not write it by a guess. The IDE can make this change.",
  ng_r5_edge_coils:
    "TwinCAT: network 1 is built and holds an edge coil on 'x', which no TwinCAT build has been measured for (stored, reloaded, built and pulled back), so Volt does not write it by a guess. The IDE can make this change.",
  ng_r5_edge_pin:
    "TwinCAT: the 'AND' box carries a modifier on its input pin (positional), which TwinCAT keeps in the box's InputFlags — a member this vendor's reader cannot read back (TcNetworkReader refuses a populated InputFlags), so the next pull could not show it. Put the modifier on what feeds the pin.",
  ng_r5_negated_en:
    "TwinCAT: network 1 is built and holds a modifier on the EN pin of the 'MOVE' box, which no TwinCAT build has been measured for (stored, reloaded, built and pulled back), so Volt does not write it by a guess. The IDE can make this change.",
  ng_r5_negated_empty:
    "TwinCAT: network 1 is built and holds a negated empty slot, which no TwinCAT build has been measured for (stored, reloaded, built and pulled back), so Volt does not write it by a guess. The IDE can make this change.",
  ng_r5_split_before_definition:
    "TwinCAT: network 1 is built and holds the split split1 referenced above its definition, which no TwinCAT build has been measured for (stored, reloaded, built and pulled back), so Volt does not write it by a guess. The IDE can make this change.",
  ng_r5_split_nested:
    "TwinCAT: network 1 is built and holds the split split1 defined below the top level, which no TwinCAT build has been measured for (stored, reloaded, built and pulled back), so Volt does not write it by a guess. The IDE can make this change.",
  ng_r5_empty_branch:
    "TwinCAT: this network holds a parallel branch (`feed BRANCH (a, b)`), and TwinCAT has never been seen to write one: its own importer lowers parallel contacts to an OR box (the native corpus, Vn_ld_parallel*), and the editor cannot be driven to draw one, so there is no TwinCAT-written BoxTreeParallel to build it from. Draw it in the IDE.",
}
