## Why

Navigation resolves only the *head* of a reference: go-to-definition/hover/completion/references handle a bare identifier but not member chains (`a.b.c`), and references/rename are pure name-match (`motor.Start` matches every `Start` project-wide). Now that `st-body-ast` gives a real expression tree and `st-type-inference` gives member typing, nav can follow chains and narrow by type. This phase makes navigation type-aware. It inherits the nav-correctness work from `harden-lsp-real-project` (§6) plus the deferred bare-enum full-nav from `library-signature-index`.

## What Changes

- **Member-chain resolution** — go-to-definition, hover, and completion resolve through `a.b.c`, `arr[i].x`, `fb.method` using the body AST + type inference (resolve the base's type → look up the member in its scope), instead of resolving the bare tail name.
- **Type-aware references / rename** — narrow references and rename by the owning type so `motor.Start` no longer matches every same-named `Start`; call-hierarchy includes `fb.method()` calls.
- **Bare enum-member full nav** — go-to-definition/hover/completion on bare enum members (currently resolution-only), inherited from `library-signature-index` §7.3.
- **Cross-file resolution spot-checks** — query snapshots over the corpus (definition into library-adjacent files, references across files, hover types, completion in library-heavy scopes), inherited from `harden-lsp-real-project` §6.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `language-server`: add requirements that navigation queries resolve through member/index/call chains and narrow references/rename by the owning type, using the body AST and type inference.

## Impact

- **Depends on** `st-body-ast` (landed) and `st-type-inference` (member typing) — do this after Phase 1.
- **Code (volt-lsp-iec):** `lsp/queries/{definition,hover,completion,references,rename,document-highlight,call-hierarchy}.ts`, `lsp/identifier-at.ts` (attach chain context), consuming `inferExprType`.
- **No wire/bridge impact.**
- **Inherits** `harden-lsp-real-project` §6 (that change is being closed) and `library-signature-index` §7.3.
