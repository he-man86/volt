## 1. AST node types

- [x] 1.1 Add expression node types to `src/parser/ast.ts`: `BinaryExpr`, `UnaryExpr`, `MemberExpr` (base + member), `IndexExpr` (base + index list), `DerefExpr`, `AddrOfExpr`, `CallExpr` (callee + positional args + named `param := value` args + `=>` output args), `ParenExpr`, `IdentifierExpr`, `Literal` (with a literal-kind tag). Every node carries a `Span`.
- [x] 1.2 Add statement node types: `IfStatement` (branches + else), `CaseStatement` (selector + arms with labels + else), `ForStatement` (control var, from/to/by, body), `WhileStatement`, `RepeatStatement`, `Assignment` (target expr + value expr), `CallStatement`, `ReturnStatement`, `ExitStatement`, `ContinueStatement`, `EmptyStatement`. Add a `StatementList` container type.
- [x] 1.3 Define the IEC 61131-3 operator precedence/associativity table as an explicit constant (unary, `**`, `* / MOD`, `+ -`, comparisons, `= <>`, `AND`, `XOR`, `OR`) with a source comment citing the standard.

## 2. Expression parser

- [x] 2.1 Create `src/parser/expression.ts`: a precedence-climbing (Pratt) parser over a `cursor.ts` token cursor, returning `{ expr, ok }`. Handle primaries (identifier, literal, paren), postfix chains (`.member`, `[index]`, `^`, `(args)`) left-associatively, and prefix unary (`NOT`, `-`, `+`, `ADR`/`&`).
- [x] 2.2 Parse call argument lists: positional, named `param := value`, and output `param => target`; preserve argument order and spans.
- [x] 2.3 Parse typed literals (`INT#5`, `TIME#1s`, `16#FF`, `TRUE`/`FALSE`) and string/wstring/time/date/datetime literals into `Literal` with the correct literal-kind tag.
- [x] 2.4 Unit tests: precedence levels, associativity, `p^.field[i]`, nested calls `a(b(c))`, named + output args, mixed member/index/deref chains. Assert spans map back to source.

## 3. Statement parser

- [x] 3.1 Create `src/parser/statements.ts`: `parseStatements(bodySpan): { statements, ok }` driving the expression parser; parse assignment vs. bare-call statements, and the block statements (IF/CASE/FOR/WHILE/REPEAT) with their nested statement lists.
- [x] 3.2 Consume-and-ignore inline conditional-compile pragmas (`{IF}/{ELSIF}/{ELSE}/{END_IF}`) exactly as the current token scan does — do not model them as nodes this phase (preserve behavior).
- [x] 3.3 Set `ok = false` on any unconsumed tokens / unexpected token / unmodeled construct, without throwing and without emitting any diagnostic.
- [x] 3.4 Unit tests: each block form, nested control flow, empty statements/stray `;`, and a deliberately-unmodeled construct that must yield `ok = false` cleanly.

## 4. Wire into the body model

- [x] 4.1 In `src/semantic/body.ts`, after the `isVgBody` short-circuit, call `parseStatements` for `language === "st"` and expose `statements?: StatementList` on `BodyModel` (additive — keep `identifiers`, `calls`, `st`, `vg` unchanged).
- [x] 4.2 Confirm the same entry point covers FB/program/function/method/action/property-accessor bodies (all `BodySpan`); note any header-token differences found.
- [x] 4.3 Do NOT migrate any existing check or nav query onto the tree in this change — verify by diff that check/query behavior is untouched.

## 5. Ratchet the new representation

- [x] 5.1 Add a **body-parse-clean** coverage axis to `scripts/coverage-report.ts` (`computeCoverage`): count ST bodies where `parseStatements` returns `ok`, as a new metric alongside parse/ingest/precision.
- [x] 5.2 Add an **identifier-set equivalence** self-check: for each ST body, assert the identifier set derived from the AST equals the set from the existing token scan (flags mis-parses without needing type info). Report divergences per file.
- [x] 5.3 Extend `src/tests/real-corpus.test.ts`: record body-parse-clean baselines for all four corpora (pro2193, bakon-nano, awa-palletizer, lenze-mid) and assert it never regresses; assert existing parse/ingest/precision floors are unchanged.
- [x] 5.4 Investigate and log any body that parses `ok = false` on the corpora; either extend the grammar (if a common construct) or record it as an accepted fallback with a note. Ratchet body-parse-clean up as gaps close.
  - Closed the two biggest systematic gaps: `%FOLDER <path>` bridge folder markers embedded in bodies (skipped like trivia via the existing `skipFolderDirective`; pro2193 56%→84%) and trailing commas before `)`/`]` (commented-out call args). Baselines locked: pro2193 1712/2009 (85.2%), bakon 105/129 (81.4%), awa 64/75 (85.3%), lenze 138/160 (86.3%), **0 identifier mismatches** on all four.
  - Accepted fallback (remaining ~15% tail — safe, no diagnostics, token-scan fallback): `S=`/`R=` SFC set-assignments (harden 8.2) + assorted smaller constructs. Each is a separate grammar extension that ratchets the floor up over time; none blocks this change.

## 6. Land it

- [x] 6.1 `cd packages/volt-lsp-iec && bun test` green (incl. new grammar + corpus tests) and `bun typecheck` clean. — 5772 pass / 0 fail; typecheck clean.
- [x] 6.2 Confirm no new diagnostics on any corpus and the four precision floors hold (the zero-FP invariant). — corpus diags unchanged (pro2193 3, bakon 10, awa 0, lenze 0).
- [x] 6.3 `openspec validate st-body-ast` (✓ valid); on completion sync the `language-server` delta and archive.
