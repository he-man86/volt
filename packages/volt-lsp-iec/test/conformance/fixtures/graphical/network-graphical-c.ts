/**
 * the fixtures of `network-graphical.ts` — part C: the readability checks of openspec ld-fbd-coverage 2R.1. C3 asks
 * whether an IDE holds an operator box with THREE inputs where the operator takes two (SUB, DIV, MOD, every
 * comparison): today's text spells one operator repeated in a group as ONE box with an input per operand
 * (`ng_group_nary`), so `(j - k - m)` is one SUB box with three inputs. One fixture per such operator, each pushed
 * through the bridge and built. Recorded (CODESYS SP21, 2026-10-16): the push stores the box and the BUILD refuses
 * every one — "'-' needs exactly '2' operands" (the vendor names the symbol, `'/'`, `'MOD'`, `'>'`, …) — and no corpus
 * holds one (0 of 74 such boxes, 388 + 6 networks). So B1's guard ("SUB takes 2 inputs") is the compiler's own rule;
 * today's push and LSP accept it — each fixture carries `deferred.lsp` (an expected failure) until 2R.3 lands the
 * guard, and these sources move to B1's words then.
 */
import type { LanguageTest } from "../../types.js"
import { ng } from "./network-graphical-shared.js"

const naryDoc = "network-text.html#operator-group--operand-op-operand-op-operand-"

/** A FUNCTION_BLOCK with INT operands and an INT and a BOOL result, one network holding `statement`. */
function threeFb(name: string, statement: string): string {
  return (
    `FUNCTION_BLOCK ${name}\nVAR\n\tj : INT := 7;\n\tk : INT := 3;\n\tm : INT := 2;\n\ti : INT;\n\tout : BOOL;\nEND_VAR\n\n` +
    `IMPLEMENTATION FBD\nNETWORK\n  ${statement}\nEND_NETWORK\n\nEND_FUNCTION_BLOCK\n`
  )
}

/** [fixture suffix, operator box, group statement]. */
const THREE: readonly [string, string, string][] = [
  ["sub", "SUB", "i := (j - k - m);"],
  ["div", "DIV", "i := (j / k / m);"],
  ["mod", "MOD", "i := (j MOD k MOD m);"],
  ["gt", "GT", "out := (j > k > m);"],
  ["ge", "GE", "out := (j >= k >= m);"],
  ["lt", "LT", "out := (j < k < m);"],
  ["le", "LE", "out := (j <= k <= m);"],
  ["eq", "EQ", "out := (j = k = m);"],
  ["ne", "NE", "out := (j <> k <> m);"],
]

export const NETWORK_GRAPHICAL_TESTS_C: readonly LanguageTest[] = THREE.map(([suffix, box, statement]) => {
  const pou = `FB_NG_r1_${suffix}3`
  return {
    ...ng(`ng_r1_${suffix}_three_inputs`, pou,
      `C3: one ${box} box with three inputs — the group form of a non-associative operator repeated`,
      threeFb(pou, statement), naryDoc),
    // CODESYS refuses the build ("'<op>' needs exactly '2' operands"); the LSP is silent. An expected failure until
    // 2R.3 lands B1's guard (SUB/DIV/MOD/every comparison take two inputs), which ends the mark.
    deferred: {
      lsp:
        "ld-fbd-coverage 2R.3: B1's two-input guard is not written yet — CODESYS refuses the build \"'<op>' needs exactly '2' operands\", the LSP says nothing (0 occurrences in the corpora; 2026-10-16)",
    },
  }
})
