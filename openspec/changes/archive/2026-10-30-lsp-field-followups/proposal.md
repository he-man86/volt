> Carried from the archived `lsp-field-false-positives` (2026-10-29). Small: two owner decisions and one PLC Assist report.

## Why

Three items of lsp-field-false-positives wait on someone else: PLC Assist's check of the lone-CR lexer fix over its two
stored field texts (Cyrillic comment, family 5), and two owner decisions the class sweep raised.

## What changes

- 8.1.1: CODESYS refuses names past ASCII unless "Unicode identifiers" is on; the LSP does not read that setting from
  `.projectsettings`, so it accepts names the IDE refuses. Proposed (main session): read it (parity).
- 8.3.1: both IDEs refuse to CREATE an object named by a reserved word (`FUNCTION_BLOCK INT`); the LSP says nothing.
  Proposed: report it in the IDE's own refusal wording, or leave it (no build diagnostic exists to copy).
