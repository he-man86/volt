# Consolidate volt-lsp-iec: one home per concept, and the bugs the duplication hid

## Why

The transpiler review (2026-09-14) asked whether everything uses `src/types` instead of re-creating type knowledge, and
the user widened it to the whole package: "we dont want duplicate locally declared types … if 1 of the features does not
use a type it is a gap prob". Two read-only audits answered it (types; structure). The duplication is not cosmetic — where
a concept exists twice, the copies already disagree, and each disagreement is a bug in one feature:

- inference types an `LDATE#`/`LTOD#`/`LDT#` literal as DATE/TOD/DT, while lowering types it right;
- lowering ignores a typed literal's prefix (`REAL#1.5` becomes LREAL, `INT#5` the context type);
- six `X_TO_Y` name parsers — three do not recognise `TIME_OF_DAY_TO_UDINT`;
- three "walk every body" copies use the unit scope where `bodies()` uses a property accessor's own;
- inlay hints rebuild a callee's parameters instead of `resolveCallee`, so FB-instance calls get none;
- network-text checks hard-code CODESYS wording that `messages` has per vendor;
- three string-literal length rules disagree on `$` escapes;
- the layering lint names folders that no longer exist (`graphical/`), so `src/network` has never been checked.

Gap 13 (an out-of-range untyped integer literal) was the same class: the transpiler had a private literal-type list, the
LSP had none — fixed with `types/integerLiteralType`, used by both.

## What changes

1. **Bugs first**, each with a colocated test, a recorded fixture where it is vendor behaviour, and why no test caught it.
2. **`src/types` is the only home of type knowledge**: exported constructors and predicates over `Type`, literal typing,
   conversion-name parsing, run-time arithmetic types (clearly separate from the LSP's conservative inference), temporal
   units, string capacity. Every consumer switches; no local type lists remain.
3. **Structure**: a layering lint that sees every folder; `Document` and AST printing in `syntax/`; one body iterator;
   network-shared rules out of `checks/`; declarative vendor gating; shared test support; the dead-code list removed; the
   monoliths (`lower.ts`, `server.ts`, `network-analysis.ts`) split.

## Impact

`packages/volt-lsp-iec` only. No wire, CLI or extension change. Every step keeps the offline gates green (unit,
conformance replay floors, corpus, execution oracle) and is its own commit.
