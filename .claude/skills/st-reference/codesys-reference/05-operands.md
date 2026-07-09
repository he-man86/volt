# 05 — Operands

> **Source:** https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_struct_reference_operands.html
> **Retrieved:** 2026-05-26
> **CODESYS version:** V3.5.22.0

## Summary

An operand is anything that can appear as an operator's argument: a literal value, a variable, a function call, or another expression. This section codifies every literal form CODESYS accepts and the rules for accessing array elements, struct members, FB members, bits, partial words, and physical addresses.

Several literal forms are uniquely CODESYS and not in the IEC base spec — UTF-8 strings, character literals, partial access — and these are easy to mis-write if the AI hasn't seen the syntax.

## Constants (named) and literals (unnamed)

Both are "constants" in the broad sense. **Named constants** are declared with `CONSTANT` and an identifier; **literals** are the bare-value forms like `42`, `'hello'`, `T#5s`.

### Named constants

```st
VAR_GLOBAL CONSTANT
  g_ciMAX_A : INT := 100;
  g_ciSPECIAL : INT := g_ciMAX_A - 10;   (* allowed: expression of literals + constants *)
END_VAR
```

**Rules:**
- Must have initial value at declaration.
- Initial value must be calculable at compile time — literal, named constant, or simple expression. Inputs and function calls are NOT allowed.
- Structured/user-defined-type constants are calculated at **runtime**, not compile time (specifically, init slots run for them).
- Read-only inside implementation — always appears on the RHS of an assignment.

## Literal forms

### `BOOL`

`TRUE`, `FALSE` (case-insensitive in identifiers but conventionally uppercase). Map to `1` and `0` respectively in numeric contexts.

URL: `_cds_operands_constant_bool.html`

### Numeric integer literals

| Base | Syntax | Example |
|---|---|---|
| Decimal | `<digits>` | `14`, `1_000_000` (underscores allowed) |
| Binary | `2#<bits>` | `2#1001_0011` |
| Octal | `8#<digits>` | `8#67` |
| Hex | `16#<digits>` | `16#A`, `16#FFFF_FFFF` |

Possible elementary integer types for a literal: `BYTE`, `WORD`, `DWORD`, `LWORD`, `SINT`, `USINT`, `INT`, `UINT`, `DINT`, `UDINT`, `LINT`, `ULINT`. The compiler picks the **smallest fitting** unless a typed-literal prefix forces a specific type.

**Gotcha — integer division:** Integer literals divide as integers. `1/10` → `0`. To get `0.1` you need `1.0/10` (float arithmetic). Easy AI mistake.

URL: `_cds_operands_constant_integer.html`

### Numeric float literals (`REAL`, `LREAL`)

Decimal or exponential form. **Period is the decimal separator** — `7,4` is a compile error.

```st
7.4
1/3.0          (* yields 0.333... *)
1.64e+009
-3.402823e+38  (* REAL min *)
1.0E-44        (* REAL smallest positive *)
3.402823e+38   (* REAL max *)
1.7976931348623157E+308  (* LREAL max *)
```

URL: `_cds_operands_constant_real.html`

### Typed literals

Prefix with `<TYPE>#`. Forces a specific type for the literal.

```st
diVar := DINT#34;
dwVar := DWORD#16#FF;
liVar := LINT#16#1_0000_0000;
```

Allowed types: `BOOL`, `SINT`, `USINT`, `BYTE`, `INT`, `UINT`, `WORD`, `DINT`, `UDINT`, `DWORD`, `REAL`, `LREAL`. **`LWORD`, `LINT`, `ULINT` are NOT listed** as accepting typed literals in the docs (but they're inferred from the integer literal alone if magnitude requires).

Type prefix must be **uppercase**.

URL: `_cds_operands_constant_typedliterals.html`

### String literals — Latin-1 / UTF-8

Single quotes for `STRING`:
```st
'Hello world!'
```

When the compile option **"UTF-8 Encoding for STRING"** is enabled (project-wide), all `STRING` literals are interpreted as UTF-8. Otherwise Latin-1 (ISO/IEC 8859-1).

**Escape sequences inside single-quoted strings** (the `$` escape character):

| Sequence | Meaning |
|---|---|
| `$<hh>` | Hex byte (`$41` → `A`, `$0D` → CR) |
| `$L`, `$l` | Line feed (= `$0A`) |
| `$N`, `$n` | New line (= `$0A`) |
| `$P`, `$p` | Form feed |
| `$R`, `$r` | Carriage return (= `$0D`) |
| `$T`, `$t` | Tab |
| `$$` | Literal `$` |
| `$'` | Literal `'` |

**Unknown characters compile as `?`** — silent corruption risk if pasting text from an unknown encoding.

URL: `_cds_operands_constant_string.html`

### UTF-8 string literals (single STRING, UTF-8 always)

CODESYS V3.5.18.0+ adds `UTF8#'...'` literals — always UTF-8 regardless of the compile option.

```st
constA : STRING := UTF8#'aäoöuü';
constB : STRING := UTF8#'Hello Allgäu $21';   (* '$21' decodes to '!' *)
```

Pair with `{attribute 'monitoring_encoding' := 'UTF-8'}` for correct monitoring.

URL: `_cds_operands_constant_string_utf8.html`

### `WSTRING` literals

**Double quotes** for `WSTRING` (UCS-2):
```st
"This is a WSTRING"
```

CODESYS code points: `U+0000`–`U+D7FF` and `U+E000`–`U+FFFF`. Each character is 2 bytes.

### Character literals — `UCHAR#`

Single Unicode character → `UDINT` value. Code point of the char.

```st
udiChar : UDINT := UCHAR#'à¸';      (* code point 3603 *)
udiChar_1 : UDINT := UCHAR#'⳧';     (* code point 11495 *)
```

URL: `_cds_operands_constant_character.html`

### `TIME` and `LTIME` literals

```st
T#14ms              (* 14 milliseconds *)
T#100s12ms          (* overflow in highest unit allowed *)
T#5d4h3m2s1ms       (* 5 days, 4 hours, ... *)
T#49D17H2M47S295MS  (* TIME max = 0xFFFFFFFF *)

LTIME#1000D15H23M12S34ms2us44ns
LTIME#213503D23H34M33S709MS551US615NS  (* LTIME max *)
```

**Rules:**
- Order matters: `d, h, m, s, ms` (and `us, ns` for `LTIME`). Out-of-order is a compile error.
- Time-marker prefix is required: `T#` / `TIME#` / `LTIME#` / `t#` / `time#` / `ltime#`.
- "Overflow" within a single unit at higher position is allowed (`T#100s` = 100,000 ms).

Bad examples:
```st
T#5m68s         (* error: 68s overflows seconds at lower position *)
15ms            (* error: missing T# prefix *)
T#4ms13d        (* error: units out of order *)
```

URL: `_cds_operands_constant_time.html`

### `DATE`, `DT`, `TOD` literals (and L-variants)

```st
DATE#2018-8-8        D#2018-8-8           date#1996-05-06     d#1970-1-1
DATE_AND_TIME#2018-8-8-12:55:1.234         DT#2020-2-7-12:55:1.234
TIME_OF_DAY#23:59:59.999                   TOD#12:3:4.567
LDATE#2018-8-8       LD#2020-2-7
LDATE_AND_TIME#2018-8-8-12:55:1.234567890  LDT#2020-2-7-12:55:1.234567890
LTIME_OF_DAY#23:59:59.999999999            LTOD#12:3:4.567890123
```

**Ranges:**
| Type | Min | Max |
|---|---|---|
| `DATE` (32-bit DWORD-backed) | `D#1970-1-1` | `D#2106-2-7` |
| `LDATE` (64-bit LWORD-backed) | `LD#1677-9-22` | `LD#2262-4-11` |
| `DT` (32-bit) | `DT#1970-1-1-0:0:0` | `DT#2106-2-7-6:28:15` |
| `TOD` (32-bit, ms resolution) | `TOD#0:0:0` | `TOD#23:59:59.999` |
| `LTOD` (64-bit, ns resolution) | `LTOD#0:0:0` | `LTOD#23:59:59.999999999` |

URL: `_cds_operands_constant_date.html`

## Variable access forms

### Array element

```st
aiCounter[2]
aiCardGame[1, 3]    (* multi-dimensional *)
```

URL: `_cds_operands_variables_accessing_variables.html`

### Struct/FB member

```st
sPolygon.aiStart
fbInstance.iVar1
```

### Bit access in an integer variable (`.<index>`)

0-based index. Allowed on all integer types (`BYTE`/`WORD`/`DWORD`/`LWORD`/`SINT`/`USINT`/...).

```st
wA.2 := xB;                   (* set bit 2 of wA *)
iX.gc_usiENABLE := TRUE;      (* index can be a constant *)
```

URL: `_cds_operands_variables_accessing_bits.html`

**Concurrency caveat:** Direct bit access in memory works on x86/x64 hardware. On ARM/PPC, bits are accessed via read-modify-write — concurrent bit writes from two tasks need a semaphore (`SysSemEnter`) or single-task discipline.

### Symbolic bit access (via `BIT` data type in a STRUCT/FB)

See [06-data-types.md](./06-data-types.md) `BIT`.

### Partial variable access (`.%<type><index>`)

CODESYS-specific. Lets you access part of a `BYTE`/`WORD`/`DWORD`/`LWORD` variable as a smaller type by index.

| `<type>` | Means |
|---|---|
| `X` | Single bit |
| `B` | Byte |
| `W` | Word |
| `D` | DWORD |
| `L` | LWORD |

```st
PartialVarB := GVL.Variable.%B0;        (* low byte *)
PartialVarX := array[idx].%X0;          (* lowest bit *)
PartialVarW := tempVariable.%W2;        (* 3rd word (index 2) *)
PartialVarD := ptr^.%D2;
PartialVarB := variable.%W1.%B1;        (* chainable *)
```

**Restrictions:**
- Only on non-temporary variables (named vars, array elements, struct/ptr access).
- **NOT allowed on:** function results, indexed expressions like `(1+i)`, literals, properties.
- Index maximum = (size of source / size of partial type) - 1. Exceeding → compile error.

URL: `_cds_partial_access.html`

### Addresses (`%I*`, `%Q*`, `%M*`)

Direct memory addressing for I/O and flag memory.

```
%<area><size><position>[.<bit>]
```

| `<area>` | Memory |
|---|---|
| `I` | Input |
| `Q` | Output |
| `M` | Flag memory |

| `<size>` | Width |
|---|---|
| `<none>` | bit |
| `X` | bit (explicit) |
| `B` | byte (8 bits) |
| `W` | word (16 bits) |
| `D` | dword (32 bits) |

```st
%QX7.5     (* output bit 7.5 *)
%Q7.5      (* same, size prefix optional *)
%IW215     (* input word 215 *)
%QB7       (* output byte 7 *)
%MD48      (* flag memory dword at position 48 *)
%IW2.5.7.1 (* multi-segment — interpretation depends on device config *)

VAR
  wVar AT %IW0 : WORD;     (* binding declaration *)
END_VAR
```

**Gotcha — online change:** If you use **pointers** to addresses, the targets can move during online change. **Absolute addresses** (the `%`-prefixed form) do NOT move. Prefer absolute over pointer when interfacing with stable hardware.

**Gotcha — incomplete addresses:** `%I*`/`%Q*`/`%M*` (with the `*` placeholder) are completed at deployment via `VAR_CONFIG`. See [02-variables.md](./02-variables.md).

URL: `_cds_operands_addresses.html`

### Function calls as operands

A function call is a valid operand and can appear anywhere a value is needed.

```st
Result := Fct(7) + 3;
```

**`TIME()` function** — returns ms-since-system-boot as a 32-bit `TIME`. Wraps at overflow.

```st
systime := TIME();
```

URL: `_cds_operands_functions.html`

## Sub-page catalog

Total: 14 pages.

| Sub-page | URL fragment |
|---|---|
| Constants overview | `_cds_struct_reference_operands.html` |
| Constant: BOOL | `_cds_operands_constant_bool.html` |
| Constant: Numeric (integer) | `_cds_operands_constant_integer.html` |
| Constant: REAL, LREAL | `_cds_operands_constant_real.html` |
| Constant: String | `_cds_operands_constant_string.html` |
| Constant: UTF8# String | `_cds_operands_constant_string_utf8.html` |
| Constant: Character (`UCHAR#`) | `_cds_operands_constant_character.html` |
| Constant: TIME, LTIME | `_cds_operands_constant_time.html` |
| Constants: Date and Time | `_cds_operands_constant_date.html` |
| Constant: Typed Literal | `_cds_operands_constant_typedliterals.html` |
| Access to variables in arrays/structures/blocks | `_cds_operands_variables_accessing_variables.html` |
| Bit access in variables | `_cds_operands_variables_accessing_bits.html` |
| Partial variable access | `_cds_partial_access.html` |
| Addresses | `_cds_operands_addresses.html` |
| Functions as operands | `_cds_operands_functions.html` |

## Notes for tooling

**Lexer needs to recognize all literal prefixes:**
- `T#`, `TIME#`, `LTIME#`, `D#`, `DATE#`, `DT#`, `DATE_AND_TIME#`, `TOD#`, `TIME_OF_DAY#`, `LD#`, `LDATE#`, `LDT#`, `LDATE_AND_TIME#`, `LTOD#`, `LTIME_OF_DAY#`
- `UTF8#`, `UCHAR#`
- `<TYPE>#` typed literal prefixes
- `2#`, `8#`, `16#` base prefixes
- Underscores in numeric literals (`16#FFFF_FFFF`)

**Diagnostic candidates (Stage 5+):**
- Integer literal divided by integer literal where result type is `REAL` → suggest `1.0/10` form (warning, "integer division")
- Partial access on a forbidden target (function call, literal, property) → error
- Time literal with out-of-order units → error
- Time literal missing `T#` prefix → error
- Numeric literal with comma instead of period → error
- Bit index out of range for the source variable's type → error
- Address using `%` form on a target that doesn't match the device config → bridge-side only (we don't have device config)

**Hover augmentation:**
- Hovering on a time literal shows the millisecond/nanosecond value
- Hovering on `%`-form address shows the area, size, and bit position breakdown
- Hovering on `UTF8#` shows the encoding behavior + recommended `monitoring_encoding` companion pragma
- Hovering on `$<hh>` inside a string shows the resolved character
