/**
 * A REFERENCE BOUND AT ITS DECLARATION — `ref_ : REFERENCE TO T REF= x`, which nothing had ever asked the vendor.
 *
 * Every reference fixture in the suite binds with a STATEMENT (`ref_ REF= p;` — `calls/call-shapes.ts`,
 * `cross-object/cross-object.ts`, `types/advanced-type.ts`). The DECLARATION form had no recording at all, and it
 * is not a rare spelling: `ONTIME.fb` declares `refSeconds : REFERENCE TO UDINT REF= udiSeconds`, and 141 corpus
 * POUs reach it — the single largest line in `pointer-order`'s histogram (pointer-model.md §7b).
 *
 * It was ALSO the shape that exposed a parser hole. `var-section.ts` wrote `c.eatPunct(":=") ?? c.eatPunct("REF=")`
 * — it accepted either operator and recorded neither — so the declaration reached lowering as an ordinary
 * assignment (no target bound, every read refused) and reached the FORMATTER as one too (`REF=` printed back as
 * `:=`, silently turning a bind into a store). Both are fixed; this family is what stops the fix resting on
 * composition rather than measurement.
 *
 * WHAT IS ASKED, systematically:
 *   WHERE IT LIVES    a PROGRAM's own frame, an FB field, two instances of that FB
 *   WHAT IT TARGETS   a scalar, a STRUCT, an ARRAY, an FB instance
 *   ORDER             the target declared BEFORE the reference, and AFTER it — `init-sequence.ts` measured that
 *                     initializers run in declaration order and read the DEFAULT from a later one, so binding to
 *                     a later declaration asks that same question of an address rather than a value
 *   LIFETIME          three scans, so "bound once" and "rebound every scan" cannot be confused
 *   REBINDING         a declaration bind then a statement `REF=`, and the same from a METHOD (pointer-model.md §9
 *                     asks whether a METHOD's bind survives to the next scan; this is its declaration half)
 *   THE OPERATOR      `ref_ : REFERENCE TO INT := v` — our parser accepts it and nobody has asked whether CODESYS
 *                     does. If it refuses, so should we; the fix treats only `REF=` as a bind.
 *   VALIDITY          `__ISVALIDREF` on a reference bound at its declaration, beside one never bound
 *
 * Every cell reads its answer back through ORDINARY variables (`readBack`, `writtenBack`), never by monitoring the
 * reference itself: design §9 form 1 ERASES the reference, so its own storage is a marker rather than the pointee,
 * and a fixture that read it would be asking about our representation instead of the vendor's behaviour.
 *
 * WHAT CODESYS ANSWERED, recorded 2026-09-20 — every cell, and three of them changed the implementation:
 *
 *   BOTH SPELLINGS BIND.  `ref_ : REFERENCE TO INT := v` binds exactly as `REF=` does — `refdecl_assign_spelling_
 *                         write` writes 41 through it and reads `v = 41` back. Lowering had keyed the bind on the
 *                         OPERATOR and would have refused a declaration the vendor accepts; the TYPE decides.
 *   ORDER DOES NOT MATTER. `refdecl_target_after` reads 3, the same as `refdecl_target_before` — binding to a
 *                         LATER declaration works, where an initializer VALUE would read the default
 *                         (`init-sequence.ts`). An address does not care what has run yet.
 *   A METHOD'S REBIND STICKS. `refdecl_rebound_in_method` reads 20 after three scans, which answers
 *                         pointer-model.md §9's open question: the new target SURVIVES to the next scan.
 *   __ISVALIDREF          TRUE for a declaration-bound reference, FALSE for one never bound — §9's other
 *                         open question.
 *   AND IT TYPE-CHECKS.   `REF=` to another type is `Cannot convert type 'STRING' to type 'REFERENCE TO INT'`,
 *                         and to an undeclared name adds `Identifier 'nope' not defined`. The LSP was silent on
 *                         both — two gaps these cells found and closed (`checks/types/assignment.ts`).
 *
 * Twelve cells are `confirmed`. The two REBIND cells are `not-lowered` on purpose: a declaration bind plus a later
 * rebind is TWO targets, which is design §9 form 3 and not built — so they are the first measured acceptance tests
 * form 3 has.
 *
 * THE NAMES ARE NOT ACCIDENTAL. The first cut of this family called the reference `r` and the struct `s`, and
 * CODESYS refused 12 of the 13 cells with `Unexpected token 'r'` — `R` and `S` are IL operators and cannot name a
 * variable (`docs/reserved-il-operators.md`, sixteen of them). The recording said so immediately, which is the
 * argument for recording rather than reasoning: every cell would otherwise have been "measured" as a refusal, for
 * a reason that has nothing to do with the question. `ref_` is what the existing reference fixtures use.
 */
import type { LanguageTest } from "../../types.js"

/** A cell inside a FUNCTION_BLOCK — the per-instance storage the corpus shape uses. */
function probe(slug: string, decls: string, body: string, feature: string, cycles = 3): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "06-data-types.md",
    cycles,
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source: `FUNCTION_BLOCK ${pou}\nVAR\n${decls}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** The same question in a PROGRAM's own frame — no instance, so the POU's init step is what has to run it. */
function inProgram(slug: string, decls: string, body: string, feature: string, cycles = 3): LanguageTest {
  return {
    name: slug,
    pouName: `PRG_LANG_${slug}`,
    kind: "program" as const,
    feature,
    fromDoc: "06-data-types.md",
    cycles,
    source: "",
    plcPrgVar: decls,
    plcPrgBody: body,
  }
}

const STRUCT = "TYPE DUT_LANG_refdecl :\nSTRUCT\n\tx : INT;\n\ty : INT;\nEND_STRUCT\nEND_TYPE\n"

export const REFERENCE_BINDING_TESTS: readonly LanguageTest[] = [
  // ─── where it lives ────────────────────────────────────────────────────────────────────────────────────────
  inProgram(
    "refdecl_program_local",
    "\tv : INT := 7;\n\tref_ : REFERENCE TO INT REF= v;\n\treadBack : INT;\n\twrittenBack : INT;",
    "readBack := ref_;\nref_ := 41;\nwrittenBack := v;",
    "a reference bound at its declaration in a PROGRAM's own frame — read through it, then write through it",
    1,
  ),
  probe(
    "refdecl_fb_field",
    "\tv : INT := 7;\n\tref_ : REFERENCE TO INT REF= v;\n\treadBack : INT;\n\twrittenBack : INT;",
    "readBack := ref_;\nref_ := 41;\nwrittenBack := v;",
    "the same as a FUNCTION_BLOCK field, which is laid out per instance",
    1,
  ),
  {
    // TWO INSTANCES: a declaration bind must attach to each instance's OWN field, not to one shared target.
    name: "refdecl_two_instances",
    pouName: "FB_LANG_refdecl_two_instances",
    kind: "function_block" as const,
    feature: "two instances of an FB whose field is bound at its declaration — each must count its own target",
    fromDoc: "06-data-types.md",
    cycles: 1,
    plcPrgVar:
      "instA : FB_LANG_refdecl_two_instances;\n\tinstB : FB_LANG_refdecl_two_instances;\n\taSeen : INT;\n\tbSeen : INT;",
    plcPrgBody: "instA();\ninstA();\ninstB();\naSeen := instA.n;\nbSeen := instB.n;",
    source:
      "FUNCTION_BLOCK FB_LANG_refdecl_two_instances\nVAR\n\tn : INT := 0;\n\tref_ : REFERENCE TO INT REF= n;\nEND_VAR\nref_ := ref_ + 1;\nEND_FUNCTION_BLOCK\n",
  },

  // ─── what it targets ───────────────────────────────────────────────────────────────────────────────────────
  {
    // the TYPE is inlined in this fixture's own source, as `call-shapes.ts` does — an `inProgram` cell has no
    // source of its own to declare it in.
    name: "refdecl_to_struct",
    pouName: "FB_LANG_refdecl_to_struct",
    kind: "function_block" as const,
    feature: "a reference to a STRUCT, bound at its declaration — a member read and a member write",
    fromDoc: "06-data-types.md",
    cycles: 1,
    plcPrgVar: "inst : FB_LANG_refdecl_to_struct;",
    plcPrgBody: "inst();",
    source:
      STRUCT +
      "\nFUNCTION_BLOCK FB_LANG_refdecl_to_struct\nVAR\n\trec : DUT_LANG_refdecl;\n\tref_ : REFERENCE TO DUT_LANG_refdecl REF= rec;\n\treadBack : INT;\n\twrittenBack : INT;\nEND_VAR\nrec.x := 5;\nreadBack := ref_.x;\nref_.y := 8;\nwrittenBack := rec.y;\nEND_FUNCTION_BLOCK\n",
  },
  inProgram(
    "refdecl_to_array",
    "\tarr : ARRAY[0..2] OF INT;\n\tref_ : REFERENCE TO ARRAY[0..2] OF INT REF= arr;\n\treadBack : INT;\n\twrittenBack : INT;",
    "arr[1] := 9;\nreadBack := ref_[1];\nref_[2] := 6;\nwrittenBack := arr[2];",
    "a reference to an ARRAY, bound at its declaration — an element read and an element write",
    1,
  ),
  {
    // an FB instance reached through a reference bound at the declaration, and CALLED through it
    name: "refdecl_to_fb",
    pouName: "FB_LANG_refdecl_to_fb",
    kind: "function_block" as const,
    feature: "a reference to an FB INSTANCE bound at its declaration, then called through",
    fromDoc: "06-data-types.md",
    cycles: 1,
    plcPrgVar: "outer : FB_LANG_refdecl_to_fb;\n\tseen : INT;",
    plcPrgBody: "outer();\nseen := outer.seen;",
    source:
      "FUNCTION_BLOCK FB_LANG_refdecl_counter\nVAR_OUTPUT\n\tcount : INT;\nEND_VAR\ncount := count + 1;\nEND_FUNCTION_BLOCK\n\n" +
      "FUNCTION_BLOCK FB_LANG_refdecl_to_fb\nVAR\n\tinner : FB_LANG_refdecl_counter;\n\tref_ : REFERENCE TO FB_LANG_refdecl_counter REF= inner;\n\tseen : INT;\nEND_VAR\nref_();\nref_();\nseen := inner.count;\nEND_FUNCTION_BLOCK\n",
  },

  // ─── declaration ORDER ─────────────────────────────────────────────────────────────────────────────────────
  inProgram(
    "refdecl_target_before",
    "\tv : INT := 3;\n\tref_ : REFERENCE TO INT REF= v;\n\treadBack : INT;",
    "readBack := ref_;",
    "the target declared BEFORE the reference — the ordinary order, and the baseline for the one below",
    1,
  ),
  // IN AN FB, not a PROGRAM. As `PRG_LANG_*` this recorded "Login failed..." TWICE — the application does not
  // start, which is neither a value nor a compile refusal. `initprg_reads_later` has exactly that signature and
  // exactly that note, and says its FB twin answers; so this asks in the shape that can answer.
  probe(
    "refdecl_target_after",
    "\tref_ : REFERENCE TO INT REF= v;\n\tv : INT := 3;\n\treadBack : INT;",
    "readBack := ref_;",
    "the target declared AFTER the reference — a VALUE reads the default here (`init-sequence.ts`); an ADDRESS may not care",
    1,
  ),

  // ─── lifetime and rebinding ────────────────────────────────────────────────────────────────────────────────
  inProgram(
    "refdecl_survives_scans",
    "\tv : INT := 0;\n\tref_ : REFERENCE TO INT REF= v;\n\tseen : INT;",
    "ref_ := ref_ + 1;\nseen := v;",
    "three scans through a declaration-bound reference — 3 if it binds once, something else if it rebinds per scan",
  ),
  inProgram(
    "refdecl_rebound_by_statement",
    "\tfirst : INT := 1;\n\tsecond : INT := 2;\n\tref_ : REFERENCE TO INT REF= first;\n\tbefore : INT;\n\tafter : INT;",
    "before := ref_;\nref_ REF= second;\nafter := ref_;",
    "bound at the declaration, then rebound by a statement — which target each read sees",
    1,
  ),
  {
    // pointer-model.md §9's open question, asked of the DECLARATION bind: does a METHOD's rebind survive the scan?
    name: "refdecl_rebound_in_method",
    pouName: "FB_LANG_refdecl_rebound_in_method",
    kind: "function_block" as const,
    feature: "a declaration-bound reference rebound by a METHOD — whether the new target survives to the next scan",
    fromDoc: "06-data-types.md",
    cycles: 3,
    plcPrgVar: "inst : FB_LANG_refdecl_rebound_in_method;\n\tseen : INT;",
    plcPrgBody: "inst();\nseen := inst.seen;",
    source:
      "FUNCTION_BLOCK FB_LANG_refdecl_rebound_in_method\nVAR\n\tfirst : INT := 10;\n\tsecond : INT := 20;\n\tref_ : REFERENCE TO INT REF= first;\n\tseen : INT;\n\tdone : BOOL;\nEND_VAR\nIF NOT done THEN\n\tPointAtSecond();\n\tdone := TRUE;\nEND_IF\nseen := ref_;\nEND_FUNCTION_BLOCK\n\n" +
      "METHOD PointAtSecond : BOOL\nref_ REF= second;\nEND_METHOD\n",
  },

  // ─── what the vendor REFUSES, which nothing had asked either ───────────────────────────────────────────────
  // The LSP is silent on both (measured 2026-09-20). Whether that is a gap depends entirely on what CODESYS
  // says, and an LSP-only message is a false positive — so these ask before anything is implemented.
  inProgram(
    "refdecl_target_undeclared",
    "\tref_ : REFERENCE TO INT REF= nope;\n\treadBack : INT;",
    "readBack := ref_;",
    "REF= at a declaration naming something that does not exist — the LSP says nothing; does CODESYS?",
    1,
  ),
  inProgram(
    "refdecl_target_wrong_type",
    "\tv : STRING;\n\tref_ : REFERENCE TO INT REF= v;\n\treadBack : INT;",
    "readBack := ref_;",
    "REF= at a declaration bound to a target of another type — the LSP says nothing; does CODESYS?",
    1,
  ),

  // ─── the operator itself ───────────────────────────────────────────────────────────────────────────────────
  inProgram(
    "refdecl_assign_spelling",
    "\tv : INT := 7;\n\tref_ : REFERENCE TO INT := v;\n\treadBack : INT;",
    "readBack := ref_;",
    "`:=` instead of `REF=` on a REFERENCE declaration — our parser accepts it; does CODESYS, and as what?",
    1,
  ),
  inProgram(
    "refdecl_assign_spelling_write",
    "\tv : INT := 7;\n\tref_ : REFERENCE TO INT := v;\n\twrittenBack : INT;",
    "ref_ := 41;\nwrittenBack := v;",
    "the SAME `:=` spelling, written through — a read alone cannot tell a bind from a declaration that did nothing",
    1,
  ),
  inProgram(
    "refdecl_isvalidref",
    "\tv : INT := 7;\n\tbound : REFERENCE TO INT REF= v;\n\tunbound : REFERENCE TO INT;\n\tboundValid : BOOL;\n\tunboundValid : BOOL;",
    "boundValid := __ISVALIDREF(bound);\nunboundValid := __ISVALIDREF(unbound);",
    "__ISVALIDREF on a reference bound at its declaration, beside one never bound at all",
    1,
  ),
]
