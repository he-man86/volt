# 04 — Type Conversion Operators

> **Source:** https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_conversion_operators.html
> **Retrieved:** 2026-05-26
> **CODESYS version:** V3.5.22.0

## Summary

CODESYS provides explicit type-conversion operators for every elementary type pair: `<src>_TO_<dst>`. Two overloaded variants — `TO_<dst>` and `TRUNC*` — sit on top.

This section is closely linked to [10-keywords.md](./10-keywords.md): each `*_TO_*` form is its own keyword tokenized by the lexer. Hundreds of valid keyword strings live here.

## Critical rules

1. **Implicit conversion from "larger" to "smaller" types is NOT permitted.** You cannot pass a `DINT` to an `INT` parameter without an explicit conversion. The compiler is strict here — this is one of the few places ST is stricter than C.
2. **Information loss is the responsibility of the programmer.** Once you write `INT_TO_SINT(<value>)`, runtime behavior on out-of-range is **undefined and target-dependent** (might wrap, might truncate, might trap).
3. **`REAL`/`LREAL` → integer conversion is target-dependent if out-of-range.** Even an exception is possible. CODESYS doc explicitly says: "To get code that is independent of the target system, the application has to catch out-of-range violations."

## Naming pattern

```
<source-type>_TO_<dest-type>(<value>)
```

Examples:
```st
i := INT_TO_DINT(15);
r := DINT_TO_REAL(i);
s := REAL_TO_STRING(r);
t := TIME_TO_DINT(T#5s);
```

## Conversion families (one CODESYS page per source type)

### From `BOOL` — `BOOL_TO_<type>`

`TRUE → 1`, `FALSE → 0` for numeric types.
Special cases:
| Target | `BOOL_TO_*(TRUE)` |
|---|---|
| `STRING` | `'TRUE'` |
| `WSTRING` | `"TRUE"` |
| `DATE` | `D#1970-1-1` (0-bit set; visually same as epoch) |
| `DT` (`DATE_AND_TIME`) | `DT#1970-01-01-0:0:1` |
| `TIME` | `T#1ms` |
| `TOD` | `TOD#0:0:0.001` |
| `LTIME` | `LTIME#1NS` |
| `LTOD` | `LTOD#0:0:0.000000001` |
| `BIT` | `TRUE` |

URL: `_cds_operator_bool_to.html`

### From integer types — `<int>_TO_<type>`

Every integer↔integer combination; integer↔float; integer↔BOOL (zero/nonzero); integer↔time; integer↔string. URL: `_cds_operator_convert_integer.html`

**Truncation:** Larger-to-smaller integer conversions discard high bits. Behavior on overflow depends on the target (per the operators chapter quirk — intermediate values use native register width).

### From `REAL` / `LREAL` — `REAL_TO_<type>` / `LREAL_TO_<type>`

URL: `_cds_operator_real_to.html`

- `*_TO_INT`/`*_TO_DINT` etc.: result undefined if value is out of integer range.
- `*_TO_STRING`: returns a decimal-notation string.
- `*_TO_LREAL` / `LREAL_TO_REAL`: precision-changing; may lose digits.

See `TRUNC` and `TRUNC_INT` below for explicit truncation.

### From `STRING` / `WSTRING` — `STRING_TO_<type>` / `WSTRING_TO_<type>`

URL: `_cds_operator_string_to.html`

Parses the string. Failure modes (non-numeric content, overflow) are target-dependent.

### From `TIME` / `LTIME` — `TIME_TO_<type>` / `LTIME_TO_<type>`

URL: `_cds_operator_time_to.html`

`TIME` is stored internally as `DWORD` (ms resolution); `LTIME` as `LWORD` (ns resolution). Conversion to integer yields the raw count.

Examples:
```st
TIME_TO_BOOL(T#0MS)  → FALSE
TIME_TO_BOOL(T#59ms) → TRUE   (* nonzero *)
TIME_TO_DT(T#5d4h3m2s1ms) → DT#1970-1-... (* internal cast *)
```

### From `DATE` / `DT` / `TOD` / `LDATE` / `LDT` / `LTOD` — `<dt>_TO_<type>`

URL: `_cds_operator_date_to.html`

Same internal-DWORD/LWORD basis. Conversions to integer return the seconds-since-epoch (or ns equivalent for the L-prefixed variants).

## Overloaded `TO_<type>` form

URL: `_cds_operator_to_xxx.html`

You can write `TO_INT(<value>)` instead of `<srcType>_TO_INT(<value>)`. The compiler infers `<srcType>` from the argument. Use when the source type is obvious or when writing generic code.

```st
i := TO_INT(realValue);   (* equivalent to REAL_TO_INT *)
i := TO_INT(strValue);    (* equivalent to STRING_TO_INT *)
```

## `TRUNC` and `TRUNC_INT`

These are specifically for `REAL → integer` with explicit truncation (towards zero):

| Operator | Result type | Notes |
|---|---|---|
| `TRUNC(<real>)` | `DINT` | **CODESYS V3**: REAL → DINT |
| `TRUNC_INT(<real>)` | `INT` | Same semantics as `TRUNC` in CoDeSys V2.3 |

**CRITICAL legacy quirk:** In CoDeSys V2.3, `TRUNC` was REAL→INT. In V3, `TRUNC` became REAL→DINT, and `TRUNC_INT` was introduced for the old REAL→INT behavior. When CODESYS imports a V2.3 project, it **auto-replaces** `TRUNC` with `TRUNC_INT` to preserve semantics.

```st
diVar := TRUNC(1.9);       (* 1; DINT *)
diVar := TRUNC(-1.4);      (* -1; DINT *)
iVar := TRUNC_INT(1.9);    (* 1; INT *)
iVar := TRUNC_INT(-1.4);   (* -1; INT *)
```

Like all REAL→integer conversions: undefined behavior if the value exceeds the target type's range.

URLs: `_cds_operator_trunc.html`, `_cds_operator_trunc_int.html`

## Sub-page catalog

Total: 9 pages.

| Sub-page | URL fragment |
|---|---|
| Overloading conversion (`TO_*`) | `_cds_operator_to_xxx.html` |
| BOOL → ... | `_cds_operator_bool_to.html` |
| Integer → ... | `_cds_operator_convert_integer.html` |
| REAL, LREAL → ... | `_cds_operator_real_to.html` |
| STRING, WSTRING → ... | `_cds_operator_string_to.html` |
| TIME, LTIME → ... | `_cds_operator_time_to.html` |
| DATE, DT, TOD, LDATE, LDT, LTOD → ... | `_cds_operator_date_to.html` |
| TRUNC | `_cds_operator_trunc.html` |
| TRUNC_INT | `_cds_operator_trunc_int.html` |

## Notes for tooling

**Lexer impact:** Every `<src>_TO_<dst>` combination is a distinct keyword. The combinatorial blow-up (~25 elementary types × ~25 targets = ~600 names) suggests two approaches:
- Enumerate explicitly in `ALL_KEYWORDS` (current approach, exhaustive but bulky)
- Treat as a derived pattern: tokenize `<IDENT>_TO_<IDENT>` and check both sides match elementary type names. Cleaner but parser-level rather than lexer-level.

Recommend continuing the enumeration approach for V1; revisit if the lexer file gets unwieldy.

**Diagnostic candidates (Stage 5):**
- Implicit narrowing assignment (`iVar : INT := diSomething;` where `diSomething` is `DINT`) → error ("explicit conversion required")
- `TRUNC` used in a context expecting `INT` instead of `DINT` → suggest `TRUNC_INT` (especially during V2.3 → V3 migrations)
- `REAL_TO_<INT>` on a value provably out of range (literal or analyzable constant) → warning

**Hover augmentation:**
- Hovering any `_TO_*` operator shows the source/dest semantics and any known target-dependent caveats
- Hovering `TRUNC` shows the V2.3 vs V3 difference

**Stage 5 deep-dives this into `src/reference/type-conversion.ts` as a permitted-coercions matrix.**
