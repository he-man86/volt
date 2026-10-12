/**
 * F4 — the SYNTAX ERRORS THAT NAME ONE TOKEN (design.md §4 F4): the C0002 shapes whose message says which token is missing
 * — `';' expected instead of end of POU`, `';' expected instead of 'END_*'`, `'END_*' expected instead of ''`, `Unexpected
 * End-of-file found: 'END_*' expected`, `'THEN' expected instead of …` — and the conditional pragma left open
 * (`unterminated-conditional-pragma`). The fix inserts that token where the parser recovered; it can mean nothing else,
 * so it is `preferred`.
 */
import type { LanguageTest } from "../../types.js"
import { after, fb } from "./shared.js"

const body = (n: string, vars: string, statements: string): string =>
  `FUNCTION_BLOCK FB_LANG_${n}\nVAR\n${vars}\nEND_VAR\n${statements}\nEND_FUNCTION_BLOCK\n`

export const QF_INSERT_TOKEN_TESTS: readonly LanguageTest[] = [
  fb("qf_c0002_before_semicolon_end", "BEFORE — the body's last statement without its `;`",
    (n) => body(n, "\tout : INT;", "out := out + 1")),
  after(fb("qf_c0002_semicolon_end", "AFTER — the `;` inserted", (n) => body(n, "\tout : INT;", "out := out + 1;")),
    { before: "qf_c0002_before_semicolon_end", code: "C0002", title: "Insert ';'", preferred: true }),

  fb("qf_c0002_before_semicolon_block", "BEFORE — a statement without its `;` before END_IF",
    (n) => body(n, "\tready : BOOL := TRUE;\n\tout : INT;", "IF ready THEN\n\tout := 1\nEND_IF")),
  after(fb("qf_c0002_semicolon_block", "AFTER — the `;` inserted",
    (n) => body(n, "\tready : BOOL := TRUE;\n\tout : INT;", "IF ready THEN\n\tout := 1;\nEND_IF")),
    { before: "qf_c0002_before_semicolon_block", code: "C0002", title: "Insert ';'", preferred: true }),

  fb("qf_c0002_before_end_block", "BEFORE — a REPEAT without its END_REPEAT",
    (n) => body(n, "\tout : INT;", "REPEAT\n\tout := out + 1;\nUNTIL out > 3")),
  after(fb("qf_c0002_end_block", "AFTER — END_REPEAT inserted",
    (n) => body(n, "\tout : INT;", "REPEAT\n\tout := out + 1;\nUNTIL out > 3\nEND_REPEAT")),
    { before: "qf_c0002_before_end_block", code: "C0002", title: "Insert 'END_REPEAT'", preferred: true }),

  fb("qf_c0002_before_end_file", "BEFORE — a FOR without its END_FOR",
    (n) => body(n, "\ti : INT;\n\tout : INT;", "FOR i := 1 TO 3 DO\n\tout := out + i;")),
  after(fb("qf_c0002_end_file", "AFTER — END_FOR inserted",
    (n) => body(n, "\ti : INT;\n\tout : INT;", "FOR i := 1 TO 3 DO\n\tout := out + i;\nEND_FOR")),
    { before: "qf_c0002_before_end_file", code: "C0002", title: "Insert 'END_FOR'", preferred: true }),

  fb("qf_c0002_before_then", "BEFORE — an IF without its THEN",
    (n) => body(n, "\tready : BOOL := TRUE;\n\tout : INT;", "IF ready\n\tout := 1;\nEND_IF")),
  after(fb("qf_c0002_then", "AFTER — THEN inserted",
    (n) => body(n, "\tready : BOOL := TRUE;\n\tout : INT;", "IF ready THEN\n\tout := 1;\nEND_IF")),
    { before: "qf_c0002_before_then", code: "C0002", title: "Insert 'THEN'", preferred: true }),

  fb("qf_pragma_before", "BEFORE — a conditional pragma never closed",
    (n) => body(n, "\tout : INT;", "{IF defined(QF_NEVER_DEFINED)}\nout := 1;")),
  after(fb("qf_pragma_end_if", "AFTER — {END_IF} inserted",
    (n) => body(n, "\tout : INT;", "{IF defined(QF_NEVER_DEFINED)}\nout := 1;\n{END_IF}")),
    { before: "qf_pragma_before", code: "unterminated-conditional-pragma", title: "Insert '{END_IF}'", preferred: true }),
]
