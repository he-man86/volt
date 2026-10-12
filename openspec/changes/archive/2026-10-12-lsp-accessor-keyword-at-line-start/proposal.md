## Why

**A variable named `SET` or `GET` inside a property breaks both the bridge and the LSP.** Both are legal names
(`SOFT_NAME_KEYWORDS = {GET, SET, OVERRIDE}` in `frontend/syntax/lex/vocabulary.ts`; the Standard RS FB declares
`SET : BOOL`), and CODESYS compiles them. Volt mistakes them for accessor keywords.

Field record (PLCAssist chat `5998954f`, 2026-10-10, CODESYS 3.5.17.20, LSP from `a7106efb7d`): FB `FB_Press`, which
builds clean (8 builds, 0 errors), uses `SET : POINTER TO <settings struct>` throughout. Verified against the code on
2026-10-10:

- **Bridge (data).** `StReader.ReadProperty` opens an accessor on any line where `LineStartsWithKeyword(code, "SET")`,
  and that helper counts every character that is not a letter, digit or `_` as a word boundary. A setter line
  `SET^.stri_Name := P;` therefore opens a `SET` accessor and `RefuseTextAfter` refuses the item `INVALID_ST`: the FB is
  `unreadable` on pull and refused on push. `StReader` is engine code, so TwinCAT has the same bug. (The user renamed
  `SET` to `STNG` to get his FBs back.)
- **LSP (false positive).** `collectAccessorBody` (`parse/body.ts`) stops at ANY `GET`/`SET` keyword token
  (`peekStoppers: ["GET", "SET", "END_PROPERTY"]`), wherever it stands. A getter body `P := ADR(SET^.stri_Name);` ends
  mid-line, `END_GET` is never reached as its closer, and `parse/units/property.ts` reports
  `'GET' is not closed by 'END_GET'` — 33 times in `FB_Press`. This blocks PLCAssist from turning the LSP on.

## What Changes

**One rule for every element, the same in `StReader` (C#) and the LSP parser (TS): a body runs from its
`IMPLEMENTATION` line to its own END keyword, and nothing inside it is structural.** The declaration/body split
already works this way (`ImplementationMarker`); this extends it to the structure scan that finds where blocks
open and close.

- METHOD and ACTION already scan this way: they run to their own END line, and a reserved structural keyword at a
  line start inside them (`METHOD`, `PROPERTY`, any `END_*`) is refused as "the block above has no END line". That
  stays, for every element.
- `GET` / `SET` are the only structural keywords that are also legal names, so they are the only change: inside an
  accessor's body (after its `IMPLEMENTATION` line) and inside its VAR blocks (`VAR…END_VAR`) they are text.
- An accessor body that reaches `END_PROPERTY` or the other accessor's END line before its own is refused naming both
  lines. (Today the reader closes it as a bare accessor and DROPS its body; the LSP already refuses this shape.)
- Real accessor keyword lines keep today's refusals: `GET PUBLIC` / `GET (* note *)` (text after the keyword), a bare
  `GET` closed by the next `SET`.
- Bridge first: it loses data, the LSP only reports.

## Impact

- `packages/volt-cli/src/Volt.Engine/Format/St/StReader.cs` — `ReadProperty`'s scan (`StWriter` unchanged).
- `packages/volt-lsp-iec/src/frontend/syntax/parse/body.ts` (`collectAccessorBody`: after the accessor's
  `IMPLEMENTATION` it stops only at its own END, `END_PROPERTY` or the other END) and `parse/units/property.ts`.
- No wire change. Both vendors (shared engine).
