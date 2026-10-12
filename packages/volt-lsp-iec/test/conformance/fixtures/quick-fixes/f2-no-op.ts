/**
 * F2 — the NO-OP STATEMENT (C0139, design.md §4 F2): "remove the statement" on a complete statement that calls nothing
 * and reads no property; on a function block instance also "call it". Both are choices — a stray name may be a typo for
 * something else — so neither is `preferred`.
 *
 * The two classes §3 excludes are held on fixtures that already record them: a PROPERTY read (`flw_noop_property_read`,
 * `t.P;` runs the getter, so removing it builds clean and changes what the program does) and a parse-recovery leftover
 * (`cc_time_nanosecond_literal`, whose `NS;` is what is left of `T#5NS` — the repair is the root syntax error's). Each
 * carries `fixAbsent` where it is defined; so do the leftovers of the parser's other path, and of the same one in
 * another shape: `RUE;` (`lit_bool_typed_true`, resumed after `BOOL#T`) and `b;` standing without its `;`
 * (`expr_power_right_assoc`, unterminated). (`!!!'ERROR'!!!;` and `NETWORK;` reach no C0139 in the LSP at all, so
 * nothing can offer a fix on them.) The third class, a statement that CALLS something, is `qf_c0139_absent_call`:
 * `list[F()];` — both vendors warn it (2026-10-12), so the LSP does too, and removing it would remove the call. An
 * instance whose function block has a VAR_IN_OUT is not called by `counter();` — CODESYS refuses it — so "call it" is
 * absent there (`qf_c0139_before_instance_inout`).
 */
import type { LanguageTest } from "../../types.js"
import { after, fb } from "./shared.js"

const COUNTER = (n: string): string =>
  `FUNCTION_BLOCK FB_LANG_${n}_counter\nVAR_OUTPUT\n\tcount : INT;\nEND_VAR\ncount := count + 1;\nEND_FUNCTION_BLOCK\n\n`
const INOUT_COUNTER = (n: string): string =>
  `FUNCTION_BLOCK FB_LANG_${n}_counter\nVAR_IN_OUT\n\tcount : INT;\nEND_VAR\ncount := count + 1;\nEND_FUNCTION_BLOCK\n\n`
const IDX = (n: string): string => `FUNCTION F_LANG_${n}_idx : INT\nF_LANG_${n}_idx := 1;\nEND_FUNCTION\n\n`

export const QF_NO_OP_TESTS: readonly LanguageTest[] = [
  fb("qf_c0139_before", "BEFORE — a variable read as a statement",
    (n) => `FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\tlevel : INT := 2;\n\tout : INT;\nEND_VAR\nlevel;\nout := level + 1;\nEND_FUNCTION_BLOCK\n`),
  after(fb("qf_c0139_remove", "AFTER — the statement removed",
    (n) => `FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\tlevel : INT := 2;\n\tout : INT;\nEND_VAR\nout := level + 1;\nEND_FUNCTION_BLOCK\n`),
    { before: "qf_c0139_before", code: "C0139", title: "Remove the statement" }),

  fb("qf_c0139_before_instance", "BEFORE — a function block instance named as a statement, not called",
    (n) => `${COUNTER(n)}FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\tcounter : FB_LANG_${n}_counter;\n\tout : INT;\nEND_VAR\ncounter;\nout := counter.count;\nEND_FUNCTION_BLOCK\n`),
  after(fb("qf_c0139_remove_instance", "AFTER — the instance statement removed",
    (n) => `${COUNTER(n)}FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\tcounter : FB_LANG_${n}_counter;\n\tout : INT;\nEND_VAR\nout := counter.count;\nEND_FUNCTION_BLOCK\n`),
    { before: "qf_c0139_before_instance", code: "C0139", title: "Remove the statement" }),
  after(fb("qf_c0139_call_instance", "AFTER — the instance called",
    (n) => `${COUNTER(n)}FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\tcounter : FB_LANG_${n}_counter;\n\tout : INT;\nEND_VAR\ncounter();\nout := counter.count;\nEND_FUNCTION_BLOCK\n`),
    { before: "qf_c0139_before_instance", code: "C0139", title: "Call 'counter()'" }),

  fb("qf_c0139_before_instance_inout", "an instance of a function block with a VAR_IN_OUT named as a statement",
    (n) => `${INOUT_COUNTER(n)}FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\tcounter : FB_LANG_${n}_counter;\n\tout : INT;\nEND_VAR\ncounter;\nout := 1;\nEND_FUNCTION_BLOCK\n`,
    { fixAbsent: { code: "C0139", title: "Call", why: "CODESYS refuses `counter();` (2026-10-12): \"VAR_IN_OUT 'count' must be assigned in call of 'FB_…_counter'\" — a call needs an argument no fix can choose" } }),

  fb("qf_c0139_absent_call", "an array element indexed by a FUNCTION call, as a statement",
    (n) => `${IDX(n)}FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\tlist : ARRAY[1..3] OF INT;\n\tout : INT;\nEND_VAR\nlist[F_LANG_${n}_idx()];\nout := list[1];\nEND_FUNCTION_BLOCK\n`,
    { fixAbsent: { code: "C0139", title: "Remove the statement", why: "the statement CALLS F_…_idx(): removing it removes the call, which may do what the program needs" } }),
  // the call in an INNER subscript (`m[F()][1];`) beside one in the outer (`m[1][F()];`) — asked by the review of step 1
  fb("qf_c0139_absent_call_nested", "a nested array element indexed by a FUNCTION call in its inner and in its outer subscript, as statements",
    (n) => `${IDX(n)}FUNCTION_BLOCK FB_LANG_${n}\nVAR\n\tm : ARRAY[1..3] OF ARRAY[1..3] OF INT;\n\tout : INT;\nEND_VAR\nm[F_LANG_${n}_idx()][1];\nm[1][F_LANG_${n}_idx()];\nout := m[1][1];\nEND_FUNCTION_BLOCK\n`,
    { fixAbsent: { code: "C0139", title: "Remove the statement", why: "each statement CALLS F_…_idx(): removing it removes the call, which may do what the program needs" } }),
]
