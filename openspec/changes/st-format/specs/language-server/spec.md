## ADDED Requirements

### Requirement: Structured Text is formatted from the statement/expression AST

`textDocument/formatting` SHALL produce canonical Structured Text by pretty-printing the `st-body-ast` statement/expression tree and the VAR-section declaration AST, layered over a token re-indenter that provides the baseline indentation and handles everything the AST printer does not own (POU header lines, whitespace). The printer SHALL emit: block indentation from tree nesting; one statement per line; a single space around `:=` and binary operators; `, ` between argument and list items; no space before `;`; canonical control-flow spelling (`IF … THEN`, `CASE … OF`, `FOR … DO`); and one declaration per line as `name : TYPE := init;` with the type, initializer, and `AT` clause reprinted verbatim from source and section modifiers (`CONSTANT`/`RETAIN`/`PERSISTENT`) kept in their source order. Parentheses SHALL be emitted only where operator precedence/associativity requires them to preserve meaning. Indent style, size, and end-of-line SHALL continue to resolve from `.editorconfig`, falling back to the editor's `FormattingOptions`. Keyword casing SHALL be left as written (IEC identifiers are case-insensitive).

#### Scenario: Internal spacing is canonicalized, not just indentation
- **WHEN** a body contains `x:=a+b*(c-d);` at any indentation
- **THEN** it is reformatted to `x := a + b * (c - d);` at the correct block indent — the prior re-indenter would have fixed only the leading whitespace

#### Scenario: Declarations get canonical column spacing
- **WHEN** a VAR section pads names to columns with tabs, e.g. `a\t\t\t: INT := 5;`
- **THEN** it is reformatted to `a : INT := 5;`, while a declaration with a multi-line initializer or a comment interleaved inside the `name : TYPE := init` run is left to the re-indenter (verbatim) rather than risk relocating content

#### Scenario: Meaning-preserving parentheses
- **WHEN** the source is `x := (a + b) * c;`
- **THEN** the parentheses are kept (removing them would change the result), whereas redundant `x := (a) + b;` may be normalized to `x := a + b;` only if the parse tree is unchanged

### Requirement: Formatting preserves comments and never corrupts code

The formatter SHALL guarantee three invariants over every formatted document: (A) a **semantic round-trip** — parsing the formatted output yields the same AST as parsing the input (identifiers, structure, and operator nesting unchanged); (B) **preservation** — the multiset of comment, pragma, and `%FOLDER` marker texts in the output is identical to the input (nothing dropped, duplicated, or altered), since these live only in the token stream and not in the AST; and (C) **idempotency** — formatting an already-formatted document changes nothing. Comments, pragmas, and markers SHALL be reconciled from the token stream by source position: an own-line comment prints on its own line at the current indent; a trailing comment prints after the statement's `;`. A comment embedded mid-expression SHALL be relocated to the nearest trailing position (never dropped), keeping the multiset intact. When a body cannot be parsed into a clean tree, that body SHALL fall back to the token re-indenter (which preserves comments and internal spacing verbatim) rather than risk corruption.

#### Scenario: An own-line and a trailing comment survive formatting
- **WHEN** a body has a comment on its own line and another after a statement (`x := 1; // set x`)
- **THEN** both appear in the output unchanged — the own-line comment at the block indent, the trailing comment after the reformatted `x := 1;`

#### Scenario: An interior comment is relocated, never dropped
- **WHEN** a statement embeds a comment mid-expression (`a := b (* note *) + c;`)
- **THEN** the comment is relocated to a trailing position rather than dropped — the comment-preservation invariant holds and the parse tree is unchanged

#### Scenario: Formatting is idempotent and never changes meaning
- **WHEN** an already-formatted document is formatted again
- **THEN** the output is byte-identical (idempotent), and for any document `parse(format(src))` deep-equals `parse(src)` and the comment multiset is unchanged
