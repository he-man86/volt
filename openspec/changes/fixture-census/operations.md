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
| 5 | `CONSTANT`, `RETAIN`, `PERSISTENT` | partial |
| 6 | `AT %I* / %Q* / %M*` direct address | partial |
| 7 | as an **array element** / **struct field** / **FB input** | partial |

## Arithmetic

| # | operation | state |
|---|---|---|
| 8 | `+ - *` at the type's edge, **same type** | ✅ `operators/arithmetic-edges.ts` — 14 types × 3 |
| 9 | `/` and `MOD` **by zero** | ✅ same file — 14 types × 2. Divide stops; MOD is 0 |
| 10 | `MIN / -1` | ✅ signed types. Wraps at 8/16 bits, **stops** at 32/64 |
| 11 | **mixed-type** `+` and `/` — the meet | ✅ `operators/mixed-type.ts` — 70 pairs |
| 12 | mixed-type **`-`, `*`, `MOD`** | ❌ the same 35 pairs, three more operators |
| 13 | unary `-` and `NOT`, per operand type | ✅ `operators/unary-operand.ts` — 35 probes |
| 14 | **REAL overflow** at run time | ✅ `operators/real-overflow.ts` |
| 15 | the ten **math functions' domain edges** | ✅ `operators/math-domain.ts` — 21 probes |
| 16 | `EXPT` / `**` across operand types | partial |

## Comparison

| # | operation | state |
|---|---|---|
| 17 | `= <> < > <= >=` **per type** | ❌ one fixture per operator, not per type |
| 18 | across **signedness** and **width** | ❌ one pair (`same_width_mixed_sign_order`) |
| 19 | `=` on a **REAL**, and on a **NaN** (never equal to itself) | ❌ and NaN is now known to be reachable |
| 20 | comparing **STRING**s, **TIME**s, **DATE**s, **enums** | partial |

## Bitwise and shift

| # | operation | state |
|---|---|---|
| 21 | `AND OR XOR` per type, and on a **BOOL** vs an **integer** | ❌ |
| 22 | `SHL SHR ROL ROR` per type | ❌ |
| 23 | a shift **at or past the type's width** | ❌ the classic undefined-behaviour cell |

## Conversion — the biggest single surface

| # | operation | state |
|---|---|---|
| 24 | `<A>_TO_<B>` for **every ordered pair** | ❌ ~26 × 26. Phase 1 of `tasks.md` |
| 25 | out-of-range, negative, **NaN**, **infinity** into an integer | partial — and two known divergences live here |
| 26 | `TRUNC`, `REAL_TO_INT` **rounding direction** | partial |

## Selection, limit and strings

| # | operation | state |
|---|---|---|
| 27 | `MIN MAX LIMIT SEL MUX` per type and mixed | partial |
| 28 | `LEN LEFT RIGHT MID CONCAT INSERT DELETE REPLACE FIND` at their edges | partial |
| 29 | `STRING(n)` truncation, escapes, **non-ASCII** | partial — a known divergence (STRING is UTF-8) |

## What the ✅ rows cost, and what they found

Six sweeps, ~280 fixtures, one sitting. They found: the fault model was wrong (it is dividing by zero and the
logarithm of zero, not "an infinity"); `BIT` was stored as an integer; `__XINT`/`__UXINT`/`__XWORD` are missing from
the type system; `__VECTOR` had no usable bounds; an overflowing REAL literal is an infinity and not an error;
unary minus widens an 8-bit operand; `NOT` was implemented for signed integers only; `BYTE + BYTE` is `USINT`;
integer division is not wrapping; and every mixed-type expression inferred `unknown`, which silenced every check
downstream of it.

Nine product bugs from six sweeps. That rate is the argument for the ❌ rows.
