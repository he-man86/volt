## 1. Expression printer (the core)

- [x] 1.1 `printExpr(expr): string` over the expression AST — identifiers, literals (verbatim text), member `a.b`, index `a[i]`, deref `p^`, address-of, calls with positional + `name := value` args, unary, binary with IEC precedence.
- [x] 1.2 Parenthesization: emit `(...)` only where a child's precedence is lower than the parent's, or where associativity would otherwise change — guarded by the semantic round-trip test, not guessed.
- [x] 1.3 Unit tests per expression form → canonical string; a table of `input → expected`.

## 2. Statement printer

- [x] 2.1 `printStatements(list, ctx): string` — assignment (`:=`, and `S=`/`R=`/`REF=`), `IF`/`ELSIF`/`ELSE`, `CASE` with labelled arms, `FOR`/`WHILE`/`REPEAT`, `RETURN`/`EXIT`/`CONTINUE`, bare call statements. One statement per line; block indent from `ctx.level`.
- [x] 2.2 Indent unit / eol from `IndentOptions` (reuse the existing `.editorconfig` resolution); no new config.
- [x] 2.3 Unit tests per statement form, including nested control flow.

## 3. Comment reconciliation

- [x] 3.1 Bucket comment tokens by start line from the token stream; classify own-line vs trailing vs interior (by span against the surrounding statements).
- [x] 3.2 Interleave own-line comments between statements and append trailing comments after `;`, keyed by span. Return a signal ("cannot place") for an interior comment.
- [x] 3.3 Tests: own-line, trailing, blank-line runs preserved, and the interior-comment → "cannot place" signal.

## 4. Declarations

- [x] 4.1 `printVarSection` prints VAR sections from the declaration AST — one declaration per line, canonical `name : TYPE := init;` spacing, `AT` clause + initializer + type reprinted verbatim from source (the AST keeps them as opaque spans), section modifiers kept in source order, declaration-level pragmas/comments woven back. Falls back to the re-indenter for any declaration the AST can't reprint faithfully (multi-line type/init/at, or a comment interleaved inside the `name : TYPE := init` run). **Scope:** POU header lines (`FUNCTION_BLOCK … EXTENDS/IMPLEMENTS …`, `METHOD … : <ret>`) stay re-indented — they are already clean across the corpus and reprinting them from the lossy declaration AST buys marginal value. No colon-alignment (deferred).
- [x] 4.2 Tests over representative declarations in `unit/format-declarations.test.ts` (canonical spacing, `AT`/init/multi-name, modifier order, pragma weaving, and the two fallbacks). Also covers two root fixes the corpus surfaced: (a) a body never owns its POU header line — a trailing comment on `METHOD Foo : BOOL // …` survives; (b) the re-indenter now counts a closer keyword that shares a line with a multi-line comment's close (`*) END_CASE`), which previously drifted the level for the rest of the file.

## 5. Wire-up + fallback

- [x] 5.1 `formatDocument` formats each POU body via the AST printer; on `parseStatements` failure or an interior-comment "cannot place", fall back to `reindentSt` for that body. The re-indenter stays unchanged as the fallback (its 26 tests stay green).
- [x] 5.2 Assemble the whole document (headers + bodies + between-item trivia) and return a single full-document TextEdit; empty array when already formatted.

## 6. Invariants over the corpus

- [x] 6.1 **Semantic round-trip** property test: for every clean body in the 4 corpora, `parse(format(src))` deep-equals `parse(src)`.
- [x] 6.2 **Comment preservation** property test: the multiset of comment texts is unchanged over the 4 corpora.
- [x] 6.3 **Idempotency** test: `format(format(x)) == format(x)`, including documents that mix AST-printed and fallback bodies.
- [x] 6.4 Report the fallback rate over the corpus (how many bodies took the re-indenter path) so it's measured, not assumed.

## 7. Land it

- [x] 7.1 `cd packages/volt-lsp-iec && bun test` green and `bun typecheck` clean; corpus ratchet unaffected.
- [x] 7.2 `openspec validate st-format`; sync the `language-server` delta + archive; mark Phase 3 done in `toolchain-map.md`.
