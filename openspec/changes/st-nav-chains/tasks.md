## 0. Prerequisite

- [ ] 0.1 `st-body-ast` landed (tree) and `st-type-inference` landed (member typing via `inferExprType`) — this phase consumes both.

## 1. Chain resolution

- [ ] 1.1 Attach chain context in `lsp/identifier-at.ts` so a body token carries its enclosing member/index/call expression (from the body AST), not just the bare identifier.
- [ ] 1.2 Go-to-definition (`definition.ts`): resolve through the chain via `inferExprType` (base type → member scope → declaration). Fall back to name-based on unresolved.
- [ ] 1.3 Hover (`hover.ts`): show the member's type resolved through the chain.
- [ ] 1.4 Completion (`completion.ts`): multi-level member completion (`a.b.` offers `b`'s type's members), replacing the single-level regex.

## 2. Type-aware references

- [ ] 2.1 References/rename/document-highlight (`references.ts`, `rename.ts`, `document-highlight.ts`): narrow a member reference by its owning type; fall back to name-based on unresolved.
- [ ] 2.2 Call-hierarchy (`call-hierarchy.ts`): include `fb.method()` member-call sites (currently dropped).

## 3. Bare enum-member full nav

- [ ] 3.1 Go-to-definition/hover/completion for bare non-`qualified_only` enum members (currently resolution-only). Inherited from `library-signature-index` §7.3.

## 4. Cross-file spot-checks

- [ ] 4.1 Query snapshots over the corpus: definition into library-adjacent files, references across files, hover types, completion in library-heavy scopes. Inherited from `harden-lsp-real-project` §6.

## 5. Land it

- [ ] 5.1 `cd packages/volt-lsp-iec && bun test` green and `bun typecheck` clean; corpus ratchet unaffected.
- [ ] 5.2 `openspec validate st-nav-chains`; sync the `language-server` delta + archive.
