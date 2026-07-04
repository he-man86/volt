## 0. Prerequisite

- [x] 0.1 `st-body-ast` landed (tree) and `st-type-inference` landed — this phase **consumes its shared service** (`semantic/type-infer.ts`: `resolveMemberChain`, `inferExprType`, `renderType`, the tree walker), NOT a new copy. If a query needs a hop the service doesn't expose, extend the service, never re-hand-roll a scope-walk (the 5 duplicates were just collapsed there).

## 1. Chain resolution

- [x] 1.1 Chain context via `lsp/st-body-at.ts` (`stStatementsAtOffset`) + `parser/ast-walk.ts` `memberAtOffset` — a query gets the enclosing member expr at the cursor from the body AST. (Cleaner than threading it through identifier-at; shared by all nav queries.)
- [x] 1.2 Go-to-definition resolves `a.b(.c)` through the base's type via `resolveMemberChain` → the member's declaration (cross-file), falling back to name-based on unresolved. Scenario test: `m.speed` → the struct field decl, not every `speed`. Full suite green.
- [x] 1.3 Hover resolves a member `a.b` through the base's type to the member's real declaration (type + reference docs), via the shared `memberAtOffset` + `resolveMemberChain`; falls back to name-based on unresolved. Scenario test: `m.speed` hover → `speed : LREAL`.
- [x] 1.4 Completion: multi-level member completion — the regex now captures the full chain path (`o.inner.`), resolved through the shared inference to the final type's scope. Offers the NESTED type's members, not the base's. Also removed the last `findSymbol`/`findSymbolByName` copy (now uses `inferExprType`). Scenario tests: single + multi-level.

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
