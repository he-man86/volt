# ST Static Typechecker — design & coverage

**What this is.** A *static typechecker* for Structured Text built on the statement/expression treewalker — the
compiler's analysis frontend (name resolution + type inference + type-rule checking), **without** the rest of a
compiler (IR, optimization, codegen, linking). It is the LSP's core engine: the same type facts power
diagnostics, hover, completion, signature help, and member-chain navigation. The IDE compiler stays the
authority for building/running the PLC; we **calibrate** the typechecker's verdicts + wording to match it
byte-for-byte (the record→oracle loop), so the editor and the build pane never disagree.

**Why reframe from "a set of checks."** A professional typechecker is not N ad-hoc checks — it is a *rich type
model + constant evaluation + one assignability relation, applied systematically*. Modelled that way, most
"gaps" close as a **consequence** of the type system, not as bespoke checks. Today's engine is name-string
based with no const-eval, which is exactly the ceiling that blocks range/overflow/bounds rules.

**Completeness (unchanged, now principled).** A typechecker is complete when it enforces every rule of the type
system. The type system is finite (IEC 61131-3 types + CODESYS extensions), enumerated by the *"Diagnostic
candidates"* lists across `docs/codesys-reference/0*.md`. **Done = every in-scope row below is ✅ (a fixture
whose recorded CODESYS+TwinCAT verdict the LSP matches, or a documented divergence) AND `lsp-vs-compiler.ts`
returns empty on all 4 corpora.** Deductive leg (rows) + empirical leg (gap-finder).

Legend: ✅ done · 🟡 partial / verify · ⬜ gap · ⛔ not type-checking (see boundary).

---

## Current architecture → target architecture

| Layer | Today | Target |
|---|---|---|
| **Type model** | `InferredType = {kind, name?, scope?}` — name-based | `Type` carrying the checkable facts: elementary **range** (INT −32768..32767, BYTE 0..255…), **subrange** `{min,max}`, **array** `dims:[{lo,hi}]`, **string** `maxLen`, **enum** `members`, struct/FB members, alias target, pointer/ref target |
| **Constant eval** | none | `evalConst(expr) → ConstValue?` — fold literals + const expressions (`40000`, `INT#40000`, `-5`, index `20`) |
| **Assignability** | `isAssignable(lhs:string, rhs:string)` | `assignable(src:Type, srcConst?:ConstValue, dst:Type) → Violation?` over the rich model |
| **Application** | scattered per-check | one relation, applied at every type context |

## Pass 1 — Type-checking pass (the big lever)

Walk every expression/statement; type each node; apply `assignable` at each type context. **One pass + the
rich model + const-eval closes all of these at once**, because they are the same "does it fit?" question:

| # | Rule | Status | Closed by |
|---|---|---|---|
| C0 | `<X>_TO_<Y>(arg)` source-type mismatch → error | ✅ | assignable (conversion family) |
| C1 | Implicit narrowing (DINT→INT…) → error | ✅→verify wider set | assignable (narrowing) |
| C1b | Implicit LREAL→REAL → warning | ✅ | assignable (narrowing, warn) |
| D3 | Subrange literal/const out of range → error | ⬜ | const-eval + target subrange range |
| D9 | Constant/literal overflow of a type range → error | ⬜ | const-eval + target elementary range |
| D10 | Array constant index out of bounds → error/warn | ⬜ | const-eval + array dims |
| C3 | `REAL_TO_<INT>` on a provably out-of-range value → warning | ⬜ | const-eval + target range |
| — | String literal longer than `STRING(n)` → truncation | ⬜ | assignable (string maxLen) |
| — | Out-of-range integer → ENUM → error | ⬜ | assignable (enum members) |
| O0 | `MOD`/arith on REAL/incompatible operands → error | ✅ | operator typing |
| O2 | Integer expression overflow may be unintended → warn | ⬜ | const-eval (low priority) |
| P6 | Bit index out of range for the variable's type → error | ⬜ | type bit-width + const-eval |
| P2 | Partial access on a forbidden target → error | 🟡 | operand typing |
| C2 | `TRUNC` in an `INT` context → suggest `TRUNC_INT` | ⬜ | result-type check (migration hint) |
| P1 | int/int division feeding a REAL → suggest `1.0/…` | ⬜ | result-type check |

## Pass 2 — Type-declaration validation

Walk each `TypeExpr` / DUT once; validate its structural rules. One pass:

| # | Rule | Status |
|---|---|---|
| D1 | `POINTER TO BIT`, `REFERENCE TO BIT`, `ARRAY OF BIT`, `REFERENCE TO REFERENCE`, `POINTER TO REFERENCE`… → error | ⬜ |
| D2 | `BIT` outside a STRUCT/FB → error | ⬜ |
| D4 | `ENUM` with < 2 members → error | ⬜ |
| D5 | `ENUM` without `{attribute 'strict'}` → information | ⬜ |
| D6 | `STRUCT`/`UNION` with < 2 members → error | ⬜ |
| D7 | `STRUCT` nested member with an `AT` clause → error | ⬜ |
| D8 | `__VECTOR` size ∉ 1..8 or element ∉ {REAL,LREAL} → error | 🟡 |

## Pass 3 — Declaration-context validation (VAR sections & modifiers)

Walk each VAR section per POU kind; validate placement + modifiers. One pass:

| # | Rule | Status |
|---|---|---|
| V1 | `VAR_TEMP` in a function → error | ✅ |
| V2 | `VAR_TEMP` in a program w/ `subsequent` → error | 🟡 |
| V3 | `VAR_INST` outside a method → error | 🟡 |
| V4 | `VAR PERSISTENT` (no `RETAIN`) in an FB → error | ⬜ |
| V5 | `RETAIN` in a function → warning | ⬜ |
| V7 | `VAR_CONFIG` outside a GVL → error | 🟡 |
| V8 | `VAR_EXTERNAL` with an initializer → error | ⬜ |
| G6 | `call_after_*`/`call_before_*` POU with `VAR_INPUT` → error | ⬜ |

## Pass 4 — Call-site & flow checks (need cross-references / light flow)

| # | Rule | Status |
|---|---|---|
| V6 | `VAR_IN_OUT` passed a literal/constant → error | ⬜ (call-site) |
| O1 | Plain `AND`/`OR` guarding a null-ptr deref → warning (suggest `AND_THEN`) | ⬜ (flow) |
| L1 | `S=`/`R=` mixed in a multi-assignment chain → warning | ⬜ |

## Pragma checks (already their own pass — `check-pragmas.ts`)

| # | Rule | Status |
|---|---|---|
| G1 | Unknown `{attribute}` → warning | 🟡 (flag OFF; oracle-verify then enable) |
| G2 | Insert-location violation → warning | ⬜ |
| G3 | Required companion missing → error | ✅ |
| G4 | Conflicting pragmas → warning | ✅ |
| O4 | Deprecated `INI` operator → warning | ⬜ |

## Already mirrored (from other doc sections, not the candidate lists)

external-non-input-write · missing-interface-implementation/-signature · abstract-instantiation ·
unresolved-identifier (error) · duplicate-declaration · deref-on-non-pointer · FB_Init/FB_Exit lifecycle.

## Scope boundary

- **Parser-frontend sibling (not the typechecker, still LSP-worth):** malformed literals — comma-decimal
  `3,14` (P5), time literal missing `T#` (P4) / out-of-order units (P3). These are lexical/syntax errors the
  compiler catches while parsing; our lexer is currently *lenient* and accepts them silently. Tighten the
  lexer to reject + mirror the message as a separate **parser-conformance** track.
- **Not type-checking (correctly the IDE's job):** `%`-address vs device config (P7), `__NEW` dynamic-memory
  runtime (O3), persistent-var-list application config. A typechecker skips these because they are runtime /
  configuration facts, not type-system rules — the source is silent about them.

## Build order (high-leverage first)

1. **Type model + const-eval + `assignable`** (the Pass-1 core) — the single biggest lever; closes the whole
   range/overflow/bounds/narrowing/string/enum cluster and upgrades the existing name-string checks onto a
   real model. Regression-guarded by the existing conversion/narrowing/call-arg fixtures + the corpus.
2. **Pass 2** (type-declaration validation) — mechanical once the walker exists.
3. **Pass 3** (VAR-section/modifier validation) — extends the existing `varSectionPlacement` check.
4. **Pass 4 + pragmas + parser-conformance** — the long tail.

Each row: fixture here → `record:language` (CS + TC) → implement in the owning pass → mirror the message →
replay green + corpus 0-error. Matrix all ✅/⛔ + gap-finder empty ⇒ typechecker complete.
