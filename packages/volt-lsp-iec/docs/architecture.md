# volt-lsp-iec — architecture pointer

The full design + **ownership map** ("where does X live") is the single source of truth in
`openspec/specs/st-language-server/architecture.md`. Don't duplicate it here — read it before adding
a type or constant, and import from the owning layer instead of re-creating it.

The layer stack, imports point **downward only**:

```
G  server        LSP 3.17 / stdio · dispatch · capabilities · diagnostics
F  reference · graphical   language catalogs · FBD/LD sublanguage (by reuse)
E  services      navigation · hover/completion · semantic-tokens · formatting · code-actions
D  analysis      diagnostics orchestrator · messages · checks
C  types         elementary · Type · resolve · const-eval · infer · compat · render
B  symbols       symbol · scope · binder · scope-nav
A  syntax        tokens · lexer · complete AST · parser + treewalker
                     ↘ transpile (Rust backend) consumes A·B·C directly
```

The ranks are encoded and **enforced** in `scripts/check-layering.ts` (run via `bun lint`): an upward
import, a check importing a sibling check, or `transpile` reaching above `types` fails the build.
Each layer exposes one `index.ts` barrel — consumers import `from "../types"`, not a deep file.
