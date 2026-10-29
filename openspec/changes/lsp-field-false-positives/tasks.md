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
  - [x] 6b.1 Record `lex_enum_value_*` / `lex_implicit_enum_value_*` on TwinCAT and drop `ENUM_VALUE_TWINCAT_UNRECORDED`.
    Recorded 2026-10-29 (TwinCAT 4024, Project13): the LSP agrees with every first line; TwinCAT's recovery past it is
    `baseline-d.ts`'s, as CODESYS's is `REFUSED_ENUM_VALUE_RECOVERY`.
- [ ] 7 A release with these; PLC Assist re-bundles `volt-lsp-iec.generated.mjs` and re-runs its 14-day scan.

## 8. Class sweeps (owner 2026-10-29: a false positive is a symptom of a CLASS — sweep the class)

Every site checked has a recorded fixture, the right ones too, so the class cannot regress. Recorded 2026-10-29 on CODESYS
3.5.21.40 (culture `en`) and TwinCAT 4024 (Project13), each IDE an `ide.ps1` instance of its own on a fixture copy; the
clean ones run in `record:exec` too. 649 new fixtures (fixture map regenerated); the replay agrees on both vendors, no
LSP-only message. What each family adds to a disagreement measure is a per-fixture named exception (`test/baseline/
baseline-d.ts`, its rows `exceptions-lsp-field-8.json`).

- [x] 8.1 Names read from a URI. ROOT: a client percent-encodes every character past ASCII, and a name read from the raw
  URI keeps the encoding (`%20` was all the library rule decoded). SITES: `syntax/format/source-object.ts` `documentPath`
  (tasks 1, 6: the object's name, a GVL's name) — the one decode, now exported; `library/path.ts` `isLibraryUri` /
  `libraryOf` and `library/manifest.ts` `folder` — FIXED (`decodedPath`; this layer imports nothing, F3, so it states the
  same rule): a library folder past ASCII was its encoding in a workspace symbol's container and in the namespace binding;
  `transpile/lower/init/step.ts` (the `instance-path` attribute's device and application) — FIXED: it split the raw URI, so
  `Plc%20Logic` never matched and every instance path from a client URI was refused, a device past ASCII encoded;
  `workspace/document-key.ts`, `server/disk-sync.ts`, `server/vendor.ts` (`fileURLToPath`: decoded — right);
  `application-scopes.ts`, `project-configs.ts` (keys through `pathToFileURL` both sides — right); `workspace-refs.ts`
  device names (a disk path — right); server log lines (a URI, as LSP names a document — right). The replay now hands every
  fixture to the LSP under the URI a client sends (`test/conformance/support/fixture-uri.ts`), so each name read goes
  through the decoding. EVIDENCE: with the project's "Unicode identifiers" option OFF (CODESYS's default, the recording
  project's) the IDE refuses to CREATE an object named past ASCII ("The name 'FB_LANG_主控制' is not valid for this
  object.", DIALECT C28b); so `upa_*` are recorded in volt-cli's `CodesysUnicodeMembers.3.5.21.40.project` (the option ON)
  — all 13 agree: the signature check (FB/FUNCTION/PROGRAM/INTERFACE/DUT in CJK, Cyrillic, Latin-1; a real mismatch
  still reported), "already defined in 'GVL_LANG_升降'", a qualified use and its unknown member, the ambiguity between two
  lists. FIXTURES: `cross-object/names-past-ascii.ts` (`upa_*`, 13; CODESYS only — TwinCAT's option is off in its fixture
  too). TESTS: `library/path.test.ts`, `manifest.test.ts`, `workspace-symbol.test.ts`, `init/attributes.test.ts`.
  - [ ] 8.1.1 OWNER: the LSP does not read "Unicode identifiers: off" though `.projectsettings` states it, so it accepts a
    name past ASCII the IDE refuses then (a false negative, by DIALECT C28b's decision); reading it would make that a
    finding.
- [x] 8.2 Line ends counted outside the lexer. ROOT: the lexer reads a lone CR as a line end (5.1); code that reads the RAW
  text counted LF only. One home now: `syntax/span.ts` `endsLineAt`, `lineStartOf`, `lineColAt`, `lineBreakOf`,
  `splitLines`. SITES, FIXED: `services/shared/positions.ts` (`offsetFromPosition`, `clampedOffset` — a lone CR was a
  column, and a range end past a CRLF line clamped between its CR and LF); `services/structure/semantic-tokens.ts` (a
  comment's lines); `server/handlers/formatting.ts` (the whole-document edit stopped short of a lone-CR document's end);
  `services/formatting/format.ts` (a range reprint's line ending); `analysis/shared/fixes.ts` (`spanOf`, `removeConstruct`,
  `codeOnly`'s `//` end — and an unclosed string now ends at its line as the lexer ends it; its `lineBreakOf` and
  `no-op-statement.ts`'s copy deleted for the one); `checks/flow/empty-block.ts`, `checks/names/unresolved-identifier.ts`
  (`declareFix`), `checks/oop/lifecycle.ts`, `checks/flow/no-op-statement.ts` (the quoted line break), `analysis/config.ts`
  (`.projectsettings` lines); and the recorder's `pragmaStart` (`scripts/record-language.ts`: a lone-CR fixture's
  attribute line was not found, so the push dropped it). RIGHT already: every token reader (`format/lines.ts`,
  `property-peel.ts`, `object-properties.ts`, `parse/cursor.ts`, `network/plain-st.ts`) — the lexer hands them LF.
  EVIDENCE: every quick-fix pair (191) again in a lone-CR and a CRLF file, recorded on both vendors: each BEFORE reports
  its finding, each AFTER — the action's edits on the twin, held byte for byte by `code-actions.test.ts` — builds clean.
  FIXTURES: `quick-fixes/line-end-twins.ts` (`qf_*_cr`, `qf_*_crlf`, 382). TESTS: `span.test.ts`, `positions.test.ts`,
  `semantic-tokens.test.ts`, `fixes.test.ts`, `no-op-statement.test.ts`, `config.test.ts`, `formatting.test.ts`,
  `format.test.ts`.
- [x] 8.3 A word's vocabulary in every name position (owner: one word per family, the family whole where it disagrees).
  Families: soft (GET), modifier (ABSTRACT), IL operator (LD), elementary type (INT). Positions: a variable in VAR,
  VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT, VAR_TEMP, VAR_STAT, VAR CONSTANT, VAR_INST, VAR_EXTERNAL, VAR_GLOBAL; a STRUCT and a
  UNION member; an FB, FUNCTION, PROGRAM, INTERFACE, DUT, GVL, METHOD, ACTION, PROPERTY name; a named argument; a label.
  Not askable: a NAMESPACE's name (the push refuses NAMESPACE blocks, U28) and an SFC transition's. EVIDENCE: every variable
  and member position agreed already. GET names every object and member on both vendors; a modifier, an IL operator or a
  type name is refused at CREATE ("The name 'INT' is not valid for this object.", TwinCAT "Name mismatch") — no build.
  DISAGREED, whole families recorded, FIXED: GET/SET/OVERRIDE as a FUNCTION, PROGRAM, INTERFACE, DUT or ACTION name
  (refused by the LSP; `Cursor.expectHeaderName`), as a TYPE name (`v : Get`, `parse/named-type.ts`) and as a label
  (`statements.ts`); an IL operator or a type name as a NAMED ARGUMENT (accepted silently; now refused on the word as a
  modifier is, `postfix.ts`); a modifier or LIMIT as a label (refused on the word, `REFUSED_AT_STATEMENT_START` + `:`).
  On TwinCAT the 64-bit date type names are names (`LDATE := …`), as the parser already said — the replay now re-parses
  such a fixture as TwinCAT (`replay.ts` `DIALECT_WORDS`). Named divergence: `TIME`/`LTIME` as a named argument, which
  both vendors read as the clock operator (`divergences-names.ts` `WORD_POSITION_DIVERGENCES`). FIXTURES:
  `names/word-positions.ts` (`wp_*`, 161; the object/member names stand ALONE — `LanguageTest.alone`, never another
  fixture's dependency nor in the replay's shared project). TESTS: `parser.test.ts`, `statements.test.ts`.
  - [ ] 8.3.1 OWNER: the LSP models no create refusal of a reserved word as an object's name (as `CREATE_REFUSAL_BY_NAME_
    NOT_MODELLED` for other names): `FUNCTION_BLOCK INT` draws nothing from the LSP, the push is refused.
- [x] 8.4 Paths and qualified names in declarations. Lists: VAR_GLOBAL, CONSTANT, RETAIN, PERSISTENT, PERSISTENT RETAIN,
  RETAIN PERSISTENT, VAR_CONFIG, an FB's VAR (and VAR_INPUT … VAR_EXTERNAL, VAR CONSTANT), a STRUCT; forms: dotted, an
  element on the way (one index, two, tight), an element last, an element alone, a dangling dot (and before AT), a path as
  the second name; VAR_CONFIG's own shapes (no AT, `AT %I*`, a bare name, an unknown member, an index out of range, a wrong
  type); REFERENCE/POINTER initial values naming a qualified global, an element, a member, `.g`; a path as an attribute's
  value. EVIDENCE + FIXES: CODESYS takes a path in every global list and in VAR_EXTERNAL, TwinCAT in none of them;
  both in VAR_CONFIG; neither in a POU section or a STRUCT ("',, AT or :' expected instead of '.'", and of '[') —
  the LSP accepted every path everywhere (`names.ts` `DeclaredPaths`, `declarations.ts` `VAR_LIST`). An element LAST
  (`PLC_PRG.ax[1]`) builds in the path lists — the LSP refused it. A configuration list's bare name is "'x' is not a valid
  instance path" — the LSP said nothing. After a `.` in VAR_CONFIG any word is the part (`. AT %IX…` refuses the address).
  A VAR_EXTERNAL path is no dangling global; its unknown member is "'nope' is no component of 'FB'" (`external-global.ts`).
  REFERENCE/POINTER initial values and attribute values agreed already. FIXTURES: `declarations/declared-paths.ts`
  (`dp_*`, 93; their applications never log in — an unbound `AT %I*` — so `execSkip`). TESTS: `declarations.test.ts`,
  `external-global.test.ts`.
- [x] 8.5 Found on the way: the recorder pushed NOTHING for a fixture whose header the LSP's parser refuses (it sliced items
  by the LSP's units; such a text is now the one item it names); the replay's TwinCAT re-parse kept the CODESYS copy of the
  fixture's own lists bound (their checks found no unit); a stale citation (`network-unresolved.ts`).
