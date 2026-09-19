# What operations are there? — the inventory, and what each one has been asked

The question that started this ("div/mul by same type other type .. what other operations are there?"), answered as a
checklist. **✅ means every cell was asked of a real CODESYS and the answer is in the fixture**; anything else is the
old standard — whichever cases somebody thought of.

## Declaration and storage

| # | operation | state |
|---|---|---|
| 1 | the value with **no initializer** | ✅ `types/primitive-default.ts` — all 29 primitives |
| 2 | init **at min, at max, one below, one above** | ✅ `types/primitive-bounds.ts` — all 16 numeric types, 64 cases |
| 3 | init with a **typed literal** of another type (`i : INT := SINT#5`) | partial — 1 fixture |
| 4 | init with a **constant expression** | partial |
| 5 | `CONSTANT`, `RETAIN`, `PERSISTENT` | ✅ `declarations/section-semantics.ts` — 22 cells over three scans |
| 6 | `AT %I* / %Q* / %M*` direct address | ✅ `declarations/addresses.ts` — the ALIASING half is `not-lowered` |
| 7 | as an **array element** / **struct field** / **FB input** | partial |

## Arithmetic

| # | operation | state |
|---|---|---|
| 8 | `+ - *` at the type's edge, **same type** | ✅ `operators/arithmetic-edges.ts` — 14 types × 3 |
| 9 | `/` and `MOD` **by zero** | ✅ same file — 14 types × 2. Divide stops; MOD is 0 |
| 10 | `MIN / -1` | ✅ signed types. Wraps at 8/16 bits, **stops** at 32/64 |
| 11 | **mixed-type** `+` and `/` — the meet | ✅ `operators/mixed-type.ts` — 70 pairs |
| 12 | mixed-type **`-`, `*`, `MOD`** | ✅ all five operators, 175 cells — the meet does not depend on which |
| 13 | unary `-` and `NOT`, per operand type | ✅ `operators/unary-operand.ts` — 35 probes |
| 14 | **REAL overflow** at run time | ✅ `operators/real-overflow.ts` |
| 15 | the ten **math functions' domain edges** | ✅ `operators/math-domain.ts` — 21 probes |
| 16 | `EXPT` / `**` across operand types | partial — REAL when BOTH are REAL, LREAL otherwise, measured |

## Comparison

| # | operation | state |
|---|---|---|
| 17 | `= <> < > <= >=` **per type** | ✅ `operators/comparison.ts` |
| 18 | across **signedness** and **width** | ✅ same file — the two sides meet in the SIGNED type |
| 19 | `=` on a **REAL**, and on a **NaN** (never equal to itself) | ✅ same file |
| 20 | comparing **STRING**s, **TIME**s, **DATE**s, **enums** | ✅ for STRING — `strings/ordering.ts`, unsigned byte by byte |

## Bitwise and shift

| # | operation | state |
|---|---|---|
| 21 | `AND OR XOR` per type, and on a **BOOL** vs an **integer** | ✅ `operators/bitwise.ts` |
| 22 | `SHL SHR ROL ROR` per type | ✅ same file |
| 23 | a shift **at or past the type's width** | ✅ same file — it is MASKED to the width |

## Conversion — the biggest single surface

| # | operation | state |
|---|---|---|
| 24 | `<A>_TO_<B>` for **every ordered pair** | ✅ 630 cells across five files; the whole date family is one tick rule |
| 25 | out-of-range, negative, **NaN**, **infinity** into an integer | ✅ 192 cells — at the DESTINATION'S register width, which closed both divergences |
| 26 | `TRUNC`, `REAL_TO_INT` **rounding direction** | ✅ half AWAY from zero, on eight halves rather than one |

## Selection, limit and strings

| # | operation | state |
|---|---|---|
| 27 | `MIN MAX LIMIT SEL MUX` per type and mixed | ✅ `operators/selection.ts` — 49 cells; MIN and MAX inferred `unknown` |
| 28 | `LEN LEFT RIGHT MID CONCAT INSERT DELETE REPLACE FIND` at their edges | ✅ `strings/string-edges.ts` — DELETE at 0 removes a character |
| 29 | `STRING(n)` truncation, escapes, **non-ASCII** | ✅ `strings/escapes.ts` — `$hh` is a WINDOWS-1252 byte, and the divergence is closed |

## What the ✅ rows cost, and what they found

Six sweeps, ~280 fixtures, one sitting — the first of several; the suite is 2458 fixtures now. They found: the fault model was wrong (it is dividing by zero and the
logarithm of zero, not "an infinity"); `BIT` was stored as an integer; `__XINT`/`__UXINT`/`__XWORD` are missing from
the type system; `__VECTOR` had no usable bounds; an overflowing REAL literal is an infinity and not an error;
unary minus widens an 8-bit operand; `NOT` was implemented for signed integers only; `BYTE + BYTE` is `USINT`;
integer division is not wrapping; and every mixed-type expression inferred `unknown`, which silenced every check
downstream of it.

The sweeps that followed found: the REAL → integer conversion happens at the DESTINATION'S register width (which
closed the two oldest divergences); `MIN` and `MAX` inferred `unknown`; `DELETE` at position 0 removes a character;
28 date conversions were refused as "not measured" and are one tick rule; a composite `VAR_TEMP` starts over too;
`$hh` is a Windows-1252 byte; `ANYNUM_TO_*` is not a CODESYS function; two STRINGs meet at the WIDER capacity;
`__POSITION` is a call whose missing parentheses eat the next token; and `CALC` is the IL conditional call, not a
reserved name.

Nine product bugs from six sweeps — and twenty-odd across the whole census, in sweeps that mostly confirmed
what we already did. That rate was the argument for the ❌ rows, and it held: almost every one of them turned up
something. What is left partial is rows 3, 4, 7 and 16 — an initializer's FORM crossed with the section and the
type, and `EXPT` across both widths.
