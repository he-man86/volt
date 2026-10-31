/**
 * the fixtures of `network-graphical.ts` — part B: the census shapes network text spells since openspec ld-fbd-coverage
 * 2.3 (S2 an assignment below the top level, S3a/S3b a split fed by a leaf or by the left rail, S5 a call through
 * `SUPER^`, S6 a negated input pin; S1, a box's stored members as pragmas, left with the pragma in 2R.3 — B7) — each the form `test/e2e/graphical/census-shapes.test.ts`
 * round-trips through a live IDE, here against the compiler. TwinCAT refuses S2, S3a, S5 and S6 before its PLCopen
 * import (`TcUnmeasured`, DIALECT N34–N36, N22), so those have CODESYS ground truth only.
 */
import type { LanguageTest } from "../../types.js"
import { ng } from "./network-graphical-shared.js"

/** A FUNCTION_BLOCK wrapping one network body, with the declarations every shape references. */
function shapeFb(name: string, lang: "FBD" | "LD", statements: string, header = `FUNCTION_BLOCK ${name}`): string {
  return (
    `${header}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tgo : BOOL;\n\tout : BOOL;\n\tout2 : BOOL;\n\tt1 : TON;\n\tpt : TIME;\nEND_VAR\n\n` +
    `%LANGUAGE ${lang}\n%NETWORK\n${statements}\n\nEND_FUNCTION_BLOCK\n`
  )
}

export const NETWORK_GRAPHICAL_TESTS_B: readonly LanguageTest[] = [
  ng("ng_s2_nested_assign", "FB_NG_s2", "S2: an assignment below the top level — a coil feeding a box input, its own pair",
    shapeFb("FB_NG_s2", "LD", "t1(IN := (out := go), PT := pt);")),
  ng("ng_s3a_leaf_wire", "FB_NG_s3a", "S3a: a wire fed by a leaf, typed by its feeder",
    shapeFb("FB_NG_s3a", "LD", "VAR w1 : ANY; END_VAR\nw1 := a;\nout := w1 AND b;\nout2 := w1;")),
  ng("ng_s3b_rail_wire", "FB_NG_s3b", "S3b: in LD a wire fed by the left rail, `TRUE`",
    shapeFb("FB_NG_s3b", "LD", "VAR w1 : ANY; END_VAR\nw1 := TRUE;\nout := w1 AND a;\nout2 := w1;")),
  ng("ng_s5_super_call", "FB_NG_s5", "S5: a call of the base FB through `SUPER^` — `SUPER^(x := go)`",
    `FUNCTION_BLOCK FB_NG_s5_base\nVAR_INPUT\n\tx : BOOL;\nEND_VAR\n\nEND_FUNCTION_BLOCK\n\n` +
      shapeFb("FB_NG_s5", "FBD", "SUPER^(x := go);", "FUNCTION_BLOCK FB_NG_s5 EXTENDS FB_NG_s5_base")),
  ng("ng_s6_negated_pin", "FB_NG_s6", "S6: a negated input pin — an operator's and a call's",
    shapeFb("FB_NG_s6", "FBD", "out := AND(a, NOT b);\n%NETWORK\nt1(IN := NOT go, PT := pt);")),
  // Gate 2-3 review: beyond the one happy path per shape — what the compiler says where a statement disagrees with a
  // declaration, and the coil kinds S2 nests.
  ng("ng_s3a_leaf_split_into_int", "FB_NG_s3a_into_int",
    "S3a: a BOOL leaf's wire read where an INT is written — the wire is typed by its feeder, so the build's mismatch",
    intFb("FB_NG_s3a_into_int", "LD", "VAR w1 : ANY; END_VAR\nw1 := a;\ni := w1;")),
  ng("ng_s2_nested_set_reset", "FB_NG_s2_set",
    "S2: a set and a reset coil, and two chained targets, below the top level",
    shapeFb("FB_NG_s2_set", "LD", "t1(IN := (out S= go), PT := pt);\n%NETWORK\nt1(IN := (out R= out2 := a), PT := pt);")),
  {
    ...ng("ng_s6_negated_int_pin", "FB_NG_s6_int",
      "S6: a negated input pin of another type than BOOL — an INT pin of an ADD",
      intFb("FB_NG_s6_int", "FBD", "i := ADD(NOT j, k);")),
    // CODESYS builds it, warning twice that the negated INT pin goes through UINT and back (recorded 2026-10-16).
    deferred: {
      lsp:
        "niche: accepted loss (0 occurrences in the corpora — no negated input pin of any type is drawn in the six) — the LSP says nothing where CODESYS warns \"Implicit conversion from signed Type 'INT' to unsigned Type 'UINT' : Possible change of sign\" and back (2026-10-16)",
    },
  },
]

/** {@link shapeFb} with INT variables beside the BOOL ones. */
function intFb(name: string, lang: "FBD" | "LD", statements: string): string {
  return (
    `FUNCTION_BLOCK ${name}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;\n\ti : INT;\n\tj : INT;\n\tk : INT;\nEND_VAR\n\n` +
    `%LANGUAGE ${lang}\n%NETWORK\n${statements}\n\nEND_FUNCTION_BLOCK\n`
  )
}
