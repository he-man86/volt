/**
 * the fixtures of `network-graphical.ts` — part E: the shapes openspec ld-fbd-coverage 2R.5 spells because the IDE stores
 * them and they RUN (owner, 2026-10-16: "if it is possible then we should be able to encode and decode it"; the drawing
 * does not decide, zero in the corpora does not decide). Each row of `awkward-sweep.md` measured on CODESYS SP21 — stored
 * by a native-archive edit, built clean and run in simulation — and one fixture here, pushed through the bridge and
 * built: two ENOs into one box (#1), a jump beside a coil (#9), a return beside a coil (#10), two jumps on one rung (#11),
 * a nested jump, an edge on a box input pin (#15), a negated EN pin (#16), an element of an array of FBs as a call head
 * (#17), a wire referenced above its definition (#19) and one defined below the top level (#20), a comparison read
 * through its ENO (#22), the named ENO pin beside a data output (#23), an enabled comparison read as a value (#26), a
 * branch of a parallel that is the rail, and an operator box with one input (#4: it stores, and the build refuses it).
 */
import type { LanguageTest } from "../../types.js"
import { ng } from "./network-graphical-shared.js"

const r5Doc = "network-text.html"

/** A FUNCTION_BLOCK holding `networks` (each a network's code) in `lang`, with every variable the rows reference. */
function r5Fb(name: string, lang: "LD" | "FBD", networks: readonly string[], vars = ""): string {
  const body = networks.map((n) => `%NETWORK\n${n}\n`).join("")
  return (
    `FUNCTION_BLOCK ${name}\nVAR\n\tc : BOOL;\n\td : BOOL;\n\tone : BOOL := TRUE;\n\tx : BOOL;\n\tx1 : BOOL;\n\ty : BOOL;\n` +
    `\tlamp : BOOL;\n\ta : BOOL;\n\tb : BOOL;\n\ti : INT;\n\tj : INT;\n\tv : INT := 50;\n${vars}END_VAR\n\n` +
    `%LANGUAGE ${lang}\n${body}\nEND_FUNCTION_BLOCK\n`
  )
}

/** A network carrying the label `l`, the destination a jump names. */
const labelled = (l: string): string => `${l}:\ny := TRUE;`

export const NETWORK_GRAPHICAL_TESTS_E: readonly LanguageTest[] = [
  ng("ng_r5_two_eno", "FB_NG_r5_two_eno", "2R.5 #1: one box consuming two ENOs — each an enabled call",
    r5Fb("FB_NG_r5_two_eno", "LD", ["x := MOVE(EN := c, 1, OUT => i).ENO AND MOVE(EN := d, 2, OUT => j).ENO;"]), r5Doc),
  ng("ng_r5_coil_and_jump", "FB_NG_r5_coil_jump", "2R.5 #9: one rung drives a coil and a jump — `x1 := c; JMP.Done := c;`",
    r5Fb("FB_NG_r5_coil_jump", "LD", ["x1 := c;\nJMP.Done := c;", "x := TRUE;", labelled("Done")]), r5Doc),
  ng("ng_r5_coil_and_return", "FB_NG_r5_coil_ret", "2R.5 #10: a coil and a return on one rung — `x1 := c; RETURN := c;`",
    r5Fb("FB_NG_r5_coil_ret", "LD", ["x1 := c;\nRETURN := c;", "x := TRUE;"]), r5Doc),
  ng("ng_r5_two_jumps", "FB_NG_r5_two_jumps", "2R.5 #11: two jumps on one rung, in stored order — the first taken wins",
    r5Fb("FB_NG_r5_two_jumps", "LD", ["JMP.L1 := c;\nJMP.L2 := c;", "x := TRUE;", labelled("L1"), labelled("L2")]), r5Doc),
  ng("ng_r5_nested_jump", "FB_NG_r5_nested_jump", "2R.5: a jump inside a tree hands its value on — `x := JMP.Done := c;`",
    r5Fb("FB_NG_r5_nested_jump", "LD", ["x := JMP.Done := c;", "x1 := TRUE;", labelled("Done")]), r5Doc),
  ng("ng_r5_edge_pin", "FB_NG_r5_edge_pin", "2R.5 #15: an edge on a box input pin — `AND(RISING(c), one)`",
    r5Fb("FB_NG_r5_edge_pin", "FBD", ["x := AND(RISING(c), one);"]), r5Doc),
  ng("ng_r5_negated_en", "FB_NG_r5_neg_en", "2R.5 #16: a negated EN pin — `MOVE(EN := NOT c, 5, OUT => i).ENO`",
    r5Fb("FB_NG_r5_neg_en", "FBD", ["MOVE(EN := NOT c, 5, OUT => i).ENO;"]), r5Doc),
  ng("ng_r5_array_instance", "FB_NG_r5_array_fb", "2R.5 #17: a call head is any variable reference — an element of an array of FBs",
    r5Fb("FB_NG_r5_array_fb", "FBD", ["fbs[1](CU := c, PV := 10, CV => w);"], "\tfbs : ARRAY [1..2] OF CTU;\n\tw : WORD;\n"), r5Doc),
  ng("ng_r5_split_before_definition", "FB_NG_r5_split_before", "2R.5 #19: a wire referenced above its definition — the stored order, read the previous scan",
    r5Fb("FB_NG_r5_split_before", "LD", ["VAR w1 : ANY; END_VAR\nx := w1;\nw1 := a AND b;\ny := w1 AND c;"]), r5Doc),
  ng("ng_r5_split_nested", "FB_NG_r5_split_nested", "2R.5 #20: a wire defined below the top level, as a nested assignment",
    r5Fb("FB_NG_r5_split_nested", "LD", ["VAR w1 : ANY; END_VAR\nx := (w1 := a AND b);\ny := w1 AND c;"]), r5Doc),
  ng("ng_r5_comparison_eno", "FB_NG_r5_cmp_eno", "2R.5 #22: a comparison is a box like any other — enabled, read through its ENO",
    r5Fb("FB_NG_r5_cmp_eno", "LD", ["lamp := GT(EN := c, v, 5, OUT => x).ENO;"]), r5Doc),
  ng("ng_r5_named_eno", "FB_NG_r5_named_eno", "2R.5 #23: the wired ENO pin beside a data output — `MOVE(EN := c, 7, ENO => lamp, OUT => i).ENO`",
    r5Fb("FB_NG_r5_named_eno", "FBD", ["MOVE(EN := c, 7, ENO => lamp, OUT => i).ENO;"]), r5Doc),
  ng("ng_r5_empty_branch", "FB_NG_r5_empty_branch", "a branch of a parallel that is the rail — `BRANCH(FEED := c, a, TRUE)`",
    r5Fb("FB_NG_r5_empty_branch", "LD", ["x := BRANCH(FEED := c, a, TRUE);", "y := BRANCH(FEED := c, a, TRUE, b);"]), r5Doc),
  ng("ng_r5_one_input_add", "FB_NG_r5_one_add", "2R.5 #4: an ADD box with one input — `ADD(i)`, which the build refuses",
    r5Fb("FB_NG_r5_one_add", "FBD", ["j := ADD(i);"]), r5Doc),
  ng("ng_r5_one_input_and", "FB_NG_r5_one_and", "2R.5 #4: an AND box with one input — `AND(a)`, which the build refuses",
    r5Fb("FB_NG_r5_one_and", "FBD", ["x := AND(a);"]), r5Doc),
  ng("ng_r5_enabled_comparison_value", "FB_NG_r5_cmp_value", "2R.5 #26: an enabled comparison read as a value — `GT(EN := c, v, 40)`",
    r5Fb("FB_NG_r5_cmp_value", "FBD", ["x := AND(a, GT(EN := c, v, 40));"]), r5Doc),
]
