/**
 * the fixtures of `network-graphical.ts` — part C: the readability checks of openspec ld-fbd-coverage 2R.1. C3 asks
 * whether an IDE holds an operator box with THREE inputs where the operator takes two (SUB, DIV, MOD, every
 * comparison): one word is one box with an input per operand (B1, `ng_group_nary`), so `j SUB k SUB m` is
 * one SUB box with three inputs. One fixture per such operator, each pushed
 * through the bridge and built. Recorded (CODESYS SP21, 2026-10-16): the push stores the box and the BUILD refuses
 * every one — "'-' needs exactly '2' operands" (the vendor names the symbol, `'/'`, `'MOD'`, `'>'`, …) — and no corpus
 * holds one (0 of 74 such boxes, 388 + 6 networks). So B1's guard ("SUB takes 2 inputs") is the compiler's own rule,
 * and since 2R.3 Volt's push and the LSP refuse the text first (NETWORK_UNSUPPORTED, the shared case set's
 * `three-input-*`): each fixture carries `vendorRefuses` on both vendors, and the build is never asked.
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
  ["sub", "SUB", "i := j SUB k SUB m;"],
  ["div", "DIV", "i := j DIV k DIV m;"],
  ["mod", "MOD", "i := j MOD k MOD m;"],
  ["gt", "GT", "out := j GT k GT m;"],
  ["ge", "GE", "out := j GE k GE m;"],
  ["lt", "LT", "out := j LT k LT m;"],
  ["le", "LE", "out := j LE k LE m;"],
  ["eq", "EQ", "out := j EQ k EQ m;"],
  ["ne", "NE", "out := j NE k NE m;"],
]

/** Volt's push refusing a three-input `box` — the reader's NETWORK_UNSUPPORTED, before the IDE is asked (B1). */
const twoInputs = (box: string): string =>
  `NETWORK_UNSUPPORTED: a two input operator box with more inputs: the '${box}' box holds 3 inputs, and ${box} takes two (the build refuses it: "needs exactly '2' operands", X13) — Volt's push, before the IDE is asked (2R.6b)`

export const NETWORK_GRAPHICAL_TESTS_C: readonly LanguageTest[] = THREE.map(([suffix, box, statement]) => {
  const pou = `FB_NG_r1_${suffix}3`
  return {
    ...ng(`ng_r1_${suffix}_three_inputs`, pou,
      `C3: one ${box} box with three inputs — one word repeated over a non-associative operator`,
      threeFb(pou, statement), naryDoc),
    // CODESYS refused the build ("'<op>' needs exactly '2' operands", recorded 2026-10-16); since 2R.3 the push refuses
    // the text before either IDE is asked (B1), in the words the LSP gives while typing.
    vendorRefuses: { codesys: twoInputs(box), twincat: twoInputs(box) },
  }
})
