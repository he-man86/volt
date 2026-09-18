/**
 * `__XINT`, `__UXINT`, `__XWORD` — the three primitives the analyzer does not know exist.
 *
 * They are in the vendor's own Elementary group (`docs/codesys-reference/06-data-types.md`) and NOT in
 * `src/types/elementary.ts`, so `elementaryType("__XINT")` is undefined and every check that gates on `checkable()`
 * skips them without a word. The transpiler handles them; the analyzer does not.
 *
 * ADDING THEM IS NOT A ONE-LINE FIX, which is why this exists instead of a guess. They are compile-time aliases
 * resolved by TARGET WIDTH — DINT/LINT, UDINT/ULINT, DWORD/LWORD — and the LSP analyses source without knowing the
 * target. `types/primitive-default.ts` measured that the EXEC ORACLE is 64-bit (`__XINT` reads back `LINT#0`), which
 * settles what our recordings mean but not what the analyzer should say about a project built for a 32-bit PLC.
 *
 * So these ask the compiler what it thinks they ARE, in the only way that makes it say so out loud:
 *
 *   into a STRING            names the type, the `unary-operand.ts` trick
 *   into DINT and into LINT  says which one is a narrowing and which is exact
 *   SIZEOF                   the width in bytes, independent of any message wording
 *   meeting a DINT           whether the meet is the alias or the resolved type
 *
 * Whatever comes back is a fact about a 64-bit target. A 32-bit one is a different recording and Volt has no such
 * device — which is itself worth knowing before the type table pretends otherwise.
 */
import type { LanguageTest } from "../../types.js"

function probe(slug: string, decls: string, setup: string, expr: string, outType: string, feature: string): LanguageTest {
  const pou = `FB_LANG_${slug}`
  return {
    name: slug,
    pouName: pou,
    kind: "function_block" as const,
    feature,
    fromDoc: "06-data-types.md",
    plcPrgVar: `inst : ${pou};`,
    plcPrgBody: "inst();",
    source:
      `FUNCTION_BLOCK ${pou}\nVAR\n${decls}\n\tout : ${outType};\nEND_VAR\n${setup}\nout := ${expr};\nEND_FUNCTION_BLOCK\n`,
  }
}

const TYPES: readonly [string, string][] = [
  ["__XINT", "xint"],
  ["__UXINT", "uxint"],
  ["__XWORD", "xword"],
]

export const PLATFORM_INTEGER_TESTS: readonly LanguageTest[] = TYPES.flatMap(([t, slug]) => [
  probe(
    `plat_${slug}_into_string`,
    `\ta : ${t};`,
    "a := 5;",
    "a",
    "STRING",
    `${t} assigned into a STRING — the compiler must name what it resolved to`,
  ),
  probe(
    `plat_${slug}_into_dint`,
    `\ta : ${t};`,
    "a := 5;",
    "a",
    "DINT",
    `${t} into a DINT — exact on a 32-bit target, a narrowing on a 64-bit one`,
  ),
  probe(
    `plat_${slug}_into_lint`,
    `\ta : ${t};`,
    "a := 5;",
    "a",
    "LINT",
    `${t} into a LINT — exact on a 64-bit target`,
  ),
  probe(
    `plat_${slug}_sizeof`,
    `\ta : ${t};`,
    "a := 5;",
    "SIZEOF(a)",
    "UDINT",
    `SIZEOF(${t}) — the width in bytes, with no message to interpret`,
  ),
  probe(
    `plat_${slug}_meet_dint`,
    `\ta : ${t};\n\tb : DINT;`,
    "a := 6;\nb := 3;",
    "a + b",
    "STRING",
    `${t} + DINT — does the meet name the alias or what it resolved to?`,
  ),
  probe(
    `plat_${slug}_at_max`,
    `\ta : ${t};`,
    "a := 5;",
    "a",
    t,
    `${t} round-tripped through itself — the baseline that must always work`,
  ),
])
