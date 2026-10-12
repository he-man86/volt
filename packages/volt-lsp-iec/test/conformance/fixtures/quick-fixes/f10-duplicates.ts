/**
 * F10 — the DUPLICATE DECLARATION (design.md §4 F10): C0142 offers removing the first and removing the second declaration;
 * C0097 removing the derived function block's redeclaration, its title naming what the block then inherits. Which one
 * survives decides the variable's type and initial value, so `preferred` is set only where the declarations AGREE — then
 * every option means the same, and auto-apply keeps the first (C0142) or the base's (C0097). Where they disagree the
 * options are offered unmarked (§3): the `_differ` pairs.
 */
import type { LanguageTest } from "../../types.js"
import { after, fb } from "./shared.js"

const twice = (n: string, decls: string): string =>
  `FUNCTION_BLOCK FB_LANG_${n}\nVAR\n${decls}\tout : DINT;\nEND_VAR\nout := level + 1;\nEND_FUNCTION_BLOCK\n`
const inherited = (n: string, base: string, own: string): string =>
  `FUNCTION_BLOCK FB_LANG_${n}_base\nVAR\n\t${base}\nEND_VAR\nEND_FUNCTION_BLOCK\n\n` +
  `FUNCTION_BLOCK FB_LANG_${n} EXTENDS FB_LANG_${n}_base\nVAR\n${own}\tout : DINT;\nEND_VAR\nshared := shared + 1;\nout := shared;\nEND_FUNCTION_BLOCK\n`

export const QF_DUPLICATE_TESTS: readonly LanguageTest[] = [
  // ─── C0142, the two declarations agree ────────────────────────────────────────────────────────────────────────────
  fb("qf_c0142_before_same", "BEFORE — one variable declared twice alike", (n) => twice(n, "\tlevel : INT;\n\tlevel : INT;\n")),
  after(fb("qf_c0142_remove_second_same", "AFTER — the second declaration removed", (n) => twice(n, "\tlevel : INT;\n")),
    { before: "qf_c0142_before_same", code: "C0142", title: "Remove the second declaration of 'level'", preferred: true }),
  after(fb("qf_c0142_remove_first_same", "AFTER — the first declaration removed", (n) => twice(n, "\tlevel : INT;\n")),
    { before: "qf_c0142_before_same", code: "C0142", title: "Remove the first declaration of 'level'" }),

  // ─── C0142, the two declarations differ ───────────────────────────────────────────────────────────────────────────
  fb("qf_c0142_before_differ", "BEFORE — one variable declared twice, INT := 1 and DINT", (n) => twice(n, "\tlevel : INT := 1;\n\tlevel : DINT;\n")),
  after(fb("qf_c0142_remove_second_differ", "AFTER — the second (DINT) removed: level is INT := 1", (n) => twice(n, "\tlevel : INT := 1;\n")),
    { before: "qf_c0142_before_differ", code: "C0142", title: "Remove the second declaration of 'level'" }),
  after(fb("qf_c0142_remove_first_differ", "AFTER — the first (INT := 1) removed: level is DINT", (n) => twice(n, "\tlevel : DINT;\n")),
    { before: "qf_c0142_before_differ", code: "C0142", title: "Remove the first declaration of 'level'" }),

  // ─── C0097 ────────────────────────────────────────────────────────────────────────────────────────────────────────
  fb("qf_c0097_before_same", "BEFORE — a derived block redeclaring its base's variable alike", (n) => inherited(n, "shared : INT;", "\tshared : INT;\n")),
  after(fb("qf_c0097_remove_same", "AFTER — the redeclaration removed", (n) => inherited(n, "shared : INT;", "")),
    { before: "qf_c0097_before_same", code: "C0097", title: "Remove the redeclaration (inherit FB_LANG_qf_c0097_before_same_base.shared : INT)", preferred: true }),

  fb("qf_c0097_before_differ", "BEFORE — a derived block redeclaring its base's INT := 1 as DINT", (n) => inherited(n, "shared : INT := 1;", "\tshared : DINT;\n")),
  after(fb("qf_c0097_remove_differ", "AFTER — the redeclaration removed: shared is the base's INT := 1", (n) => inherited(n, "shared : INT := 1;", "")),
    { before: "qf_c0097_before_differ", code: "C0097", title: "Remove the redeclaration (inherit FB_LANG_qf_c0097_before_differ_base.shared : INT := 1)" }),
]
