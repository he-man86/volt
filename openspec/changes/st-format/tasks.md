## 1. Expression printer (the core)

- [ ] 1.1 `printExpr(expr): string` over the expression AST — identifiers, literals (verbatim text), member `a.b`, index `a[i]`, deref `p^`, address-of, calls with positional + `name := value` args, unary, binary with IEC precedence.
- [ ] 1.2 Parenthesization: emit `(...)` only where a child's precedence is lower than the parent's, or where associativity would otherwise change — guarded by the semantic round-trip test, not guessed.
- [ ] 1.3 Unit tests per expression form → canonical string; a table of `input → expected`.

## 2. Statement printer

- [ ] 2.1 `printStatements(list, ctx): string` — assignment (`:=`, and `S=`/`R=`/`REF=`), `IF`/`ELSIF`/`ELSE`, `CASE` with labelled arms, `FOR`/`WHILE`/`REPEAT`, `RETURN`/`EXIT`/`CONTINUE`, bare call statements. One statement per line; block indent from `ctx.level`.
- [ ] 2.2 Indent unit / eol from `IndentOptions` (reuse the existing `.editorconfig` resolution); no new config.
- [ ] 2.3 Unit tests per statement form, including nested control flow.

## 3. Comment reconciliation

- [ ] 3.1 Bucket comment tokens by start line from the token stream; classify own-line vs trailing vs interior (by span against the surrounding statements).
- [ ] 3.2 Interleave own-line comments between statements and append trailing comments after `;`, keyed by span. Return a signal ("cannot place") for an interior comment.
- [ ] 3.3 Tests: own-line, trailing, blank-line runs preserved, and the interior-comment → "cannot place" signal.

## 4. Declarations

- [ ] 4.1 Print POU headers (`FUNCTION_BLOCK … EXTENDS … IMPLEMENTS …`, `METHOD … : <ret>`) and VAR sections from the declaration AST — one declaration per line, canonical `name : TYPE := init;` spacing. No colon-alignment (deferred).
- [ ] 4.2 Tests over representative declarations (VAR_INPUT/OUTPUT/IN_OUT, arrays, init values, pragmas kept verbatim).

## 5. Wire-up + fallback

- [ ] 5.1 `formatDocument` formats each POU body via the AST printer; on `parseStatements` failure or an interior-comment "cannot place", fall back to `reindentSt` for that body. The re-indenter stays unchanged as the fallback (its 26 tests stay green).
- [ ] 5.2 Assemble the whole document (headers + bodies + between-item trivia) and return a single full-document TextEdit; empty array when already formatted.

## 6. Invariants over the corpus

- [ ] 6.1 **Semantic round-trip** property test: for every clean body in the 4 corpora, `parse(format(src))` deep-equals `parse(src)`.
- [ ] 6.2 **Comment preservation** property test: the multiset of comment texts is unchanged over the 4 corpora.
- [ ] 6.3 **Idempotency** test: `format(format(x)) == format(x)`, including documents that mix AST-printed and fallback bodies.
- [ ] 6.4 Report the fallback rate over the corpus (how many bodies took the re-indenter path) so it's measured, not assumed.

## 7. Land it

- [ ] 7.1 `cd packages/volt-lsp-iec && bun test` green and `bun typecheck` clean; corpus ratchet unaffected.
- [ ] 7.2 `openspec validate st-format`; sync the `language-server` delta + archive; mark Phase 3 done in `toolchain-map.md`.
