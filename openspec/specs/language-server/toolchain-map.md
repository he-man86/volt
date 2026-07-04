# ST Toolchain Map — LSP / interpreter / transpiler

A living status view of the Structured Text toolchain: what exists, what's proposed, and the goal each part serves. Update the Status column as changes land. Not a spec (no requirements) — a navigation aid for the `language-server` capability and its neighbours.

Legend: ✅ have · 🟡 partial · ⬜ missing.

| Component | Status | Owning change | Goal it serves |
|---|---|---|---|
| Lexer (tokens) | ✅ have | — | everything downstream |
| Declaration AST (units / vars / types) | ✅ have | — | symbols, nav |
| Symbol table / scopes | ✅ have | — | resolution, nav |
| Type resolver (named type → kind) | ✅ have | — | shallow checks |
| **Body AST** (statement / expression tree) | ✅ have | `st-body-ast` (done) | the treewalker foundation — 81–86% body-parse-clean, 0 mismatches on 4 corpora |
| Expression type inference | ⬜ | `st-type-inference` | the type-aware engine over the tree — unblocks the diagnostics below |
| Diagnostics (assignment/binary/conversion) | 🟡 token-pattern, bails on `.` | `st-type-inference` | deepen onto the tree + inference (no more bail-on-member) |
| Call-argument checking (count / type / name) | ⬜ (none today) | `st-type-inference` | catch arg errors — no coverage at all currently |
| Narrowing-conversion diagnostic (LREAL→REAL) | ⬜ | `st-type-inference` (was harden 8.1) | the one diagnostic the compiler emits and we don't |
| `S=` set-assignment resolution | ⬜ | `harden-lsp-real-project` 8.2 | kill a known false positive (grammar extension) |
| Nav queries (def / hover / completion / refs) | 🟡 head-of-chain only | `st-nav-chains` (future) | member-chain nav (`a.b.c`) on the tree + inference |
| Formatter / pretty-printer | 🟡 keyword-indent only | `st-format` (future) | structural formatting from the tree (spacing, alignment, line-break) |
| Library-blind unresolved floor | ✅ done | `library-signature-index` (archived) | residual = library-blind + 2 real bugs; floor cleared |
| **Interpreter** (scan-cycle evaluator) | ⬜ | `st-interpreter` | headless CI tests of PLC logic |
| Std-lib runtime (TON / R_TRIG / CTU…) | ⬜ phased | `st-interpreter` §5 | run real FBs in tests |
| Oracle harness (diff vs CODESYS/TwinCAT) | 🟡 static only | `lsp-vs-compiler.ts` → `st-interpreter` §6 | *prove* correctness (static today; execution later) |
| Transpiler (ST → JS / C) | ⬜ deferred | (none) | only if large/fast simulation is later needed |

## Sequence

1. **`st-body-ast`** — the single foundation. Every 🟡/⬜ in the middle block depends on it.
2. **`library-signature-index`** (in flight) — clears the unresolved floor.
3. Then pick from what the tree unlocks: call-arg checking + narrowing (biggest diagnostic wins) or member-chain nav (biggest UX win).
4. **`st-interpreter`** — last; highest effort, least urgent. Gated on the tree + a walking-skeleton spike to de-risk the oracle path.

Decisions of record: interpret over transpile (identical semantics cost, skips codegen); don't import esstee/MATIEC/RuSTy (language + GPL/LGPL copyleft) — take their grammar, not their code; interpreter lives in one package (`volt-lsp-iec/src/interp/`). See `changes/st-body-ast/design.md` (D1/D1a) and `changes/st-interpreter/design.md` (D1/D7).
