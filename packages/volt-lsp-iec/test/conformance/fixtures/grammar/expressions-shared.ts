/**
 * the helpers `expressions.ts`'s fixtures are built with: the fixture builders and the data they read (openspec
 * lsp-same-standard 4.4: a fixture file is held to 400 lines).
 */
import type { LanguageTest } from "../../types.js"

export const doc = "frontend-conformance design.md §4 2.5 (expressions)"

/** A function block `FB_LANG_<name>` whose VAR section is `vars` and whose body is `body`; `before` (whole units) is
 *  written ahead of it. */
export function fb(name: string, feature: string, vars: string, body: string, before = ""): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source: `${before}FUNCTION_BLOCK ${pouName}\nVAR\n${vars}\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n`,
  }
}

/** INT operands `a`, `b`, `c` holding `va`, `vb`, `vc`, and `out : INT := <expr>`. */
export function ints(name: string, feature: string, [va, vb, vc]: readonly [number, number, number], expr: string): LanguageTest {
  return fb(name, feature, `\ta : INT := ${va};\n\tb : INT := ${vb};\n\tc : INT := ${vc};\n\tout : INT;`, `out := ${expr};`)
}

/** BOOL operands `a`, `b`, `c` holding `va`, `vb`, `vc`, and `out : BOOL := <expr>`. */
export function bools(name: string, feature: string, [va, vb, vc]: readonly [boolean, boolean, boolean], expr: string): LanguageTest {
  const lit = (v: boolean): string => (v ? "TRUE" : "FALSE")
  return fb(name, feature, `\ta : BOOL := ${lit(va)};\n\tb : BOOL := ${lit(vb)};\n\tc : BOOL := ${lit(vc)};\n\tout : BOOL;`,
    `out := ${expr};`)
}

/** A FUNCTION `FUN_LANG_<name> : INT` with inputs `x`, `y` returning `x * INT#10 + y`, written ahead of the FB. */
export function adder(name: string): string {
  return `FUNCTION FUN_LANG_${name} : INT\nVAR_INPUT\n\tx : INT;\n\ty : INT;\nEND_VAR\nFUN_LANG_${name} := x * INT#10 + y;\nEND_FUNCTION\n\n`
}

/** A STRUCT `DUT_LANG_<name>` with one field `v : INT`, written ahead of the FB. */
export function box(name: string): string {
  return `TYPE DUT_LANG_${name} :\nSTRUCT\n\tv : INT := 4;\nEND_STRUCT\nEND_TYPE\n\n`
}

/** `fb` reading member `member` of a `DUT_LANG_<name>` box: `out := bx.<member>;`. */
export function member(name: string, feature: string, memberText: string): LanguageTest {
  return fb(name, feature, `\tbx : DUT_LANG_${name};\n\tout : INT;`, `out := bx.${memberText};`, box(name))
}

/** A function block `FB_LANG_<name>` written whole by the caller (`source`, its methods after it). */
export function fbSource(name: string, feature: string, source: string, extra: Partial<LanguageTest> = {}): LanguageTest {
  const pouName = `FB_LANG_${name}`
  return {
    name,
    pouName,
    kind: "function_block",
    feature,
    fromDoc: doc,
    plcPrgVar: `inst_${name} : ${pouName};`,
    plcPrgBody: `inst_${name}();`,
    source,
    ...extra,
  }
}

/** `fb` with a global variable list `GVL_LANG_<name>` holding `globals` ahead of it (and `before` between them). */
export function withGlobals(name: string, feature: string, globals: string, vars: string, body: string, before = ""): LanguageTest {
  return {
    ...fb(name, feature, vars, body, `VAR_GLOBAL
${globals}
END_VAR

${before}`),
    gvlNames: [`GVL_LANG_${name}`],
  }
}

/** `fb` reading `gAmb`, which two global lists `GVL_LANG_<name>_a` and `_b` declare, a STRUCT between them. */
export function twoLists(name: string, feature: string, body: string): LanguageTest {
  const list = "VAR_GLOBAL\n\tgAmb : INT;\nEND_VAR\n\n"
  return { ...fb(name, feature, "\tout : INT;", body, list + box(name) + list), gvlNames: [`GVL_LANG_${name}_a`, `GVL_LANG_${name}_b`] }
}

/** `withGlobals` whose list is `VAR_GLOBAL CONSTANT`. */
export function withConstGlobals(name: string, feature: string, globals: string, vars: string, body: string, before = ""): LanguageTest {
  const t = withGlobals(name, feature, globals, vars, body, before)
  return { ...t, source: t.source.replace(/^VAR_GLOBAL\n/, "VAR_GLOBAL CONSTANT\n") }
}
