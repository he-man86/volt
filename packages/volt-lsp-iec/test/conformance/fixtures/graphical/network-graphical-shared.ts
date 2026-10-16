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
 * The bodies VOLT'S TWINCAT DRIVER refuses, in its own words — DOWN TO TWO, from four.
 *
 * <p>The unconditional JMP and the unconditional RETURN left this list on 2026-09-22 by becoming CREATABLE:
 * `TcPlcOpenWriter` wires them to an empty `<inVariable>` so the importer will build them, and
 * `TcNetworkWriter` swaps that operand for a `BoxTreeTerminator` afterwards, reusing its id. Both fixtures have
 * a TwinCAT recording now, and so does `cc_vg_undefined_label` — which is the one that PROVES the point, since
 * it exists to make the compiler say "No such label 'MISSING' within the scope of the JMP statement", and
 * nobody could hear that sentence while the body could not be created.</p>
 *
 * <p>What made it possible was a body DRAWN BY HAND in XAE. The refusal said the importer rejects an
 * unconditional jump, which is TRUE, and it was read as "TwinCAT will not hold one", which is FALSE.</p>
 * — which blame TwinCAT's PLCopen importer, and none
 * of which has been put to the IDE. `volt push` comes
 * back rejected, so these have CODESYS ground truth and none here — and the recorder, the checker and the work
 * list all need to know that rather than counting them as a recording somebody forgot to take — and
 * `volt-cli`'s `test/e2e/graphical/refused-shapes.test.ts` holds the same four shapes as a ratchet against a
 * LIVE IDE, so the day the driver learns one this list is what has to change.
 */
export const TWINCAT_REFUSES: Record<string, string | undefined> = {
  ng_box_output_arrow:
    "TwinCAT's PLCopen importer honours a box output pin wired straight to a variable and then lowers it to a SEPARATE assignment, so the body that came back would not be the one pushed — `volt push` refuses rather than writing a body the IDE would silently change (measured 2026-09-21).",
  ng_execute_box:
    "an Execute box is a TwinCAT construct Volt cannot express as PLCopen; the IDE has to draw it (measured 2026-09-21).",
  // ld-fbd-coverage 2R.3, re-recorded 2026-10-16: the TwinCAT rows of these predate the driver's post-import checks
  // (2026-09-26, `TcEnoRefusal` and the item count), which now refuse each — the build is no longer asked.
  ng_en_eno_sink:
    "TwinCAT: the text reads the 'AND' box through ENO (an open line a later ENO takes, B4), and the IDE builds that box with no ENO output — ENO names an output the box does not have. (Volt's driver, `TcEnoRefusal`, measured 2026-10-16.)",
  ng_coil_storage:
    "TwinCAT: the import builds network 1 as 1 item where the text holds 4 (a split and its three coils), which Volt cannot change through the archive — the create is rolled back (measured 2026-10-16).",
  ng_en_eno_named_wire:
    "TwinCAT: the import builds network 1 as 1 item where the text holds 3 (an ENO split and its two coils), which Volt cannot change through the archive — the create is rolled back (measured 2026-10-16).",
  // ld-fbd-coverage 2.3: shapes TwinCAT's PLCopen import is not measured for, refused by `TcUnmeasured` before it
  // (DIALECT N22, N34–N36; the census-shapes e2e holds the same refusals against a live XAE).
  ng_s2_nested_assign:
    "an assignment to 'out' below the top level: Volt rebuilds a changed network through TwinCAT's PLCopen import, which is not measured for that shape, so the push is refused before the import (2026-10-16).",
  ng_s3a_leaf_wire:
    "the split split1 fed by the leaf 'a': TwinCAT's PLCopen import is not measured for a leaf-fed split (N22), so the push is refused before the import (2026-10-16).",
  ng_s5_super_call:
    "a call of the base FB through SUPER^: TwinCAT's PLCopen import is not measured for it, so the push is refused before the import (2026-10-16).",
  ng_s6_negated_pin:
    "a negated input pin: TwinCAT's PLCopen import is not measured for it, so the push is refused before the import (2026-10-16).",
  // Gate 2-3: the same refusals (TcUnmeasured.RefuseImport), on the fixtures the review added beyond each happy path.
  ng_s2_nested_set_reset:
    "an assignment to 'out' below the top level: Volt rebuilds a changed network through TwinCAT's PLCopen import, which is not measured for that shape, so the push is refused before the import (2026-10-16).",
  ng_s3a_leaf_split_into_int:
    "the split split1 fed by the leaf 'a': TwinCAT's PLCopen import is not measured for a leaf-fed split (N22), so the push is refused before the import (2026-10-16).",
  ng_s6_negated_int_pin:
    "a negated input pin: TwinCAT's PLCopen import is not measured for it, so the push is refused before the import (2026-10-16).",
}
