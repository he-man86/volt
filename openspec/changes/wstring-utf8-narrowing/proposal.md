> Checked on dev 3bf209901e (2026-11-03): still open. `uoff_wstring_control` keeps `deferred.transpile` (`unicode-identifiers-off.ts:78`; k = 7 recorded, `codesys.run.json:33238`). Its comment points at archived `lsp-field-followups`; this change is the home. Not re-run here: the probe's `LEN` needs the Standard library. Needs a CODESYS recording.

## Why

CODESYS narrows a WSTRING holding a character past ASCII to its UTF-8 bytes: `LEN(WSTRING_TO_STRING("größe"))` is 7
(fixture `uoff_wstring_control`, `record:exec`, 2026-10-30). Both of Volt's backends narrow unit for unit and give 5;
the prelude's `narrow` / `widen` were measured on ASCII only. Found by `lsp-field-followups` (task 4 there).

## What changes

- Measure the class before a fix: the reverse widen of UTF-8 bytes, a cut at the target's capacity inside a character,
  a unit no encoding holds (a lone surrogate), CODESYS's "UTF-8 encoding" option on and off.
- Then the interpreter and the Rust emitter narrow and widen as measured, red then green; `uoff_wstring_control`
  leaves `deferred.transpile`.
