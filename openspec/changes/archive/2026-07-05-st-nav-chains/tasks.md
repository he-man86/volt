## 0. Prerequisite

- [x] 0.1 `st-body-ast` landed (tree) and `st-type-inference` landed — this phase **consumes its shared service** (`semantic/type-infer.ts`: `resolveMemberChain`, `inferExprType`, `renderType`, the tree walker), NOT a new copy. If a query needs a hop the service doesn't expose, extend the service, never re-hand-roll a scope-walk (the 5 duplicates were just collapsed there).

## 1. Chain resolution

- [x] 1.1 Chain context via `lsp/st-body-at.ts` (`stStatementsAtOffset`) + `parser/ast-walk.ts` `memberAtOffset` — a query gets the enclosing member expr at the cursor from the body AST. (Cleaner than threading it through identifier-at; shared by all nav queries.)
- [x] 1.2 Go-to-definition resolves `a.b(.c)` through the base's type via `resolveMemberChain` → the member's declaration (cross-file), falling back to name-based on unresolved. Scenario test: `m.speed` → the struct field decl, not every `speed`. Full suite green.
- [x] 1.3 Hover resolves a member `a.b` through the base's type to the member's real declaration (type + reference docs), via the shared `memberAtOffset` + `resolveMemberChain`; falls back to name-based on unresolved. Scenario test: `m.speed` hover → `speed : LREAL`.
- [x] 1.4 Completion: multi-level member completion — the regex now captures the full chain path (`o.inner.`), resolved through the shared inference to the final type's scope. Offers the NESTED type's members, not the base's. Also removed the last `findSymbol`/`findSymbolByName` copy (now uses `inferExprType`). Scenario tests: single + multi-level.

## 2. Type-aware references

- [x] 2.1 References/rename/document-highlight now share `lsp/symbol-refs.ts` (`symbolAtOffset` + `findReferences`): resolve the target symbol at the cursor, then keep only occurrences that bind to it by SYMBOL IDENTITY — a `motor.Start` no longer matches every `Start`; a method-local shadowing an FB member no longer bleeds into the member's highlights. Falls back to name-based when the target can't resolve (no worse than before). Inference gained `THIS^`, static bases (`GVL.field`, `E_State.Idle`), so those occurrences resolve instead of dropping. Scenario tests: member field narrowed by type, same-named locals across POUs separated, rename leaves a same-named field on another type untouched. Corpus highlight snapshots re-baselined (narrower = correct). Full suite green.
- [x] 2.2 Call-hierarchy now includes `fb.method()` member calls — resolved through the base's type via `resolveMemberChain` (with the containing unit's scope), instead of dropping every `isMemberAccess` call. Additive; scenario test: `m.Start()` → outgoing call to `Start`.

## 3. Bare enum-member full nav

- [x] 3.1 Bare non-`qualified_only` enum members now have full nav: `resolveBareEnumMember` (shared service) finds the member symbol in the enum's own scope; go-to-def + hover use it as a fallback; completion offers them as global constants. Scenario tests for all three. (Inherited from `library-signature-index` §7.3.)

## 4. Cross-file spot-checks

- [ ] 4.1 Query snapshots over the corpus: definition into library-adjacent files, references across files, hover types, completion in library-heavy scopes. Inherited from `harden-lsp-real-project` §6.
  - DEFERRED (2026-07-05, archived): the core chain-nav functionality is validated by the unit tests and the
    existing corpus query snapshots (code-action, document-highlight ≈ references, selection-range,
    signature-help, folding-range — all green over all 4 corpora). A dedicated definition / hover / completion
    snapshot pass over library-heavy scopes remains a follow-up; not a blocker for the landed capability.

## 5. Land it

- [x] 5.1 `cd packages/volt-lsp-iec && bun test` green and `bun typecheck` clean; corpus ratchet unaffected.
- [x] 5.2 `openspec validate st-nav-chains`; delta already synced into the main `language-server` spec; archived.
