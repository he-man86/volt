## Context

The current formatter (`lsp/queries/format.ts`) is a **token re-indenter**: it recomputes each line's leading indentation from a running block-nesting count and normalizes trailing whitespace / final newline. It never touches internal spacing. It is deliberately conservative because, when it was written, bodies were opaque token spans. That constraint is gone — `st-body-ast` (Phase 0) gives a statement/expression tree that is 100% clean on the four-project corpus.

**The load-bearing fact about the AST:** it carries NO comments. Comments (`line_comment`, `block_comment`) are lexer trivia; `parseStatements` skips them. They exist only in the token stream. So a printer that emits purely from the AST would **delete every comment** — and the obvious `parse(format(x)) ≡ parse(x)` invariant would NOT catch it, because `parse` discards comments on both sides. Comment preservation therefore needs its own guarantee and its own machinery.

## Goals / Non-Goals

**Goals:**
- Reimplement the formatter as an AST pretty-printer: block indentation, one statement per line, canonical internal spacing (`:=`, binary operators, `,`, `;`, `IF … THEN`, `CASE … OF`, `FOR … DO`), printed from the statement/expression tree and the declaration AST (VAR sections, POU headers).
- Preserve every comment, verbatim, in a sensible place.
- Two invariants, both tested over the corpus: **(A) semantic round-trip** — `parse(format(x))` deep-equals `parse(x)` (structure/identifiers unchanged); **(B) comment preservation** — the multiset of comment token texts is identical before and after.
- Idempotent: `format(format(x)) == format(x)`.
- Fall back to the existing re-indenter (kept, comment-safe) for any body that doesn't parse cleanly OR whose comments can't be safely reattached — so nothing is ever corrupted.

**Non-Goals (deferred, not built here):**
- Keyword-casing normalization (IEC is case-insensitive; leave as written — a later config can opt in).
- Expression line-wrapping / max-line reflow — v1 keeps one statement per line, no wrapping of long expressions.
- VAR-section colon-alignment and other columnar alignment.
- Formatting VG (graphical) bodies — the bridge owns VG canonicality; the ST formatter leaves `NETWORK` bodies alone.

## Decisions

**1. Printer = pure recursive functions over the AST.** `printStatements(list, ctx)` and `printExpr(expr)` return strings; a `ctx` carries the indent unit + level. Expression printing encodes IEC operator precedence so parentheses are emitted only where needed to preserve meaning (and always where the source had them and they change associativity) — the semantic round-trip test is the guard.

**2. Comment reconciliation by source position — the crux.** Comments are almost always own-line or trailing. Before printing a statement list, bucket the comment tokens by the line they start on:
  - **Own-line comment** (line's first non-trivia token is a comment): emitted on its own line at the current indent level, in original order, interleaved between the statements it sits between (keyed by span).
  - **Trailing comment** (comment after code on a statement's line): appended to that statement's printed line, one space after the `;`.
  - **Interior comment** (inside a statement, e.g. `a := b (* c *) + d`): the reconciler cannot place it structurally → that statement (or its enclosing body) **falls back** to the re-indenter for its original text. Rare in real code; the corpus tells us how rare.

  Invariant (B) — the comment multiset is unchanged — is asserted so any dropped/duplicated comment fails the test loudly.

**3. Fallback is per-body, comment-safe.** `formatDocument` tries the AST printer for each POU body; on `parseStatements` failure, or on an interior-comment case the reconciler rejects, it emits that body via the existing `reindentSt`. The re-indenter stays exactly as-is (its 26 tests keep it honest). Declarations always print from the declaration AST (they don't have the interior-comment hazard the same way; verify on the corpus).

**4. Config unchanged.** Indent style/size/eol still resolve from `.editorconfig` → `IndentOptions`. The printer consumes the same options; no new config surface in v1.

## Risks / Trade-offs

- **Comment reconciliation is the hard part and the main risk.** Mitigation: invariant (B) is a hard test over all four corpora; anything the reconciler can't place falls back rather than guesses. We accept a real-code fallback rate > 0 if it means zero comment loss — measured, not assumed.
- **Parenthesis correctness in expression printing.** A precedence bug could change meaning. Mitigation: invariant (A) (`parse(format(x)) ≡ parse(x)`) over the corpus catches any associativity/precedence regression.
- **Scope creep toward wrapping/alignment.** Explicitly deferred; v1 is spacing + indentation + comment-safe. Wrapping is a separate change once the printer core is trusted.
- **Idempotency across the fallback seam** (a body printed by the AST path, its neighbor by the re-indenter). Mitigation: idempotency test on mixed documents.
