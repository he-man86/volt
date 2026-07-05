## Context

`semantic/type-infer.ts` is a clean, deliberately-lean, well-seamed foundation: one bottom-up `inferExprType`
that every consumer (checks + LSP queries) calls, one `typeExprToInferred` mapping declared→inferred, and it
already carries `typeExpr` for descent into arrays/pointers. The type-rule knowledge lives in
`checks/check-assignment-types.ts` `isAssignable(lhs: string, rhs: string)`, which already encodes the IEC
lattice (numeric rank, isolation, BIT, enum) — **oracle-calibrated**. The two things it structurally cannot do
are our two additions: it compares name strings (no range) and `literalType` skips numeric literals (no value).
So this is **enrichment along existing seams**, not a rewrite.

The calibration authority for every type rule is the reference docs (`04-type-conversion.md`,
`06-data-types.md`) + the live-compiler oracle — never invented. This design's task 0 extracts that lattice and
inventories the existing rules so nothing verified is lost.

## Goals / Non-Goals

**Goals**
- A `Type` model rich enough to answer range/bounds/overflow/member/length questions.
- `evalConst` for literals + constant expressions.
- One `assignable` relation over the model, applied at every type context, closing the Pass-1 cluster.
- Migrate the existing name-string checks onto it with zero behaviour regression (fixtures + corpus guard).

**Non-Goals**
- Not a compiler: no IR, optimization, codegen, linking.
- Not runtime/config analysis: device addresses, `__NEW` dynamic memory, persistent-var-list config stay the
  IDE's job (they are not type-system facts).
- Not the parser frontend: malformed-literal lexing (`3,14`, missing `T#`) is a sibling parser-conformance
  track, out of this change.
- No independent message wording: every diagnostic mirrors the vendor compiler via the recorder.

## Decisions

### Task 0 — the IEC type lattice (extracted from docs 04 + 06)

**Elementary numeric ranges** (doc 06 — the source of truth for overflow/subrange):

| Type | Min | Max | Bits | Signed | Family |
|---|---|---|---|---|---|
| `BOOL` | 0 | 1 | 1 | — | bool |
| `BYTE` | 0 | 255 | 8 | no | bit-string |
| `WORD` | 0 | 65 535 | 16 | no | bit-string |
| `DWORD` | 0 | 4 294 967 295 | 32 | no | bit-string |
| `LWORD` | 0 | 2⁶⁴−1 | 64 | no | bit-string |
| `SINT` | −128 | 127 | 8 | yes | int |
| `USINT` | 0 | 255 | 8 | no | int |
| `INT` | −32 768 | 32 767 | 16 | yes | int |
| `UINT` | 0 | 65 535 | 16 | no | int |
| `DINT` | −2 147 483 648 | 2 147 483 647 | 32 | yes | int |
| `UDINT` | 0 | 4 294 967 295 | 32 | no | int |
| `LINT` | −2⁶³ | 2⁶³−1 | 64 | yes | int |
| `ULINT` | 0 | 2⁶⁴−1 | 64 | no | int |
| `REAL` | ±1.0E−44 | ±3.402823E+38 | 32 | yes | real |
| `LREAL` | ±4.94E−324 | ±1.7976931348623157E+308 | 64 | yes | real |

64-bit ranges exceed JS `number` — carry min/max as **`bigint`** in the model (const-eval of integers is
exact; REAL/LREAL use `number`).

**Type groups (ANY_\* families, doc 06)** — govern which implicit conversions are legal:
`Integer = {SINT,USINT,INT,UINT,DINT,UDINT,LINT,ULINT + bit-string BYTE,WORD,DWORD,LWORD,BIT}` ·
`Real = {REAL,LREAL}` · `Time = {TIME,LTIME}` · `Date+Time = {DATE,TOD,DT,LDATE,LTOD,LDT}` ·
`Standard = Elementary + {STRING,WSTRING}`.

**Conversion rules (doc 04 "critical rules"):**
1. Implicit **larger→smaller is NOT permitted** (needs explicit `_TO_`). ← this is the existing `rr <= lr`.
2. `REAL/LREAL → INT` out-of-range is target-dependent (undefined) → **warning** when provably out of range.
3. Cross-family (Integer↔Time↔Date↔BOOL↔STRING) implicit conversion is **not permitted** → the existing
   `ISOLATED` set.

**Legacy-rule inventory (from `isAssignable`) — must be preserved by `assignable`:**
- `NUMERIC_RANK` (SINT/USINT/BYTE=1 · INT/UINT/WORD=2 · DINT/UDINT/DWORD=3 · LINT/ULINT/LWORD=4 · REAL=5 ·
  LREAL=6), rule `rr <= lr` → **generalized** into per-type `{family, bits, signed}`: assignable iff same
  family and `dst.bits >= src.bits` (with the REAL/LREAL widening + the rank collapsing onto bits).
- `REAL↔LREAL` both-directions assignable; **LREAL→REAL is a narrowing WARNING** (handled by the narrowing
  check, not an error here) — must stay non-error in `assignable`.
- `BIT↔BOOL` freely compatible.
- Enum isolation: enum↔enum(different) not assignable; enum↔scalar rejects the `ENUM_ISOLATED` set
  (BOOL/STRING/WSTRING/REAL/LREAL/TIME/DATE families), integer↔enum allowed (conservative).
- **Return-true-when-unsure** (unknown type names) — the zero-FP contract; `assignable` keeps it.

### The `Type` model (enriches `InferredType`, additive)

```
Type =
  | { kind:'elementary'; name; family; bits; signed; range?:{min:bigint;max:bigint} }
  | { kind:'subrange'; base:Type/*elementary*/; min:bigint; max:bigint }
  | { kind:'string'; wide:boolean; maxLen:number }
  | { kind:'array'; element:Type; dims:{lo:bigint;hi:bigint}[] }
  | { kind:'enum'; scope:Scope; members:Set<string> }
  | { kind:'struct'|'function_block'; scope:Scope }
  | { kind:'alias'; underlying:Type }
  | { kind:'pointer'|'reference'; target:Type }
  | { kind:'unknown' }        // the safe default — consumers act only on known types
```
`UNKNOWN_TYPE` stays the total-function fallback (zero-FP). Ranges/bounds/maxLen/members are read off the
already-carried `typeExpr` + the elementary table above — not re-derived.

### `evalConst(expr) → ConstValue | undefined`

Folds: integer/real/typed literals (`40000`, `INT#40000`, `16#FF`), unary `-`, named `CONSTANT` refs whose
init is constant, and constant binary arithmetic. `undefined` = not a compile-time constant (→ no range check,
never a false positive). Integers fold to `bigint`.

### `assignable(src:Type, srcConst:ConstValue|undefined, dst:Type) → Violation | undefined`

One relation, returns a structured violation (`{ kind:'narrowing'|'overflow'|'subrange'|'mismatch'|'string-len'
|'enum-range'; from; to; … }`) or `undefined`. Message rendering stays via `cannotConvert` / per-vendor
templates so mirroring is unchanged. Applied at every type context by Pass 1.

## Risks / Trade-offs

- **IEC lattice subtleties** (signed/unsigned mixing, ANY_* generic stdlib params, the narrow warn-vs-error
  boundary per vendor). *Mitigation:* the whole design is calibration-first — fixture → record CS+TC → then
  code the rule; the existing `isAssignable` rules + their fixtures are the regression floor, so a
  generalization that breaks a known rule fails immediately.
- **64-bit ranges vs JS number.** *Mitigation:* `bigint` for integer ranges/const-eval.
- **Migration regressions** in the 7 existing checks. *Mitigation:* they keep their fixtures; route through
  `assignable` behind the same messages; corpus 0-error is the net.
- **Scope creep toward a compiler.** *Mitigation:* the Non-Goals boundary — runtime/config and parser-frontend
  rows are explicitly excluded in `coverage-matrix.md`.
