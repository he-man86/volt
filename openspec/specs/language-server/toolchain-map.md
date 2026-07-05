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
| 1 | **Type inference & type-aware diagnostics** — engine + deepen assignment/binary/conversion checks + call-arg checking + narrowing | `st-type-inference` | 🟢 conformance CLOSED (2026-07-05); call-arg + narrowing still default-off. The live-CODESYS/live-TwinCAT replay is **message-IDENTICAL** on both vendors — the LSP's diagnostic text matches each compiler byte-for-byte (per-vendor wording mirrored) or is a documented parser-cascade divergence. **Corpus precision 0 on all 4 projects**; the library-blind + dead-object unresolved floor is fully cleared, so `unresolved-identifier` was **promoted warning→error** to mirror the compilers. Call-arg + narrowing checks are now **enabled** (both oracle-validated). Along the way the corpus metric was corrected: **precision counts ERRORS** (a clean build guarantees zero); WARNINGS a clean build legitimately carries (the compiler emits them without failing) are reported separately and validated by the conformance oracle, never ratcheted — the corpus stays the *final* check, dedicated fixtures are primary. **See `diagnostics-conformance.md`.** |
| 2 | **Member-chain navigation** — go-to-def/hover/completion/references through `a.b.c` on the tree + inference | `st-nav-chains` | 🟡 built (chain nav + type-aware references/rename/document-highlight + call-hierarchy member calls + bare-enum full nav, all green; inference gained `THIS^`/`GVL.field`/enum static bases). Remaining: §4 cross-file corpus spot-checks, then archive. |
| 3 | **Structural formatter** — pretty-printer from the AST | `st-format` | ⬜ planned |
| 4 | **Performance on large projects** — per-document caching, batched seed, query budget | `st-perf` | ⬜ planned |
| 5 | **Headless ST test execution** — scan-cycle interpreter + `bun test` API + oracle harness | `st-interpreter` | ⬜ scoped (0/27) |
| X | **Transpiler (ST → JS/C)** — deferred alternative to the interpreter | (none) | ⬜ deferred — only if large/fast simulation is later needed |

## Foundations already landed (✅ archived)

- **`library-signature-index`** — referenced-library signatures resolve; library-blind unresolved floor cleared.
- **`expose-device-instances`** — device-tree instances resolve (`.device` descriptors). *(in progress: 20/28)*
- **exclude-from-build awareness**, **VG graphical analysis**, **kind-based file extensions**, and the **4-corpus ratchet** (pro2193 / bakon-nano / awa-palletizer / lenze-mid) — now **precision 0 (zero diagnostics)** on all four. The new bridge no longer ships excluded/uncompiled objects at fetch, so those were removed from the corpus (the in-content marker mechanism remains as a fallback); the remaining unresolved-identifier tail was closed via `_libsigs` + a `COMPILER_PROVIDED_IMPLICITS` skip (`IoConfig_Globals`, `TYPE_CLASS`).

## Component status

Legend: ✅ have · 🟡 partial · ⬜ missing.

| Component | Status | Owning phase | Goal it serves |
|---|---|---|---|
| Lexer · declaration AST · symbol table · type resolver | ✅ have | — | foundation |
| **Body AST** (statement/expression tree) | ✅ have | 0 `st-body-ast` | the treewalker — **100% body-parse-clean on all 4 corpora**, 0 mismatches (incl. CODESYS `S=`/`R=`/`REF=`, `__TRY`, inline/chained assignment, bit access) |
| Expression type inference | ✅ `semantic/type-infer.ts` | 1 `st-type-inference` | the shared engine (inferExprType + resolveMemberChain) |
| Diagnostics (assignment/binary/conversion) | ✅ deepened onto tree + inference | 1 `st-type-inference` | member/index/deref/call operands typed (no more bail-on-`.`) |
| **Diagnostic message parity** (LSP text == IDE, per-vendor) | ✅ have | 1 `st-type-inference` | every diagnostic the LSP shares with the compiler reads byte-identical to it (external-write, type-mismatch via `cannotConvert`, abstract-instantiation, MOD, VAR-section, orphan-pragma, interface-impl UPPER-cased, `STRING(INT#<len>)`, per-vendor wording). The conformance test passes ONLY on identical messages; the divergence ledger is parser-cascades + IDE-only extras. |
| `unresolved-identifier` (error severity) | ✅ have | 1 `st-type-inference` | promoted warning→**error** to mirror both compilers; corpus 0 FPs (library-blind tail + dead objects cleared) |
| Call-argument checking (count/type/name) | ✅ **ON** (2026-07-05) | 1 `st-type-inference` | enabled after fixing the mixed named+positional binding FP; zero corpus errors |
| Narrowing-conversion diagnostic (LREAL→REAL) | ✅ **ON** (2026-07-05) | 1 `st-type-inference` | oracle-verified both compilers WARN on it (fixture `narrowing_lreal_to_real`), per-vendor wording mirrored (`Possible`/`possible`) |
| Member-chain nav (def/hover/completion/refs) | ✅ full chains + type-aware occurrence queries | 2 `st-nav-chains` | editor UX on `a.b.c`, narrowed by symbol identity |
| Formatter / pretty-printer | 🟡 keyword-indent only | 3 `st-format` | structural formatting |
| Perf on large projects (caching, seed, budget) | 🟡 all-or-nothing invalidate | 4 `st-perf` | responsive on big trees |
| Interpreter (scan-cycle) + std-lib + oracle harness | ⬜ | 5 `st-interpreter` | headless CI tests |
| Library-blind unresolved floor | ✅ done | `library-signature-index` | resolved |

## Architecture — the shared semantic-query service

The layering is a clean DAG (lexer → parser/vg → semantic → lsp) with a transport-decoupled query layer and a pure `CHECKS` registry — **do not rewrite it.** But an architecture survey found the machinery all of Phases 1–5 need is duplicated or missing:

- the **"name → its type → member scope → member symbol"** hop (for `a.b.c`) is hand-rolled **5×** (`completion.findSymbol`, `signature-help.findCallable`, `vg/calls.findCallableType`, `vg/type-env.findTypeAst`, `_shared.findScopeByName`) + `renderType` **4×**;
- there is **no shared `Expr`/`Statement` walker** (first copy already in `coverage-report.ts`).

**Decision:** Phase 1 (`st-type-inference`) builds `semantic/type-infer.ts` as a **shared service** — exporting `inferExprType`, `resolveMemberChain`, one `renderType`, and a tree walker — consumed by BOTH `checks/**` and `lsp/queries/**`, collapsing the duplicates first (pure, ratchet-guarded). Phases 2–4 (nav, formatter, interpreter) **consume it, never re-copy**. This is the deliberate one-step-back so the later phases inherit a clean foundation. It extends `type-resolver.ts` (which stays the named-type lookup base); the DAG is unchanged (`type-infer.ts` sits in `semantic/`, which both layers already import).

## Decisions of record

- **Interpret over transpile** for test execution — identical IEC-semantics cost, interpretation skips codegen. Transpiler stays deferred.
- **Don't import** esstee/MATIEC/RuSTy — language mismatch + GPL/LGPL copyleft; take their grammar (a fact), not their code. Precedence lifted from IEC + cross-checked against RuSTy (`st-body-ast` design D1a).
- **One LSP spec** — `vg-language` + `workspace-file-extensions` folded into `language-server` (sections E–F are bridge/CLI-owned, labeled as such).
- **Type inference for diagnostics is in scope; authoritative typecheck/codegen is not** — the compiler stays the source of truth; every LSP type diagnostic is conservative (skip on unknown).
