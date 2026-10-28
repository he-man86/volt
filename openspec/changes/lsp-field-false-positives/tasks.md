# Tasks

- [ ] 1 Unicode header names (repro 1).
- [ ] 2 `s` / `r` as ST identifiers: NOT a false positive (CODESYS refuses them too, measured 2026-10-27). Only add a regression test that the LSP keeps reporting it, with CODESYS's own message as the oracle.
- [ ] 3 Persistent-list instance paths with indexes (repro 3).
- [ ] 4 `IMPLEMENTATION ST` after `END_VAR` (repro 4): the line is now `%LANGUAGE <LANG>` (language-line, archived 2026-10-27; the old line is refused by name). Re-run repro 4 with `%LANGUAGE ST`; the family was never reproduced, so close it if the re-run is clean.
- [ ] 5 Cyrillic comment left early: PLC Assist runs candidate fixes over the field text and reports back (repro 5).
- [ ] 6 Item names in messages not URI-encoded (repro 6).
- [ ] 6b Candidate, unverified (PLC Assist, 2026-10-28): an ENUM value named `GET` in a `.dut` →
      `syntax-error` "Unexpected token 'GET' found" (1 field item, silent build). Synthetic repro:
      `TYPE E_Method : (GET, POST, PUT) := GET; END_TYPE` as `E_Method.dut`. A compiler probe decides, as for `s`/`r`.
- [ ] 7 A release with these; PLC Assist re-bundles `volt-lsp-iec.generated.mjs` and re-runs its 14-day scan.
