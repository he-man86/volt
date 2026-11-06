/**
 * the fixtures of `network-graphical.ts` — part C: the readability checks of openspec ld-fbd-coverage 2R.1. C3 asks
 * whether an IDE holds an operator box with THREE inputs where the operator takes two (SUB, DIV, MOD, every
 * comparison): `SUB(j, k, m)` is one SUB box with three inputs. One fixture per such operator, each pushed through the
 * bridge and built: the push stores the box and the BUILD refuses every one — "'-' needs exactly '2' operands" (the
 * vendor names the symbol, `'/'`, `'MOD'`, `'>'`, …) — and no corpus holds one (0 of 74 such boxes, 388 + 6 networks).
 */
import type { LanguageTest } from "../../types.js"
import { ng } from "./network-graphical-shared.js"

const naryDoc = "network-text.html#elements"

/** A FUNCTION_BLOCK with INT operands and an INT and a BOOL result, one network holding `statement`. */
function threeFb(name: string, statement: string): string {
  return (
    `FUNCTION_BLOCK ${name}\nVAR\n\tj : INT := 7;\n\tk : INT := 3;\n\tm : INT := 2;\n\ti : INT;\n\tout : BOOL;\nEND_VAR\n\n` +
    `%LANGUAGE FBD\n%NETWORK\n${statement}\n\nEND_FUNCTION_BLOCK\n`
  )
}

/** [fixture suffix, operator box, group statement]. */
const THREE: readonly [string, string, string][] = [
  ["sub", "SUB", "ASSIGN(SUB(j, k, m), Q => i);"],
  ["div", "DIV", "ASSIGN(DIV(j, k, m), Q => i);"],
  ["mod", "MOD", "ASSIGN(MOD(j, k, m), Q => i);"],
  ["gt", "GT", "ASSIGN(GT(j, k, m), Q => out);"],
  ["ge", "GE", "ASSIGN(GE(j, k, m), Q => out);"],
  ["lt", "LT", "ASSIGN(LT(j, k, m), Q => out);"],
  ["le", "LE", "ASSIGN(LE(j, k, m), Q => out);"],
  ["eq", "EQ", "ASSIGN(EQ(j, k, m), Q => out);"],
  ["ne", "NE", "ASSIGN(NE(j, k, m), Q => out);"],
]

export const NETWORK_GRAPHICAL_TESTS_C: readonly LanguageTest[] = THREE.map(([suffix, box, statement]) => {
  const pou = `FB_NG_r1_${suffix}3`
  return ng(`ng_r1_${suffix}_three_inputs`, pou, `C3: one ${box} box with three inputs, which the build refuses`,
    threeFb(pou, statement), naryDoc)
})
