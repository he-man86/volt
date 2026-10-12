/**
 * The QUICK-FIX PAIRS' shared shape (openspec lsp-quick-fixes design.md §3, §7). A BEFORE is a fixture that reports the
 * finding; each AFTER is the BEFORE's text with exactly one action's edits applied, written out in full and recorded, so
 * its build says whether the compiler accepts the fix. `src/services/assist/code-actions.test.ts` holds each AFTER to the
 * action byte for byte.
 *
 * EVERY NAME A FIXTURE DECLARES CARRIES ITS FIXTURE'S NAME (`FB_LANG_<name>`, `F_LANG_<name>_half`, `g_<name>`…): the
 * replay binds every fixture into one project, and a BEFORE and its AFTER declaring the same function block would be
 * a duplicate there. The action test replaces the BEFORE's fixture name by the AFTER's before comparing, which is the
 * one difference this convention allows. So each source below is written as a function of its fixture's name `n`.
 */
import type { LanguageTest } from "../../types.js"

export const DOC = "openspec lsp-quick-fixes design.md §3 — a quick fix's BEFORE and the AFTER the compiler must accept"

type Extra = Partial<Omit<LanguageTest, "name" | "source" | "feature">>

/** A fixture whose function block `FB_LANG_<name>` PLC_PRG instances and calls (TwinCAT analyzes only what is reached). */
export function fb(name: string, feature: string, source: (n: string) => string, extra: Extra = {}): LanguageTest {
  return {
    name,
    pouName: `FB_LANG_${name}`,
    kind: "function_block",
    feature,
    fromDoc: DOC,
    source: source(name),
    plcPrgVar: `inst_${name} : FB_LANG_${name};`,
    plcPrgBody: `inst_${name}();`,
    ...extra,
  }
}

/** A fixture whose function block is ABSTRACT (or may become so): PLC_PRG holds only a POINTER to it, never an instance. */
export function abstractFb(name: string, feature: string, source: (n: string) => string): LanguageTest {
  const { plcPrgBody: _body, ...t } = fb(name, feature, source, { plcPrgVar: `p_${name} : POINTER TO FB_LANG_${name};` })
  return t
}

/** The fixture `t` as the AFTER of `fixOf.before` for the action titled `fixOf.title`. */
export function after(t: LanguageTest, fixOf: NonNullable<LanguageTest["fixOf"]>): LanguageTest {
  return { ...t, fixOf }
}

/** Two global lists kept apart by a STRUCT (two VAR_GLOBAL blocks back to back are ONE list — `names/scopes.ts`). */
export function twoLists(n: string, first: string, second: string): string {
  return `VAR_GLOBAL\n${first}\nEND_VAR\n\nTYPE DUT_LANG_${n}_sep :\nSTRUCT\n\tv : INT;\nEND_STRUCT\nEND_TYPE\n\nVAR_GLOBAL\n${second}\nEND_VAR\n\n`
}
