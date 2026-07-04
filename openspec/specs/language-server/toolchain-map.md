# LSP Plan — the single roadmap to compiler-parity Structured Text tooling

The one plan to work from. It sequences the discrete OpenSpec changes into phases toward the goal.
The **spec** (`spec.md`, this folder) is the contract — what's true today. **This doc** is the intent —
where we're going and which change owns each step. Each phase is one OpenSpec change that archives
independently as it lands.

## Goal (north star)

1. **Compiler-parity diagnostics** — accurate, type-aware analysis over the ST body AST + a type-inference engine, catching what CODESYS/TwinCAT catch (narrowing, arg-type mismatches) without a build.
2. **Structural formatting** — a pretty-printer that formats from the AST, not keyword-indent heuristics.
3. **Headless ST test execution** — users unit-test their Structured Text in CI with no IDE/hardware (a scan-cycle interpreter over the same AST, driven by `bun test`).

## Phases (each phase = one OpenSpec change)

| # | Phase | Change | Status |
|---|---|---|---|
| 0 | **Body AST** — statement/expression tree (the treewalker) | `st-body-ast` | ✅ done (archived) |
| 1 | **Type inference & type-aware diagnostics** — engine + deepen assignment/binary/conversion checks + call-arg checking + narrowing | `st-type-inference` | ⬜ active (0/20) |
| 2 | **Member-chain navigation** — go-to-def/hover/completion/references through `a.b.c` on the tree + inference | `st-nav-chains` | ⬜ planned |
| 3 | **Structural formatter** — pretty-printer from the AST | `st-format` | ⬜ planned |
| 4 | **Performance on large projects** — per-document caching, batched seed, query budget | `st-perf` | ⬜ planned |
| 5 | **Headless ST test execution** — scan-cycle interpreter + `bun test` API + oracle harness | `st-interpreter` | ⬜ scoped (0/27) |
| X | **Transpiler (ST → JS/C)** — deferred alternative to the interpreter | (none) | ⬜ deferred — only if large/fast simulation is later needed |

## Foundations already landed (✅ archived)

- **`library-signature-index`** — referenced-library signatures resolve; library-blind unresolved floor cleared.
- **`expose-device-instances`** — device-tree instances resolve (`.device` descriptors). *(in progress: 20/28)*
- **exclude-from-build awareness**, **VG graphical analysis**, **kind-based file extensions**, and the **4-corpus ratchet** (pro2193 / bakon-nano / awa-palletizer / lenze-mid) with zero false positives on built objects.

## Component status

Legend: ✅ have · 🟡 partial · ⬜ missing.

| Component | Status | Owning phase | Goal it serves |
|---|---|---|---|
| Lexer · declaration AST · symbol table · type resolver | ✅ have | — | foundation |
| **Body AST** (statement/expression tree) | ✅ have | 0 `st-body-ast` | the treewalker — 81–86% body-parse-clean, 0 mismatches |
| Expression type inference | ⬜ | 1 `st-type-inference` | the engine the diagnostics below need |
| Diagnostics (assignment/binary/conversion) | 🟡 token-pattern, bails on `.` | 1 `st-type-inference` | deepen onto tree + inference |
| Call-argument checking (count/type/name) | ⬜ none today | 1 `st-type-inference` | catch arg errors |
| Narrowing-conversion diagnostic (LREAL→REAL) | ⬜ | 1 `st-type-inference` | the one compiler diagnostic we lack |
| Member-chain nav (def/hover/completion/refs) | 🟡 head-of-chain only | 2 `st-nav-chains` | editor UX on `a.b.c` |
| Formatter / pretty-printer | 🟡 keyword-indent only | 3 `st-format` | structural formatting |
| Perf on large projects (caching, seed, budget) | 🟡 all-or-nothing invalidate | 4 `st-perf` | responsive on big trees |
| Interpreter (scan-cycle) + std-lib + oracle harness | ⬜ | 5 `st-interpreter` | headless CI tests |
| Library-blind unresolved floor | ✅ done | `library-signature-index` | resolved |

## Decisions of record

- **Interpret over transpile** for test execution — identical IEC-semantics cost, interpretation skips codegen. Transpiler stays deferred.
- **Don't import** esstee/MATIEC/RuSTy — language mismatch + GPL/LGPL copyleft; take their grammar (a fact), not their code. Precedence lifted from IEC + cross-checked against RuSTy (`st-body-ast` design D1a).
- **One LSP spec** — `vg-language` + `workspace-file-extensions` folded into `language-server` (sections E–F are bridge/CLI-owned, labeled as such).
- **Type inference for diagnostics is in scope; authoritative typecheck/codegen is not** — the compiler stays the source of truth; every LSP type diagnostic is conservative (skip on unknown).
