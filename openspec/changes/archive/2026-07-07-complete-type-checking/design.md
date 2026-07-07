# Design — complete-type-checking

## Proven principle: a conversion-classification function over a type lattice

This is how production type checkers implement implicit conversions — we adopt it, we do not invent:

| Compiler | Mechanism |
|---|---|
| **Roslyn (C#)** | `Conversions.ClassifyConversion(src, dst)` → a `Conversion` kind (`Identity`, `ImplicitNumeric`, `ExplicitNumeric`, …). The implicit/explicit numeric table is the C# spec. |
| **Clang / GCC (C)** | the standard's *usual arithmetic conversions* + a rank/signedness classification behind `-Wconversion` / `-Wsign-conversion`. |
| **TypeScript** | `isTypeAssignableTo` — a subtype **relation**, computed, not tabulated. |

The invariant across all of them: **one total function `classify(src, dst) → kind`, driven by the type
lattice, sourced from the language's conversion spec.** Severities and messages are a *presentation* layer over
the kind. Nobody reverse-engineers rules from compiler output; they encode the spec and *test* against the
compiler.

## Applying it here

The language spec is **IEC 61131-3** (the `ANY_ELEMENTARY` hierarchy: `ANY_NUM` = `ANY_INT` ∪ `ANY_REAL`,
`ANY_BIT`, `ANY_DATE`, plus `TIME`/`STRING`), and the reference implementations are **CODESYS + TwinCAT**
(which add specific implicit-conversion behavior + warning wording on top of the standard). We already have the
lattice: `types/elementary.ts` carries `{ family, bits, signed, rank }` for every elementary type.

### The classification

```
ConversionKind =
  | "identity"        // same type — no diagnostic
  | "widen"           // safe implicit (lower rank → higher, same family/sign discipline) — no diagnostic
  | "narrow"          // higher → lower width, same family — WARNING "possible loss of information"
  | "sign-change"     // same width, signed ↔ unsigned (ANY_INT ↔ ANY_BIT / signed↔unsigned) — WARNING "change of sign"
  | "cross-family"    // e.g. INT ↔ REAL, ANY_NUM ↔ TIME — per IEC/vendor: implicit-ok, warn, or error
  | "incompatible"    // no implicit conversion — ERROR (explicit X_TO_Y required)
```

`classifyConversion(src, dst): ConversionKind` lives in `types/` beside `elementary`/`compat`, reads only the
lattice facts, and is the SINGLE owner of the relation. `isAssignable` (already exists) becomes
`classify(...) !== "incompatible"`; `isNarrowing` becomes `classify(...) === "narrow"`. No second table.

### This COLLAPSES existing duplication — it is not a new layer

The current `types/compat.ts` already splits one relation into two functions that each recompute the lattice:
`isAssignable` (via `elementaryAssignable`) does the `rr <= lr` rank comparison, and `isNarrowing` does the
`rr > lr` half — the same math, written twice. And both **ignore `signed`**, which `elementary.ts` already
carries — that unused fact is exactly why sign-change is missed today. `classifyConversion` is the common core
those two are each half-implementing: after it, `isAssignable`/`isNarrowing` are one-liners over it, the rank
math lives in ONE place, and `signed` finally gets read. The `analysis` checks already delegate to `compat`
(`assignment.ts` → `isAssignable`, `narrowing.ts` → `isNarrowing`), so they don't duplicate anything — they
keep delegating and just map the returned kind to a severity/message. Net: fewer moving parts than today, not
more. No parallel type, no second lattice, nothing "on top".

### From kind to diagnostic

The `analysis` layer maps a kind at an assignment/operation site to a diagnostic via `messages` (per-vendor
wording), NOT with `if`s in the check:

- `narrow` / `sign-change` → **WARNING** (code still compiles) — the generalized `narrowing.ts` → `implicit-conversion.ts`.
- `incompatible` at an `X_TO_Y` arg → the existing `conversion-source-mismatch` ERROR.
- `incompatible` at a plain assignment → the existing `assignment-type-mismatch` ERROR.

So the errors we already emit and the warnings we're adding share ONE classification. Overlaps collapse instead
of drifting.

## The oracle is the validator, not the rule source

The exact IEC/vendor edges (does `INT := UINT` warn or error? does `INT := 40000` warn or error? — we already
learned live it *warns*) are pinned by recording, but recording **validates** `classifyConversion`; it does not
define it. Mechanism:

1. Generate the conversion matrix (every elementary pair × the contexts that change the answer: plain
   assignment, typed-literal `T#lit`, untyped literal, arithmetic result, comparison).
2. Record it once against live CODESYS + TwinCAT (the recorder already exists; matrix cases are auto-generated
   `LanguageTest`s).
3. Diff the recorded severity+wording against what `classifyConversion` + `messages` produce. **Every
   disagreement is a defect** — either our classification is wrong (fix the function) or it's a vendor quirk
   (encode it in the lattice/rule, per vendor). The existing `replay.test.ts` is the diff engine.
4. Commit a representative slice as fixtures (the matrix is research; ~a dozen fixtures per family guard the
   rule in CI — do NOT bloat the catalog with all ~200).

## Invariants (unchanged, load-bearing)

- **Conservative-skip stays sacred**: `UNKNOWN` on either side → no diagnostic. 0-FP on the corpus is the floor.
- **Per-vendor wording** via `messages` (CODESYS/TC differ; some uppercase names; some checks are one-vendor —
  e.g. TC ignores unknown attributes).
- **Warnings never enter the zero-ERROR precision floor** — validated by the oracle, reported separately by the
  corpus harness (same treatment as `narrowing-conversion` today).
- **No new type system** — this completes `types/` (one more function + the rules), it does not replace it.

## Non-goals

- Full data-flow / range analysis (const-eval overflow already handled where the compiler does; we do not
  invent range tracking the compilers don't do — the `constant-overflow` removal is the precedent).
- CFC/SFC or non-elementary composite conversion rules beyond what a fixture proves the compiler emits.
