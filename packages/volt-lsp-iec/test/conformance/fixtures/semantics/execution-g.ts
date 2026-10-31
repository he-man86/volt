/**
 * the fixtures of `execution.ts` — part G: JUMPS AND LABELS (openspec lower-jumps-and-labels). What CODESYS runs for an
 * ST `JMP` and its label — forward over statements, backward into a loop a counter ends, out of a loop to a later label —
 * and RETURN; and for a network body's jump and return targets — `JMP.l := v` over a network, `y := JMP.l := v` (the coil
 * written before the jump), `RETURN := v` — and a label across networks.
 */
import { ExecCase } from "./execution-shared.js"

export const CASES_G: readonly ExecCase[] = [
  {
    name: "tr_jmp_forward_skip",
    vars: "a : INT; b : INT; c : INT;",
    body: "a := 1;\nJMP skip;\nb := 2;\nskip:\nc := 3;",
  },
  {
    name: "tr_jmp_backward_counter_loop",
    vars: "n : INT; total : INT;",
    body: "again:\nn := n + 1;\ntotal := total + n;\nIF n < 5 THEN\n\tJMP again;\nEND_IF",
    cycles: 2,
  },
  {
    name: "tr_jmp_out_of_loop_to_later_label",
    vars: "i : INT; k : INT; m : INT; z : INT;",
    body: "FOR i := 1 TO 10 DO\n\tIF i = 3 THEN\n\t\tJMP done;\n\tEND_IF\n\tk := k + 1;\nEND_FOR\nz := 100;\ndone:\nm := i;",
  },
  {
    name: "tr_return_midway",
    vars: "stop : BOOL := TRUE; a : INT; b : INT; c : INT;",
    body: "a := 1;\nJMP over;\nb := 9;\nover:\nIF stop THEN\n\tRETURN;\nEND_IF\nc := 3;",
  },
  {
    name: "nt_jmp_over_network",
    language: "LD",
    vars: "a : BOOL := TRUE; b : BOOL; x : BOOL; y : BOOL; z : BOOL; w : BOOL;",
    body: "%NETWORK\nJMP.skip := a;\n%NETWORK\nx := TRUE;\n%NETWORK\nskip:\ny := TRUE;\n%NETWORK\nJMP.skip2 := b;\n%NETWORK\nz := TRUE;\n%NETWORK\nskip2:\nw := TRUE;",
  },
  {
    name: "nt_coil_written_before_jump",
    language: "LD",
    vars: "a : BOOL := TRUE; y : BOOL; x : BOOL; z : BOOL;",
    body: "%NETWORK\ny := JMP.skip := a;\n%NETWORK\nx := TRUE;\n%NETWORK\nskip:\nz := TRUE;",
  },
  {
    name: "nt_return_on_value",
    language: "LD",
    vars: "a : BOOL := TRUE; y : BOOL; x : BOOL;",
    body: "%NETWORK\ny := TRUE;\n%NETWORK\nRETURN := a;\n%NETWORK\nx := TRUE;",
  },
]
