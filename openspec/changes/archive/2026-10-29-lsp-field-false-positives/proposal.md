> Superseded 2026-10-30: the current network-text spelling is packages/volt-cli/docs/network-text.html.

# Proposal (from PLC Assist, 2026-10-27)

## Why

PLC Assist runs Volt's IEC LSP on every item its tools read or write, one item at a time and in shadow mode (the
model sees nothing yet). Over 14 days of live CODESYS traffic (62 chats) it reported 288 errors, and the build that
followed confirmed 6. PLC Assist wants to show LSP errors to the model after a write, as opencode did
(`lsp-write-feedback` in PLC Assist). That needs the LSP not to flag correct CODESYS code. The false positives fall
into a few families, each reproduced below with SYNTHETIC code (no customer text).

Run each case through `computeDiagnostics` for dialect `codesys` and an item name matching the header. Expected:
no error for each.

| # | Family | Repro | Got | Field count |
|---|---|---|---|---|
| 1 | Non-ASCII name in the header line | item `FB_主控制.pou`: `FUNCTION_BLOCK FB_主控制` / `VAR x : INT; END_VAR` / `x := 1;` / `END_FUNCTION_BLOCK`; also `TYPE 系统常量 : STRUCT a : INT; END_STRUCT END_TYPE` as `系统常量.dut` | `signature-name-mismatch` "The name used in the signature is not identical to the object name", L1 | 199 |
| 2 | A variable named `s` or `r` (case-insensitive) | `FUNCTION F_T : STRING` / `VAR s : STRING(32); END_VAR` / `s := 'a'; F_T := s;` | `syntax-error` "Unexpected token 's' found" (the IL set/reset operators taken as keywords in ST) | 11+ — **NOT a false positive** (2026-10-27): CODESYS 3.5.21.40 refuses the same declaration with the same message (Volt's probe: C0009 "Unexpected token 'r' found"), and the field chat's own build failed with "Unexpected token 's' found" until `s` was renamed. The LSP matches the compiler; kept only as a regression test that it keeps reporting it. |
| 3 | Persistent variable list with instance paths | `PersistentVars.gvl`: `VAR_GLOBAL PERSISTENT RETAIN` / `GVL.fbMain.afbModule[1].stPers : ST_Pers;` / `END_VAR` | `syntax-error` "':' expected instead of '['" | 5 |
| 4 | `IMPLEMENTATION ST` in Volt's own read format | real reads of POUs show the line `IMPLEMENTATION ST` right after `END_VAR` | "an IMPLEMENTATION line inside a body" | 3 |
| 5 | A long Cyrillic `(* … *)` comment left early | not reproduced synthetically; in the field the parser reports "Unexpected token '2'" on a line INSIDE a comment that opens on line 2 and closes on line 47, with no `*)` in between | `syntax-error` inside a comment | 2 |
| 6 | Encoded item names in messages | a duplicate declaration in an item with a CJK name reported "already defined in 'A14_%E5%8D%87…'" in the field (direct calls name it correctly) | percent-encoded name | 2 |

Not Volt's to fix (PLC Assist filters them): array bounds from a library constant (`ARRAY [1..MAX_TRACKS]` in
SM3 items), and library items generally, which are not the user's code.

## What Changes (proposed)

- 1: compare the header name with the item name as Unicode text (CODESYS allows non-ASCII identifiers).
- 2: `S`/`R` are IL operators, not ST keywords; accept them as identifiers in ST.
- 3: accept instance paths with array indexes in a persistent variable list.
- 4: either the read format stops emitting `IMPLEMENTATION ST` after `END_VAR`, or the LSP accepts it there; Volt's
  call which side owns it.
- 5: needs the exact bytes. PLC Assist can run any candidate fix over the stored field text locally and report
  pass/fail without sharing the text.
- 6: report the item name as given, not URI-encoded.

Each with a regression test from the repro.
