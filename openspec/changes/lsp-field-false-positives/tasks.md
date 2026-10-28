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
- [ ] 3 Persistent-list instance paths with indexes (repro 3).
- [ ] 4 `IMPLEMENTATION ST` after `END_VAR` (repro 4): the line is now `%LANGUAGE <LANG>` (language-line, archived 2026-10-27; the old line is refused by name). Re-run repro 4 with `%LANGUAGE ST`; the family was never reproduced, so close it if the re-run is clean.
- [ ] 5 Cyrillic comment left early: PLC Assist runs candidate fixes over the field text and reports back (repro 5).
- [x] 6 Item names in messages not URI-encoded (repro 6). Root: a GVL's name (`gvlName`, the "already defined in
  '<list>'" message, the outline, `ambiguous-global`, the transpiler's qualified globals) split the RAW uri on `/`,
  keeping its percent-encoding (and, for a `git:` diff URI, reading the query). It now reads `baseNameOf` (task 1's one
  place, decoded path). A POU's scope was already named from its header. Test: `duplicate-declaration.test.ts`
  (`A14_升降.gvl` by its file URI → "already defined in 'A14_升降'").
- [ ] 7 A release with these; PLC Assist re-bundles `volt-lsp-iec.generated.mjs` and re-runs its 14-day scan.
