/**
 * F5 — the STRING CONSTANT TOO LONG (C0198, design.md §4 F5): widen the destination to the literal's length, or shorten
 * the literal to the destination's — at both sites the check reports, an assignment and an initial value. Two meanings
 * (keep the text or keep the size), so neither is `preferred`.
 */
import type { LanguageTest } from "../../types.js"
import { after, fb } from "./shared.js"

const body = (n: string, vars: string, statements: string): string =>
  `FUNCTION_BLOCK FB_LANG_${n}\nVAR\n${vars}\nEND_VAR\n${statements}\nEND_FUNCTION_BLOCK\n`

export const QF_STRING_LENGTH_TESTS: readonly LanguageTest[] = [
  fb("qf_c0198_before_assign", "BEFORE — six characters assigned to a STRING(4)",
    (n) => body(n, "\ttext : STRING(4);\n\tsize : INT;", "text := 'abcdef';\nsize := LEN(text);")),
  after(fb("qf_c0198_widen_assign", "AFTER — the destination widened to STRING(6)",
    (n) => body(n, "\ttext : STRING(6);\n\tsize : INT;", "text := 'abcdef';\nsize := LEN(text);")),
    { before: "qf_c0198_before_assign", code: "C0198", title: "Change the type to STRING(6)" }),
  after(fb("qf_c0198_shorten_assign", "AFTER — the literal shortened to four characters",
    (n) => body(n, "\ttext : STRING(4);\n\tsize : INT;", "text := 'abcd';\nsize := LEN(text);")),
    { before: "qf_c0198_before_assign", code: "C0198", title: "Shorten to 'abcd'" }),

  fb("qf_c0198_before_init", "BEFORE — six characters as a STRING(4)'s initial value",
    (n) => body(n, "\ttext : STRING(4) := 'abcdef';\n\tsize : INT;", "size := LEN(text);")),
  after(fb("qf_c0198_widen_init", "AFTER — the destination widened to STRING(6)",
    (n) => body(n, "\ttext : STRING(6) := 'abcdef';\n\tsize : INT;", "size := LEN(text);")),
    { before: "qf_c0198_before_init", code: "C0198", title: "Change the type to STRING(6)" }),
  after(fb("qf_c0198_shorten_init", "AFTER — the literal shortened to four characters",
    (n) => body(n, "\ttext : STRING(4) := 'abcd';\n\tsize : INT;", "size := LEN(text);")),
    { before: "qf_c0198_before_init", code: "C0198", title: "Shorten to 'abcd'" }),
]
