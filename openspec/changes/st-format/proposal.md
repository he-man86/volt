## Why

The formatter (`lsp/queries/format.ts`) is a token re-indenter: it fixes a line's leading indentation and normalizes trailing whitespace / final newline, but leaves all internal spacing exactly as written. Its own docstring explains the conservatism — *"bodies are opaque (we don't parse statement trees)"*. That premise is **no longer true**: Phase 0 (`st-body-ast`) landed a statement/expression AST that is 100% clean on the real-project corpus. We can now format *from the tree*, canonicalizing the spacing the re-indenter can't touch — the "structural formatting" north-star goal — while keeping the corruption-proof guarantees the current formatter offers.

- **Reimplement the formatter as an AST pretty-printer** — the treewalker printer becomes *the* formatter, not an add-on. It walks the `st-body-ast` statement/expression tree (and the declaration AST for VAR sections / POU headers) and emits canonical Structured Text from scratch: block indentation, one statement per line, one space around `:=` and binary operators, `, ` between argument/list items, no space before `;`, canonical `IF … THEN` / `CASE … OF` / `FOR … DO`.
- **Demote the old token re-indenter to a narrow fallback** — used only for a body/file that doesn't parse cleanly into the tree (malformed mid-edit input). The treewalker is 100% on the real-project corpus, so the fallback fires only on genuinely broken input; real code always goes through the printer.
- Preserve and *strengthen* the safety contract: the printed form must **re-parse to the same AST** (`parse(format(x))` ≡ `parse(x)`) — a semantic round-trip stronger than the current token round-trip — plus idempotency and verbatim string/comment content. Indent style/size/eol continue to come from `.editorconfig`.
- Explicitly **defer** (documented in design, not built here): keyword-casing normalization, expression line-wrapping / max-line reflow, and VAR-section colon-alignment.

## Capabilities

### New Capabilities
<!-- none — the formatter is an existing LSP capability -->

### Modified Capabilities
- `language-server`: the formatting requirement changes from "re-indentation only, internal spacing untouched" to "structural pretty-print from the AST with a semantic round-trip guarantee, falling back to re-indentation on unparseable input".

## Impact

- **Code:** `packages/volt-lsp-iec/src/lsp/queries/format.ts` (new printer + fallback wiring; the re-indenter stays as the fallback path). New `src/lsp/queries/format-print.ts` (or similar) for the tree printer. Consumes the existing `parseStatements` / body-AST and the shared expression types — no new dependency, no DAG change.
- **Tests:** per-form printer unit tests; a round-trip property test over the 4 corpora (`parse(format(src))` deep-equals `parse(src)` for every clean body); idempotency; the existing 26 re-indenter tests stay green (fallback path unchanged).
- **No behavior change** for declarations beyond spacing, no reordering, no semantic edits — the IDE compiler stays authoritative.
