/**
 * F6 — the AMBIGUOUS GLOBAL (C0136, design.md §4 F6): a bare name two global lists declare, qualified with each list's
 * name. Which list was meant is the user's to say, so neither option is `preferred`.
 */
import type { LanguageTest } from "../../types.js"
import { after, fb, twoLists } from "./shared.js"

const source = (n: string, use: string): string =>
  `${twoLists(n, `\tg_${n} : INT := 3;`, `\tg_${n} : INT := 5;`)}FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\tout : INT;\nEND_VAR\nout := ${use};\nEND_FUNCTION_BLOCK\n`
const lists = (n: string): { gvlNames: string[] } => ({ gvlNames: [`GVL_LANG_${n}_a`, `GVL_LANG_${n}_b`] })

export const QF_AMBIGUOUS_GLOBAL_TESTS: readonly LanguageTest[] = [
  fb("qf_c0136_before", "BEFORE — a global two lists declare, read bare", (n) => source(n, `g_${n}`), lists("qf_c0136_before")),
  after(fb("qf_c0136_qualify_a", "AFTER — qualified with the first list", (n) => source(n, `GVL_LANG_${n}_a.g_${n}`), lists("qf_c0136_qualify_a")),
    { before: "qf_c0136_before", code: "C0136", title: "Qualify as 'GVL_LANG_qf_c0136_before_a.g_qf_c0136_before'" }),
  after(fb("qf_c0136_qualify_b", "AFTER — qualified with the second list", (n) => source(n, `GVL_LANG_${n}_b.g_${n}`), lists("qf_c0136_qualify_b")),
    { before: "qf_c0136_before", code: "C0136", title: "Qualify as 'GVL_LANG_qf_c0136_before_b.g_qf_c0136_before'" }),
]
