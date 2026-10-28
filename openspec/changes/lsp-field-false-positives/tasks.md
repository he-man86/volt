# Tasks

- [x] 1 Unicode header names (repro 1). Not a comparison rule: the object's name was read from the document's ENCODED
  URI path (`source-object.ts` `pathOf` returned `new URL(uri).pathname`, which keeps `%E4%B8%BB…`), so a file URI never
  equalled the signature. CODESYS accepts the items (they built clean in the field; the lexer already reads non-ASCII
  letters). Fixed at the root: `pathOf` decodes, and `baseNameOf` is the one place a name is read from a document's
  name. Tests: `source-object.test.ts`, `signature-name.test.ts` (FB, DUT, Cyrillic; a real disagreement still reported).
- [x] 2 `s` / `r` as ST identifiers: NOT a false positive (CODESYS refuses them too, measured 2026-10-27). Only add a regression test that the LSP keeps reporting it, with CODESYS's own message as the oracle.
  Already recorded (`cc_reserved_name_s_string`, `cc_reserved_name_r`, `cc_reserved_name_s_upper`, replayed by
  `lsp-replay.test.ts`). Added `parse-errors.test.ts` "a variable named s, S or r is refused…": repro 2's FUNCTION, its
  declaration cascade compared word for word with each recording.
- [x] 3 Persistent-list instance paths with indexes (repro 3). MEASURED (CODESYS 3.5.21.40, 2026-10-28, single-use
  runscript in an `ide.ps1 -RunScript` IDE on a fixture copy, run `lsp-field`; not kept — the recorder cannot make the
  object, the bridge refuses a `%CLASS PERSISTENT` create): a `VarPersistentObject` (its own factory) holding every path
  "Add all instance paths" writes — `VltP_GVL.fbMain.afbModule[1].stPers`, `…[2].stPers`, `…aafbModule[1, 1]`…`[2, 2].stPers`,
  `VltP_GVL.fbMain.fbOne.stPers`, each `: VltP_Pers` — builds CLEAN. Controls, so the list is really compiled: an
  index out of range "The constant index '5' is not within the range from '1' to '2'"; a wrong type "Type of mapped
  variable is not equal to original type"; an unknown member a warning "Not used instance path …: variable is used as a
  placeholder"; an empty list "No matching instance path in VAR_PERSISTENT list found for variable … [1, 1].stPers" (the
  vendor spells a 2-D index `[1, 1]`). (Leaving a 2-D path out made CODESYS generate broken dummies,
  `Dummy__…__aafbModule__1` / "Identifier expected instead of '1____'", that stayed in the object for every later build
  of the run — so only the first build and the control lines read on top of it count; the plain-GVL questions asked
  after it are unanswered.) Fix: a declared name reads an array element on its way (`names.ts` `readDeclaredName`: an
  index group only where `.` and a part follow its `]`), spelled as the vendor spells it. Tests: `declarations.test.ts`
  (1-D, 2-D, `[2,1]` → `[2, 1]`), `parse-errors.test.ts` (repro 3).
- [x] 4 `IMPLEMENTATION ST` after `END_VAR` (repro 4): the line is now `%LANGUAGE <LANG>` (language-line, archived 2026-10-27; the old line is refused by name). Re-run repro 4 with `%LANGUAGE ST`; the family was never reproduced, so close it if the re-run is clean.
  CLOSED, clean: re-run with `%LANGUAGE ST` right after the last END_VAR of a FUNCTION, a PROGRAM, and a FUNCTION_BLOCK with
  a METHOD, a PROPERTY's GET/SET and an ACTION, through the whole pipeline — no diagnostic. Held by `parse-errors.test.ts`
  "%LANGUAGE ST right after END_VAR draws nothing, on every body kind (repro 4)". The field message was the retired
  IMPLEMENTATION line's, which the bridge no longer writes.
- [ ] 5 Cyrillic comment left early: PLC Assist runs candidate fixes over the field text and reports back (repro 5).
<<<<<<< HEAD
- [ ] 6 Item names in messages not URI-encoded (repro 6).
- [ ] 6b Candidate, unverified (PLC Assist, 2026-10-28): an ENUM value named `GET` in a `.dut` →
      `syntax-error` "Unexpected token 'GET' found" (1 field item, silent build). Synthetic repro:
      `TYPE E_Method : (GET, POST, PUT) := GET; END_TYPE` as `E_Method.dut`. A compiler probe decides, as for `s`/`r`.
=======
  - [x] 5.1 Volt's side (2026-10-28). The lexer CANNOT leave a `(* … *)` comment before its `*)`: one lex of the whole
    text, comments nest as CODESYS nests them (`lex_nested_block_comment` builds clean), and every `%`-line / body split
    reads tokens, never raw lines. 26 synthetic candidates — a 44-line Cyrillic comment as a POU header, between and
    inside VAR sections, in a body, in a METHOD, a GVL and a DUT; LF, CRLF, lone CR; a BOM at the start and inside the
    comment; non-BMP characters; U+2028/U+2029/U+0085; NUL and control characters; a 10 000-character line; `(*` /
    `(**` / `**)` / balanced `(* *)` / `*`-look-alikes inside; keywords, `%LANGUAGE ST`, `//`, `{`, unbalanced quotes
    at a line start inside — gave no finding inside the comment. Two found something else:
    - **a lone CR (FIXED)**: the LSP read `\r` without `\n` as whitespace, where the push ends a line there
      (`StReader.LfLines`) and an LSP client counts one. Every position after it named a line too FEW — so a finding
      after a comment whose lines end in a lone CR was reported on a line INSIDE that comment, as the field shows — a
      `//` comment ran on over the next line, and a `%LANGUAGE` line after one was code. `lex` now reads a lone CR as
      LF, once, offset for offset (`lexer.test.ts`, `parse-errors.test.ts`).
    - a nested-looking `(*` inside the comment with no second `*)`: the comment then runs to the end of the text
      ("unterminated function block") — CODESYS nests too, so that is parity, not a candidate.
  - [ ] 5.2 PLC Assist, over the two stored field texts (no text leaves PLC Assist): (a) count the `\r` not followed by
    `\n` in each text, and say whether the reported line, re-counted with every lone `\r` as a line end, falls AFTER the
    comment's `*)`; (b) re-run `computeDiagnostics` with the bundle built from this change (`lex` reads a lone CR as
    LF) and report pass/fail; (c) if it still fails, report for the reported line and the line before it only: the
    0-based column, the token's text if ASCII, and the code points that are neither ASCII nor Cyrillic (U+0400–U+04FF),
    as hex.
- [x] 6 Item names in messages not URI-encoded (repro 6). Root: a GVL's name (`gvlName`, the "already defined in
  '<list>'" message, the outline, `ambiguous-global`, the transpiler's qualified globals) split the RAW uri on `/`,
  keeping its percent-encoding (and, for a `git:` diff URI, reading the query). It now reads `baseNameOf` (task 1's one
  place, decoded path). A POU's scope was already named from its header. Test: `duplicate-declaration.test.ts`
  (`A14_升降.gvl` by its file URI → "already defined in 'A14_升降'").
- [x] 6b An ENUM value named `GET` (`TYPE E_Method : (GET, POST, PUT) := GET;` → "Unexpected token 'GET' found").
  MEASURED (CODESYS 3.5.21.40, 2026-10-28, `record:language`, 116 new fixtures in `grammar/lexer.ts`): every word whose
  reading as a value the parser decides by its vocabulary, one per fixture, in a TYPE enum (`lex_enum_value_*`) and an
  implicit one (`lex_implicit_enum_value_*`), plus the field's own shape (`lex_enum_value_get_default`). GET, SET and
  OVERRIDE build clean in both lists (and the field shape); the six modifiers, the 15 IL operator names and the 33
  elementary type names are REFUSED — a TYPE enum "Identifier expected instead of 'R'" (a keyword too), an implicit one
  "Type definition expected instead of ','". The LSP refused GET/SET/OVERRIDE and accepted the IL and type names
  silently (an LSP that accepted what CODESYS refuses). Fix: `enum-values.ts` `readValueName` — the soft names are
  values, a refused word is refused with each list's first line (which also turns `decl_implicit_enum_number_name`'s
  LSP-only line into the vendor's). The vendors' recovery past that line is a named ceiling exception
  (`baseline-c.ts`), as for the number-name fixtures. TwinCAT not recorded (no XAE free: the engineer's CODESYS was
  open); the parse census holds those 98 fixtures by name until it is — 6b.1 below.
  - [ ] 6b.1 Record `lex_enum_value_*` / `lex_implicit_enum_value_*` on TwinCAT and drop `ENUM_VALUE_TWINCAT_UNRECORDED`.
>>>>>>> worktree-agent-a1b64d2e6bd2c1880
- [ ] 7 A release with these; PLC Assist re-bundles `volt-lsp-iec.generated.mjs` and re-runs its 14-day scan.
