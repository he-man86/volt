- [x] 1 PLC Assist reports the lone-CR check (lsp-field-false-positives 5.2) over its two stored field texts, with the
      prerelease's bundle; a remaining failure becomes a new family.
      Done 2026-10-29 on 0.1.18151 (PLC Assist): all 48 stored read texts with Cyrillic or Chinese pass clean, the two
      field items included; the non-ASCII header family is gone (233 of 233).
- [x] 2 Owner decides 8.1.1 (read "Unicode identifiers"); build it test-first with a recorded fixture if yes.
      Owner: build it (2026-10-29). The LSP reads `Unicode identifiers: on|off` from `.projectsettings`
      (`analysis/config.ts` `projectUnicodeIdentifiersFrom`; no row — TwinCAT's descriptor — is the only state TwinCAT
      has, off, DIALECT D39) per PLC project (`ProjectConfigs`), and the option is a LEXER fact, as the compiler's: `lex`
      takes it (required, `ParseOptions.unicodeIdentifiers`, carried on `ParseResult` and `BodySpan`; the store parses
      each document under its project's option and re-reads a parse whose option changed; `computeDiagnostics` refuses a
      parse made under the other). Off, a character past ASCII ends a name and is a token of its own, refused where a
      name or an operand belongs as a reserved word is (`isStrayPastAscii`). EVIDENCE, CODESYS 3.5.21.40 (en) and
      TwinCAT 4024, 2026-10-30: `names/unicode-identifiers-off.ts` (`uoff_*`, 18: a variable, a use, an assignment
      target, a call argument, a type, a STRUCT member, a member read, an enum value, a label, a global — CJK, Cyrillic,
      Latin-1, an Arabic-Indic digit, ASCII then CJK; two clean controls, a comment and a WSTRING) — e.g. `计数 : INT;`
      is "Unexpected token '计' found" then the pair per token, `größe : INT;` is "',, AT or :' expected instead of 'ö'".
      Both vendors read the same tokens; 17 of 18 agree word for word on CODESYS, 12 on TwinCAT. Named divergences, the
      existing recovery classes: `uoff_enum_value` (the TYPE enum's close, `TYPE_EXPRESSION_RECOVERY`), and on TwinCAT
      its NON_RETAIN recovery after "',, AT or :'" (`TWINCAT_NON_RETAIN_RECOVERY`: `uoff_var_latin1`, `_digit`,
      `_ascii_then_cjk`, `_middle`, `uoff_global`). The 13 `upa_*` (recorded on the option-ON project) are marked
      `unicodeIdentifiers: "on"` and replay under it (`recordingParse`). TESTS: `lexer.test.ts`, `config.test.ts`,
      `workspace-refs.test.ts` (two projects, each its own option), `object-name.test.ts`.
- [x] 3 Owner decides 8.3.1 (reserved word as an object name); build it test-first if yes.
      Owner: build it (2026-10-29). `analysis/checks/names/object-name.ts` (`object-name-refused`): an object (its file's
      name) or a METHOD / ACTION / PROPERTY (the name the push reads off its header, `StReader.ParseSignature`'s rule) the
      IDE's create refuses, in the IDE's own words — CODESYS "The name 'INT' is not valid for this object.", TwinCAT
      "Creating the child named 'INT' is not possible on node (Name mismatch)" — and the refusal is the text's whole
      answer (nothing of it is built). The rule is volt-cli's measured one: the refused-word lists
      (`analysis/shared/refused-names.ts`, generated from `scripts/vendor-facts.<vendor>.json` `refused-names`, held to it
      by `refused-names.test.ts`), an ASCII non-identifier, a backtick name (CODESYS creates it, TwinCAT refuses), a name
      past ASCII (CODESYS by the option, TwinCAT always). EVIDENCE, live 2026-10-30, both vendors: `names/object-names.ts`
      (`on_*`, 63: every object position — FB, FUNCTION, PROGRAM, INTERFACE, DUT, GVL, METHOD, ACTION, PROPERTY — × a
      keyword, an operator, a conversion, `a__b`, a lower-case type name, CJK, Latin-1): all 63 refused on both, each
      with exactly the `vendorRefuses` wording (the DUT, GVL and INTERFACE ones and every name past ASCII answered by the
      IDE itself, the rest by the push's pre-flight quoting it) — with the 27 refused `wp_*`, the 6
      `lex_soft_keyword_method_name_*` and `rcc_member_*`, the refusals replay (`transpile-replay-refusals.test.ts`) and
      the diagnostic census measure them (`name-refusal.ts`). `CREATE_REFUSAL_BY_NAME_NOT_MODELLED` deleted (both its
      fixtures modelled). Found on the way: the C0582 catalog repro and test named their methods `Calc` — refused (CALC);
      now `Compute`. TESTS: `object-name.test.ts`, `refused-names.test.ts`.
- [ ] 4 Found on the way (2026-10-30): CODESYS narrows a WSTRING holding a character past ASCII to its UTF-8 bytes —
      `LEN(WSTRING_TO_STRING("größe"))` is 7 (`uoff_wstring_control`, record:exec) — where both backends narrow unit for
      unit (5; the prelude's `narrow` / `widen` were measured on ASCII alone and say so). Sweep the class before a fix: the
      reverse widen of UTF-8 bytes, a cut at the target's capacity inside a character, a unit no encoding holds (a lone
      surrogate), CODESYS's "UTF-8 encoding" option on and off; then both backends, red then green. The fixture carries
      it in `deferred.transpile` until then.
