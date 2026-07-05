# Diagnostic coverage matrix

**Purpose — make "did we cover everything?" a checkable question, not a hunch.** Completeness has two
independent legs:

1. **Deductive (top-down):** every *"Diagnostic candidates"* rule distilled across the CODESYS reference docs
   (`docs/codesys-reference/0*.md`) has a row here. That is the theoretical universe of source-level checks.
2. **Empirical (bottom-up):** `scripts/lsp-vs-compiler.ts` over the 4 real corpora returns **empty** — nothing
   the compiler emits on real code is missed. This backstops any rule the docs failed to distill.

**A row is DONE when** it has a conformance fixture whose recorded CODESYS+TwinCAT verdict the LSP matches
byte-for-byte (or a documented divergence). **The effort is DONE when** every in-scope row is ✅ *and* the
gap-finder is empty. Warnings/info are oracle-validated (recorded), never ratcheted; errors are ratcheted on
the corpus.

Status legend: ✅ checked + fixture matches oracle · 🟡 partial / opt-in flag off / needs verify · ⬜ gap (no
check yet) · ⛔ out of scope (parser-level, bridge/device-side, or the doc itself says "not worth it").

---

## 01 — Languages & editors

| # | Rule (trigger → verdict) | Status | LSP check / fixture | Notes |
|---|---|---|---|---|
| L1 | `S=`/`R=` mixed in a multi-assignment chain → **warning** (eval-order trap) | ⬜ | — | new check |
| L2 | `S=`/`R=`/`REF=` outside ExST context | ⛔ | — | doc: "probably not worth it" (no strict/ExST mode split) |

## 02 — Variables (VAR-section placement & modifiers)

| # | Rule | Status | LSP check / fixture | Notes |
|---|---|---|---|---|
| V1 | `VAR_TEMP` in a function → **error** | ✅ | `varSectionPlacement` · `type_var_temp_in_method` | mirrored per-vendor |
| V2 | `VAR_TEMP` in a program w/ `{attribute 'subsequent'}` → **error** | 🟡 | `varSectionPlacement`? | verify; overlaps G5 |
| V3 | `VAR_INST` outside a method → **error** | 🟡 | `varSectionPlacement`? | verify has a fixture |
| V4 | `VAR PERSISTENT` (no `RETAIN`) in an FB → **error** | ⬜ | — | new — variable-section |
| V5 | `RETAIN` in a function → **warning** | ⬜ | — | new — variable-section |
| V6 | `VAR_IN_OUT` passed a literal/constant at call site → **error** | ⬜ | `in-out.ts` (written) | needs call-site analysis + a check |
| V7 | `VAR_CONFIG` outside a GVL → **error** | 🟡 | `varSectionPlacement`? | verify |
| V8 | `VAR_EXTERNAL` with an initializer → **error** | ⬜ | — | new — variable-section |

## 03 — Operators

| # | Rule | Status | LSP check / fixture | Notes |
|---|---|---|---|---|
| O0 | `MOD` on a REAL operand → **error** | ✅ | `binaryOperatorTypeMismatch` · `op_modulo_on_real` | mirrored per-vendor |
| O1 | Plain `AND`/`OR` guarding a null-ptr deref → **warning** (suggest `AND_THEN`) | ⬜ | — | new; needs flow/null analysis |
| O2 | Integer expression where overflow may be unintended → low-prio **warning** | ⬜ | — | low priority |
| O3 | `__NEW` without `{attribute 'enable_dynamic_creation'}` on the FB → **error** | 🟡 | (see `op_sys_new_delete` divergence) | source-level part is a real gap |
| O4 | Deprecated `INI` operator → **warning** ("replaced by FB_Init since V3") | ⬜ | — | new small check |

## 04 — Type conversion

| # | Rule | Status | LSP check / fixture | Notes |
|---|---|---|---|---|
| C0 | `<X>_TO_<Y>(arg)` where arg isn't `<X>` → **error** | ✅ | `conversionSourceMismatch` · conversion fixtures | mirrored (`cannotConvert`) |
| C1 | Implicit narrowing assignment (DINT→INT etc.) → **error** | ✅ | `assignmentTypeMismatch` · `conversion_implicit_dint_to_int` | verify wider set (`narrowing.ts`) |
| C1b | Implicit LREAL→REAL → **warning** (possible loss) | ✅ | `narrowingConversion` · `narrowing_lreal_to_real` | per-vendor casing mirrored |
| C2 | `TRUNC` in an `INT` context → suggest `TRUNC_INT` | ⬜ | — | migration hint |
| C3 | `REAL_TO_<INT>` on a provably out-of-range value → **warning** | ⬜ | — | new; overlaps overflow |

## 05 — Operands & literals

| # | Rule | Status | LSP check / fixture | Notes |
|---|---|---|---|---|
| P1 | int/int division whose result feeds a REAL → suggest `1.0/…` (**warning**) | ⬜ | — | new |
| P2 | Partial access (`.%W`/`.%X`) on a forbidden target (call/literal/property) → **error** | 🟡 | (see `operand_partial_word` divergence) | verify |
| P3 | Time literal with out-of-order units → **error** | ⛔ | parser | parse-level, not semantic |
| P4 | Time literal missing `T#` prefix → **error** | ⛔ | parser | parse-level |
| P5 | Numeric literal with `,` instead of `.` → **error** | ⛔ | parser | parse-level |
| P6 | Bit index out of range for the source variable's type → **error** | ⬜ | — | new — needs the var's bit-width |
| P7 | `%`-address not matching device config → **error** | ⛔ | bridge-side | no device config in the LSP |

## 06 — Data types

| # | Rule | Status | LSP check / fixture | Notes |
|---|---|---|---|---|
| D1 | `POINTER TO BIT`, `REFERENCE TO BIT`, `ARRAY OF BIT`, `REFERENCE TO REFERENCE`, `POINTER TO REFERENCE`, … → **error** | ⬜ | — | new — type-expression check |
| D2 | `BIT` outside a STRUCT/FB → **error** | ⬜ | — | new |
| D3 | Subrange literal provably out of range → **error** | ⬜ | `range-bounds.ts` (written) | new `rangeBounds` check |
| D4 | `ENUM` with < 2 members → **error** | ⬜ | — | new |
| D5 | `ENUM` without `{attribute 'strict'}` → **information** | ⬜ | — | opt-in info |
| D6 | `STRUCT`/`UNION` with < 2 members → **error** | ⬜ | — | new |
| D7 | `STRUCT` nested member with an `AT <address>` clause → **error** | ⬜ | — | new |
| D8 | `__VECTOR` size outside 1..8 or element not REAL/LREAL → **error** | 🟡 | `vendorOnlyOperator` (`type_codesys_vector`) | verify |
| D9 | Constant/literal overflow of a type's range (INT>32767, BYTE>255, unsigned<0) → **error** | ⬜ | `overflow.ts` (written) | new `constantOverflow` check |
| D10 | Array constant index out of declared bounds → **error/warning** | ⬜ | `range-bounds.ts` (written) | new |

## 07 — Pragmas

| # | Rule | Status | LSP check / fixture | Notes |
|---|---|---|---|---|
| G1 | Unknown `{attribute '<name>'}` → **warning** (not in catalog) | 🟡 | `unknownPragma` (flag OFF) | oracle-verify then enable (`unknown_attribute_typo`) |
| G2 | Insert-location violation (`linkalways` not first line) → **warning** | ⬜ | — | new |
| G3 | Required companion missing (`instance-path` w/o `reflection`) → **error** | ✅ | `pragmaMissingCompanion` | |
| G4 | Conflicting pragmas on one symbol → **warning** | ✅ | `pragmaConflict` | |
| G5 | `{attribute 'subsequent'}` w/ `VAR_TEMP` in a program → **error** | 🟡 | (overlaps V2) | |
| G6 | `call_after_*`/`call_before_*` POU with `VAR_INPUT` → **error** | ⬜ | — | new |

## Beyond the doc "candidates" — checks the LSP already has (with fixtures)

These come from other doc sections, not the distilled candidate lists, and are already mirrored:
external-non-input-write (`'X' is no input of '<FB>'`), missing-interface-implementation/-signature,
abstract-instantiation, unresolved-identifier (error), duplicate-declaration, deref-on-non-pointer,
FB_Init/FB_Exit lifecycle signature, assignment/binary/conversion type-mismatch family, call-argument
mismatch, orphan/companion/message pragmas.

## Scoreboard (source-level rows only)

- ✅ done: **O0, C0, C1, C1b, V1, G3, G4** (+ the "beyond-candidates" set)
- 🟡 partial / verify: **V2, V3, V7, O3, P2, D8, G1, G5**
- ⬜ gap (needs fixture → record → implement → mirror): **L1, V4, V5, V6, V8, O1, O2, O4, C2, C3, P1, P6, D1, D2, D3, D4, D5, D6, D7, D9, D10, G2, G6**
- ⛔ out of scope: **L2, P3, P4, P5, P7**

**~23 open gaps + 8 to verify.** That is the finite, complete backlog. Each flows through the loop: write a
fixture here → `record:language` (CODESYS + TC) → implement the check to mirror the message → replay green +
corpus 0-error. When this scoreboard is all ✅/⛔ and `lsp-vs-compiler.ts` is empty on all 4 corpora, coverage
is provably complete.
