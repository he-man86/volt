/**
 * the fixtures of `network-graphical.ts` — part E: the shapes openspec ld-fbd-coverage 2R.5 spells because the IDE stores
 * them and they RUN (owner, 2026-10-16: "if it is possible then we should be able to encode and decode it"; the drawing
 * does not decide, zero in the corpora does not decide). Each row of `awkward-sweep.md` measured on CODESYS SP21 — stored
 * by a native-archive edit, built clean and run in simulation — gets its spelling from a rule that already exists once
 * its refusal clause went (design "2R.5"), and one fixture here, pushed through the bridge and built: two ENOs into one
 * box (#1), a jump beside a coil (#9), a return beside a coil (#10), two jumps on one rung (#11), a jump and a return
 * with S= (#12), a nested jump, a negated coil (#13), the edge coils (#14), an edge on a box input pin (#15), a negated
 * EN pin (#16), a negated empty slot (#6a), an element of an array of FBs as a call head (#17), a split referenced above
 * its definition (#19) and one defined below the top level (#20), a comparison read through its ENO (#22), the named ENO
 * pin beside a data output (#23), an enabled comparison read as a value (#26) and an empty branch of a parallel
 * (readability Open c, measured by a native-archive edit: it stores, builds and runs as a shorted branch).
 */
import type { LanguageTest } from "../../types.js"
import { ng } from "./network-graphical-shared.js"

const r5Doc = "network-text.html"

/** A FUNCTION_BLOCK holding `networks` (each a body of lines) in `lang`, with every variable the rows reference. */
function r5Fb(name: string, lang: "LD" | "FBD", networks: readonly string[], vars = ""): string {
  const body = networks.map((n) => `NETWORK${n.startsWith(" LABEL:") ? "" : "\n"}${n}\nEND_NETWORK\n`).join("")
  return (
    `FUNCTION_BLOCK ${name}\nVAR\n\tc : BOOL;\n\td : BOOL;\n\tone : BOOL := TRUE;\n\tx : BOOL;\n\tx1 : BOOL;\n\ty : BOOL;\n` +
    `\tlamp : BOOL;\n\ta : BOOL;\n\tb : BOOL;\n\ti : INT;\n\tj : INT;\n\tv : INT := 50;\n${vars}END_VAR\n\n` +
    `IMPLEMENTATION ${lang}\n${body}\nEND_FUNCTION_BLOCK\n`
  )
}

/** A parallel's branches one per line, aligned under the first (P2) — the column after `  x := c BRANCH (`. */
const col17 = " ".repeat(17)

/** Volt's push refusing an operator box with one input — the reader's NETWORK_UNSUPPORTED, before the IDE is asked. */
const oneInput = (box: string): string =>
  `NETWORK_UNSUPPORTED: ${box} takes at least 2 inputs, and this one holds 1: the build refuses it ("needs at least '2' operands") — Volt's push, before the IDE is asked (2R.5)`

/** A network carrying the label `l`, the destination a jump names. */
const labelled = (l: string): string => ` LABEL: ${l}\n  y := TRUE;`

export const NETWORK_GRAPHICAL_TESTS_E: readonly LanguageTest[] = [
  ng("ng_r5_two_eno", "FB_NG_r5_two_eno", "2R.5 #1: one box consuming two ENOs — each ENO takes the oldest open line above it (P3)",
    r5Fb("FB_NG_r5_two_eno", "LD", ["  MOVE 1 => i EN c\n  MOVE 2 => j EN d\n  x := ENO AND ENO;"]), r5Doc),
  ng("ng_r5_coil_and_jump", "FB_NG_r5_coil_jump", "2R.5 #9: a jump is a coil — one rung drives a coil and a jump",
    r5Fb("FB_NG_r5_coil_jump", "LD", ["  x1 := JMP Done := c;", "  x := TRUE;", labelled("Done")]), r5Doc),
  ng("ng_r5_coil_and_return", "FB_NG_r5_coil_ret", "2R.5 #10: a coil and a return on one rung",
    r5Fb("FB_NG_r5_coil_ret", "LD", ["  x1 := RETURN := c;", "  x := TRUE;"]), r5Doc),
  ng("ng_r5_two_jumps", "FB_NG_r5_two_jumps", "2R.5 #11: two jumps on one rung, in stored order — the first taken wins",
    r5Fb("FB_NG_r5_two_jumps", "LD", ["  JMP L1 := JMP L2 := c;", "  x := TRUE;", labelled("L1"), labelled("L2")]), r5Doc),
  ng("ng_r5_jump_set", "FB_NG_r5_jump_set", "2R.5 #12: a jump is a coil, and a coil takes S= — `JMP Done S= c;`",
    r5Fb("FB_NG_r5_jump_set", "LD", ["  JMP Done S= c;", "  x := TRUE;", labelled("Done")]), r5Doc),
  ng("ng_r5_return_set", "FB_NG_r5_return_set", "2R.5: a return is a coil, and a coil takes S= — `RETURN S= c;`",
    r5Fb("FB_NG_r5_return_set", "LD", ["  RETURN S= c;", "  x := TRUE;"]), r5Doc),
  ng("ng_r5_nested_jump", "FB_NG_r5_nested_jump", "2R.5: a jump is a coil, and a coil nests (P4 (3)) — `y := (JMP Done := c);`",
    r5Fb("FB_NG_r5_nested_jump", "LD", ["  x := (JMP Done := c);", "  x1 := TRUE;", labelled("Done")]), r5Doc),
  ng("ng_r5_negated_coil", "FB_NG_r5_neg_coil", "2R.5 #13: a negated coil, its modifier before the target — `NOT x := c;`",
    r5Fb("FB_NG_r5_neg_coil", "LD", ["  NOT x := c;"]), r5Doc),
  ng("ng_r5_edge_coils", "FB_NG_r5_edge_coils", "2R.5 #14: the edge coils — `R_EDGE x := c;`, `F_EDGE x1 := c;`",
    r5Fb("FB_NG_r5_edge_coils", "LD", ["  R_EDGE x := c;", "  F_EDGE x1 := c;"]), r5Doc),
  ng("ng_r5_edge_pin", "FB_NG_r5_edge_pin", "2R.5 #15: an edge on a box input pin, on its formal (P5) — `AND(R_EDGE IN1 := c, one)`",
    r5Fb("FB_NG_r5_edge_pin", "FBD", ["  x := AND(R_EDGE IN1 := c, one);"]), r5Doc),
  ng("ng_r5_negated_en", "FB_NG_r5_neg_en", "2R.5 #16: a negated EN pin, the modifier before the word — `MOVE 5 => i NOT EN c;`",
    r5Fb("FB_NG_r5_neg_en", "FBD", ["  MOVE 5 => i NOT EN c;"]), r5Doc),
  ng("ng_r5_negated_empty", "FB_NG_r5_neg_empty", "2R.5 #6a: a negation on an empty slot — `x := NOT ;`",
    r5Fb("FB_NG_r5_neg_empty", "LD", ["  x := NOT ;"]), r5Doc),
  ng("ng_r5_array_instance", "FB_NG_r5_array_fb", "2R.5 #17: a call head is any variable reference — an element of an array of FBs",
    r5Fb("FB_NG_r5_array_fb", "FBD", ["  `fbs[1]`(CU := c, PV := 10, CV => w);"], "\tfbs : ARRAY [1..2] OF CTU;\n\tw : WORD;\n"), r5Doc),
  ng("ng_r5_split_before_definition", "FB_NG_r5_split_before", "2R.5 #19: a split referenced above its definition — the stored order, read the previous scan",
    r5Fb("FB_NG_r5_split_before", "LD", ["  x := split1;\n  split1 := a AND b;\n  y := split1 AND c;"]), r5Doc),
  ng("ng_r5_split_nested", "FB_NG_r5_split_nested", "2R.5 #20: a split defined below the top level, bracketed as a nested assignment",
    r5Fb("FB_NG_r5_split_nested", "LD", ["  x := (split1 := a AND b);\n  y := split1 AND c;"]), r5Doc),
  ng("ng_r5_comparison_eno", "FB_NG_r5_cmp_eno", "2R.5 #22: a comparison is a box like any other — enabled on an open line, its ENO read below",
    r5Fb("FB_NG_r5_cmp_eno", "LD", ["  v GT 5 => x EN c\n  lamp := ENO;"]), r5Doc),
  ng("ng_r5_named_eno", "FB_NG_r5_named_eno", "2R.5 #23: the named ENO pin beside a data output (P5) — `MOVE(7, ENO => lamp, => i) EN c;`",
    r5Fb("FB_NG_r5_named_eno", "FBD", ["  MOVE(7, ENO => lamp, => i) EN c;"]), r5Doc),
  ng("ng_r5_empty_branch", "FB_NG_r5_empty_branch", "2R.5 (readability Open c): an empty branch of a parallel — it stores, builds and runs as a shorted branch",
    r5Fb("FB_NG_r5_empty_branch", "LD", [`  x := c BRANCH (a,\n${col17});`, `  y := c BRANCH (a,\n${col17},\n${col17}b);`]), r5Doc),
  // What stays refused, with its measurement: an operator box with ONE input (awkward-sweep #4 — it stores, and does not
  // build). Recorded through the push before the refusal existed (2026-10-17, both vendors: "'+' needs at least '2'
  // operands", "'AND' needs at least '2' operands"), then refused by name before the IDE is asked.
  {
    ...ng("ng_r5_one_input_add", "FB_NG_r5_one_add", "2R.5 #4: an ADD box with one input — the call form, `ADD(i)`",
      r5Fb("FB_NG_r5_one_add", "FBD", ["  j := ADD(i);"]), r5Doc),
    vendorRefuses: { codesys: oneInput("ADD"), twincat: oneInput("ADD") },
  },
  {
    ...ng("ng_r5_one_input_and", "FB_NG_r5_one_and", "2R.5 #4: an AND box with one input — the call form, `AND(a)`",
      r5Fb("FB_NG_r5_one_and", "FBD", ["  x := AND(a);"]), r5Doc),
    vendorRefuses: { codesys: oneInput("AND"), twincat: oneInput("AND") },
  },
  ng("ng_r5_enabled_comparison_value", "FB_NG_r5_cmp_value", "2R.5 #26: an enabled comparison read as a value — built as the PLCopen importer builds it (EN, no ENO)",
    r5Fb("FB_NG_r5_cmp_value", "FBD", ["  x := a AND (v GT 40 EN c);"]), r5Doc),
]
