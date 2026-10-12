/**
 * the fixtures of `library-bodies.ts` — part C: the primitives the repo's bodies are written in.
 *
 * One slice of `library-bodies.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { fb } from "./library-bodies-shared.js"

export const LIBRARY_BODY_TESTS_C: readonly LanguageTest[] = [
  // ── the primitives the repo's bodies are written in ─────────────────────────────────────────────────────────
  fb("lib_prim_char_past_length", "s[i] past the length but inside the variable: a read, a store, and the terminator idiom buf[SIZEOF(buf) - 1] := 0",
    `FUNCTION_BLOCK FB_LANG_LIB_char_past
VAR
\tbuf : STRING(10);
\treadPast : BYTE;
\tlenAfterTerminator : INT;
\tlenAfterStore : INT;
\tatCapacity : BYTE;
END_VAR
buf := 'ab';
readPast := buf[4];
buf[10] := 0;
lenAfterTerminator := LEN(buf);
buf[6] := 88;
lenAfterStore := LEN(buf);
atCapacity := buf[10];
END_FUNCTION_BLOCK
`),
  fb("lib_prim_string_cursor_offset", "a POINTER TO STRING handed a byte pointer that stepped: p^[0] is the character it stands on",
    `FUNCTION F_LANG_LIB_first : BYTE
VAR_INPUT
\tp : POINTER TO STRING;
END_VAR
F_LANG_LIB_first := p^[0];
END_FUNCTION
FUNCTION F_LANG_LIB_first_after_step : BYTE
VAR_INPUT
\tq : POINTER TO BYTE;
END_VAR
q := q + 1;
F_LANG_LIB_first_after_step := F_LANG_LIB_first(q);
END_FUNCTION
FUNCTION_BLOCK FB_LANG_LIB_cursor_offset
VAR
\ttext : STRING := 'abc';
\tatStart : BYTE;
\tafterStep : BYTE;
END_VAR
atStart := F_LANG_LIB_first(ADR(text));
afterStep := F_LANG_LIB_first_after_step(ADR(text));
END_FUNCTION_BLOCK
`),
  fb("lib_prim_null_cursor", "a pointer variable handed to a byte pointer: set, then null — the callee's own IF p = 0 answers",
    `FUNCTION F_LANG_LIB_len_or : DINT
VAR_INPUT
\tp : POINTER TO BYTE;
END_VAR
IF p = 0 THEN
\tF_LANG_LIB_len_or := -1;
\tRETURN;
END_IF
WHILE p^ <> 0 DO
\tF_LANG_LIB_len_or := F_LANG_LIB_len_or + 1;
\tp := p + 1;
END_WHILE
END_FUNCTION
FUNCTION_BLOCK FB_LANG_LIB_null_cursor
VAR
\ttext : STRING := 'abc';
\tps : POINTER TO STRING;
\tsetLength : DINT;
\tnullLength : DINT;
END_VAR
ps := ADR(text);
setLength := F_LANG_LIB_len_or(ps);
ps := 0;
nullLength := F_LANG_LIB_len_or(ps);
END_FUNCTION_BLOCK
`),
]
