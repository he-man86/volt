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
  // ld-fbd-coverage 2R.4: the same output-pin lowering, on an enabled FUNCTION call (recorded 2026-10-17).
  ng_m_function_enabled:
    "TwinCAT: this graphical body writes a box's output pin straight to a variable (`F_NG_m_split(… doubled => …)`). Volt has no way to CREATE that through PLCopen — the importer lowers the wire to a SEPARATE assignment however the pin is declared, so the body that came back would not be the one pushed. The IDE can draw the pin; editing one that already exists works.",
  // ld-fbd-coverage 2R.4 gate: a LIBRARY function's box read through ENO with no EN (recorded 2026-10-17, Project13).
  ng_m_library_function_eno:
    "TwinCAT: the text reads the 'LEN' box through ENO (an open line a later ENO takes, B4), and the IDE builds that box with no ENO output — ENO names an output the box does not have. Read as a value, the text matches the box the IDE builds.",
  ng_m_library_function_qualified_eno:
    "TwinCAT: the text reads the 'Standard.LEN' box through ENO (an open line a later ENO takes, B4), and the IDE builds that box with no ENO output — ENO names an output the box does not have. Read as a value, the text matches the box the IDE builds.",
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
  // ld-fbd-coverage 2R.5 (recorded 2026-10-17, Project13 LCID 1033): every shape the step spells but one is refused by
  // Volt's TwinCAT driver before its PLCopen import (`TcUnmeasured`, the lowering's C20 output-pin refusal) — not by the
  // IDE. Its TwinCAT store/build/reload/editor measurement is the native archive writer's (openspec twincat-inproc-host,
  // DIALECT N40 there), which replaces the import; until then CODESYS holds the ground truth.
  ...Object.fromEntries(
    (
      [
        ["ng_r5_two_eno", "the result pin `=> i` of the 'MOVE' box"],
        ["ng_r5_coil_and_jump", "a jump or a return beside another coil on one rung"],
        ["ng_r5_coil_and_return", "a jump or a return beside another coil on one rung"],
        ["ng_r5_two_jumps", "a jump or a return beside another coil on one rung"],
        ["ng_r5_jump_set", "a jump or a return with S= or R="],
        ["ng_r5_return_set", "a jump or a return with S= or R="],
        ["ng_r5_nested_jump", "an assignment to 'Done' below the top level"],
        ["ng_r5_negated_coil", "a negated coil on 'x'"],
        ["ng_r5_edge_coils", "an edge coil on 'x'"],
        ["ng_r5_edge_pin", "an edge on an input pin (input 0) of the 'AND' box"],
        ["ng_r5_negated_en", "a modifier on the EN pin of the 'MOVE' box"],
        ["ng_r5_negated_empty", "a negated empty slot"],
        ["ng_r5_split_before_definition", "the split split1 referenced above its definition"],
        ["ng_r5_split_nested", "the split split1 defined below the top level"],
        ["ng_r5_comparison_eno", "the result pin `=> x` of the 'GT' box"],
        ["ng_r5_named_eno", "the result pin `=> i` of the 'MOVE' box"],
        ["ng_r5_empty_branch", "a parallel branch (`feed BRANCH (a, b)`)"],
      ] as const
    ).map(([name, shape]) => [
      name,
      `TwinCAT: network 1 changes shape and holds ${shape}. Volt rebuilds a changed network through TwinCAT's PLCopen import, which is not measured for that shape, so the push is refused before the import (2R.5, 2026-10-17).`,
    ]),
  ),
  ng_r5_array_instance:
    "TwinCAT: this graphical body writes a box's output pin straight to a variable (`CTU(… CV => …)`). Volt has no way to CREATE that through PLCopen — the importer lowers the wire to a SEPARATE assignment however the pin is declared (2R.5, 2026-10-17).",
}
