# 06 — Data Types

> **Source:** https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_reference_datatypes.html
> **Retrieved:** 2026-05-26
> **CODESYS version:** V3.5.22.0

## Summary

A variable's data type determines its memory size, its valid value range, and which operators apply. CODESYS supports all IEC 61131-3 elementary types plus several CODESYS-specific extensions (`BIT`, `__UXINT`/`__XINT`/`__XWORD`, `__VECTOR`, `VERSION`). User-defined types (DUTs — STRUCT, ENUM, ALIAS, UNION, SUBRANGE) extend these.

This section is the type catalog. Each entry: range/size, key rules, init syntax, gotchas.

## Type group glossary (from the CODESYS overview)

| Group | Members |
|---|---|
| Elementary | `__UXINT`, `__XINT`, `__XWORD`, `BIT`, `BOOL`, `BYTE`, `DATE`, `DATE_AND_TIME`, `DINT`, `DT`, `DWORD`, `INT`, `LDATE`, `LDATE_AND_TIME`, `LDT`, `LINT`, `LREAL`, `LTIME`, `LTOD`, `LWORD`, `REAL`, `SINT`, `TIME`, `TOD`, `TIME_OF_DAY`, `UDINT`, `UINT`, `ULINT`, `USINT`, `WORD` |
| Standard | Elementary + `STRING`, `WSTRING` |
| Integer | `__UXINT`, `__XINT`, `__XWORD`, `BIT`, `BYTE`, `DINT`, `DWORD`, `INT`, `LINT`, `LWORD`, `SINT`, `UDINT`, `UINT`, `ULINT`, `USINT`, `WORD` |
| Time | `TIME`, `LTIME` |
| Date+Time | `DATE`, `DATE_AND_TIME`, `DT`, `TIME_OF_DAY`, `TOD`, `LDATE`, `LDATE_AND_TIME`, `LDT`, `LTIME_OF_DAY`, `LTOD` |
| User-defined (DUT) | `STRUCT`, `ENUM`, `ALIAS`, `UNION`, subrange |

## `BOOL`

| | |
|---|---|
| Values | `TRUE` (1), `FALSE` (0) |
| Memory | **8 bits** (1 byte) |

`BIT` is the alternative for memory-tight packing — see below.

URL: `_cds_datatype_bool.html`

## Integer types

| Type | Min | Max | Memory |
|---|---|---|---|
| `BYTE` | 0 | 255 | 8 bits |
| `WORD` | 0 | 65535 | 16 bits |
| `DWORD` | 0 | 4,294,967,295 | 32 bits |
| `LWORD` | 0 | 2⁶⁴-1 | 64 bits |
| `SINT` | -128 | 127 | 8 bits |
| `USINT` | 0 | 255 | 8 bits |
| `INT` | -32,768 | 32,767 | 16 bits |
| `UINT` | 0 | 65,535 | 16 bits |
| `DINT` | -2,147,483,648 | 2,147,483,647 | 32 bits |
| `UDINT` | 0 | 4,294,967,295 | 32 bits |
| `LINT` | -2⁶³ | 2⁶³-1 | 64 bits |
| `ULINT` | 0 | 2⁶⁴-1 | 64 bits |

**⚠ "Information can be lost when converting from larger to smaller types."** Explicit `_TO_` conversion required.

URL: `_cds_datatype_integer.html`

## `REAL`, `LREAL`

IEEE 754 floating-point.

| Type | Smallest positive | Largest | Memory |
|---|---|---|---|
| `REAL` | 1.0E-44 | 3.402823E+38 | 32 bits |
| `LREAL` | 4.94065645841247E-324 | 1.7976931348623157E+308 | 64 bits |

**Target-system caveats:**
- LREAL **support depends on the target device**. The target docs say whether `LREAL` is converted to `REAL` (lossy) or stays 64-bit during compile.
- REAL/LREAL → integer conversion is **undefined behavior** if the value is out of the integer's range. May trap. Application must catch.
- REAL/LREAL math results depend on target FPU presence and behavior — bit-exact comparisons can disagree between controllers.

URL: `_cds_datatype_real.html`

## `STRING`

Variable-length character buffer.

**Memory:** Latin-1 = 1 byte/char + 1 null byte. UTF-8 = up to 4 bytes/char + 1 null byte; the declared length is the **byte capacity**, not the character count.

```st
sVar : STRING(46) := 'This is a string with memory for 46 characters.';
sVar : STRING[10] := 'µ (Mü)';   (* [] form also accepted *)
```

**Default size = 80 characters** when `STRING(<n>)` is omitted.

**Rules:**
- Initial value too long → silently truncated from the right.
- Library functions: Standard library handles up to 255-char strings. For longer strings use the StringUtils library.
- Reset behavior: contents past the terminating null of the **initial value** are NOT overwritten on reset. Apply `{attribute 'no_init'}` or accept the residue.
- Latin-1 vs UTF-8 mode is project-wide (`UTF-8 Encoding for STRING` compile option). See [05-operands.md](./05-operands.md) for `UTF8#'...'` per-literal override.

URL: `_cds_datatype_string.html`

## `WSTRING`

UCS-2 encoded (fixed-width 2 bytes per character).

**Code point range:** `U+0000`–`U+D7FF` and `U+E000`–`U+FFFF`.

```st
wsVar : WSTRING(10) := "Hello WSTRING";    (* double quotes *)
```

Same `n`-char-truncation and reset-residue behavior as STRING.

URL: `_cds_datatype_wstring.html`

## `TIME`, `LTIME`

| Type | Range | Memory | Resolution |
|---|---|---|---|
| `TIME` | `T#0MS` to `T#49D17H2M47S295MS` | 32 bits (DWORD-backed) | milliseconds |
| `LTIME` | `LTIME#0NS` to `LTIME#213503D23H34M33S709MS551US615NS` | 64 bits (LWORD-backed) | nanoseconds |

`LTIME` is the basis for high-resolution timers.

Literal syntax in [05-operands.md](./05-operands.md).

URL: `_cds_datatype_time.html`

## Date/time types

All date/time types are 32-bit DWORD-backed unless prefixed `L*` (64-bit LWORD-backed). The L variants gain nanosecond resolution.

| Type | Aliases | Range | Memory | Resolution |
|---|---|---|---|---|
| `DATE` | (none) | `D#1970-01-01` to `D#2106-02-07` | 32 bits | seconds (display: day only) |
| `DATE_AND_TIME` | `DT` | `DT#1970-01-01-00:00:00` to `DT#2106-02-07-06:28:15` | 32 bits | seconds |
| `TIME_OF_DAY` | `TOD` | `TOD#0:0:0` to `TOD#23:59:59.999` | 32 bits | milliseconds |
| `LDATE` | (none) | `LDATE#1677-09-22` to `LDATE#2262-04-11` | 64 bits | nanoseconds (display: day) |
| `LDATE_AND_TIME` | `LDT` | `LDT#1677-09-21-00:12:43.145224192` to `LDT#2262-04-11-23:47:16.854775807` | 64 bits | nanoseconds |
| `LTIME_OF_DAY` | `LTOD` | `LTOD#0:0:0` to `LTOD#23:59:59.999999999` | 64 bits | nanoseconds |

**Critical quirk:** Bare `D` is **not** the type — only the literal prefix. `D : INT;` is invalid because `D` isn't a type keyword. But `dateVal : DATE := D#2020-2-7;` is fine (`D#` is a literal prefix to `DATE`).

Same for `LD`, `DT`, `LDT`, `TOD`, `LTOD`. The full names (`DATE_AND_TIME`, `TIME_OF_DAY`, etc.) are the canonical types; the abbreviations are aliases.

URL: `_cds_datatype_date_and_time_of_day.html`

## `ANY` and `ANY_<type>`

Generic types for function/method inputs that accept arbitrary types.

```st
FUNCTION funGenericCompare : BOOL
VAR_INPUT
  any1 : ANY;
  any2 : ANY;
END_VAR

(* the ANY input is accessed as a struct: *)
(* TYPE __SYSTEM.AnyType : STRUCT          *)
(*   typeclass : __SYSTEM.TYPE_CLASS;      *)
(*   pvalue    : POINTER TO BYTE;          *)
(*   diSize    : DINT;                     *)
(* END_STRUCT END_TYPE                     *)

IF any1.typeclass <> any2.typeclass THEN RETURN; END_IF
IF any1.diSize <> any2.diSize THEN RETURN; END_IF
(* compare any1.pvalue[i] byte-by-byte *)
```

**Variants:** `ANY_NUM`, `ANY_REAL`, `ANY_INT`, `ANY_BIT`, `ANY_STRING`, `ANY_DATE`, `ANY_DERIVED`, `ANY_ELEMENTARY`. Each constrains the accepted family.

URL: `_cds_datatype_any.html`

## `BIT`

CODESYS-specific extension — **not in IEC 61131-3**.

| | |
|---|---|
| Values | `TRUE` (1), `FALSE` (0) |
| Memory | **1 bit** |
| Allowed location | **STRUCT members or FB local variables only** |

**Use case:** Memory-tight packing of flags inside a STRUCT. Successively-declared BIT variables pack into bytes.

**Trade-off:** Bit access is significantly slower than BOOL/BYTE access. Use only when memory pressure demands it or when matching an external bit-packed format.

**Restrictions:**
- Cannot point to a `BIT`: `POINTER TO BIT`, `REFERENCE TO BIT` are invalid (compile error).
- Cannot have an array of BIT: `ARRAY[...] OF BIT` is invalid.

URL: `_cds_datatype_bit.html`

## `__UXINT`, `__XINT`, `__XWORD` — platform-portable integers

CODESYS extension. Compile-time-converted to the right elementary integer for the target.

| Pseudo type | 32-bit platform | 64-bit platform |
|---|---|---|
| `__UXINT` | `UDINT` | `ULINT` |
| `__XINT` | `DINT` | `LINT` |
| `__XWORD` | `DWORD` | `LWORD` |

**Use case:** IEC code that must work on both 32-bit and 64-bit controllers (especially when interacting with pointers — `__UXINT` is the right "pointer-sized integer" type).

URL: `_cds_datatype_uxint_xword.html`

## `POINTER TO <type>`

Stores a memory address.

```st
piNumber : POINTER TO INT;
iNumber1 : INT := 5;
iNumber2 : INT;

piNumber := ADR(iNumber1);   (* take address *)
iNumber2 := piNumber^;       (* dereference *)
```

**Index access on pointers:** `piData[i]` ≡ `(piData + i * SIZEOF(<base>))^` — arithmetic + dereference.

**Restrictions:**
- `POINTER TO BIT` — invalid.
- Pointer to an I/O input is a write-target error: `pwInput := ADR(wInput)` triggers compiler warning `'... is not a valid assignment target'`. Copy the input to a writable variable first.

**Online-change risk:** Pointers can become stale after online change moves the target variable. See `{attribute 'no_copy'}` and `init_on_onlchange` pragmas in [07-pragmas.md](./07-pragmas.md).

URL: `_cds_datatype_pointer.html`

## `REFERENCE TO <type>`

Like a pointer but **auto-dereferenced** on use. Assignment with `:=` writes through; assignment with `REF=` rebinds the reference.

```st
rspeA : REFERENCE TO DUT_SPECIAL;
pspeA : POINTER TO DUT_SPECIAL;
speB : DUT_SPECIAL;
speD : DUT_SPECIAL;

rspeA REF= speB;     (* rebind: rspeA is now alias for speB *)
                     (*   equivalent to: pspeA := ADR(speB)  *)
rspeA := speD;       (* write through: speB now has speD's value *)
                     (*   equivalent to: pspeA^ := speD       *)
```

**Restrictions (compile errors):**
- `ARRAY[...] OF REFERENCE TO X` — invalid.
- `POINTER TO REFERENCE TO X` — invalid.
- `REFERENCE TO REFERENCE TO X` — invalid.
- `REFERENCE TO BIT` — invalid.

**Initialization:** Compiler ≥ V3.3.0.0 initializes references to 0.

**Validity check:** Use `__ISVALIDREF(refVar)` before dereferencing if the reference might not be bound.

**Readability note (from CODESYS):** Aliasing the same memory via two names (variable + reference) reduces readability. Use sparingly.

URL: `_cds_datatype_reference.html`

## `ARRAY[<dims>] OF <type>`

Fixed-length or variable-length collection of same-typed elements.

```st
(* One-dimensional, fixed length *)
aiCounter : ARRAY[0..9] OF INT;
aiCounter := [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];

(* Multi-dimensional *)
aiCardGame : ARRAY[1..2, 3..4] OF INT;
aiCardGame := [2(10), 2(20)];   (* shorthand: 2(10) means "10 twice" *)
aiCardGame[1, 3];                (* access *)
```

**Index limits:**
- Integer type (`SINT`/`USINT`/.../`DINT`/`UDINT`).
- Lower and upper inclusive.
- Maximum size limited by `DINT` range.

**Element type:** Any elementary, user-defined, or FB type — **except `BIT`** (cannot have `ARRAY OF BIT`; cannot have `ARRAY OF REFERENCE TO X`).

**Variable-length array** (function inputs): `ARRAY[*] OF <type>` — the function reads the actual size at runtime.

URL: `_cds_datatype_array.html`

## DUT: `TYPE ... END_TYPE`

User-defined types live in DUT (Data Unit Type) objects.

### `STRUCT`

```st
TYPE S_POLYGONLINE :
STRUCT
  aiStart  : ARRAY[1..2] OF INT := [-99, -99];
  aiPoint1 : ARRAY[1..2] OF INT;
  aiPoint2 : ARRAY[1..2] OF INT;
  aiEnd    : ARRAY[1..2] OF INT := [99, 99];
END_STRUCT
END_TYPE
```

**Rules:**
- Minimum 2 members.
- Can nest STRUCTs. Nested STRUCT member cannot have an `AT <address>` clause.
- Supports `EXTENDS`:

```st
TYPE S_PENTAGON EXTENDS S_POLYGONLINE :
STRUCT
  aiPoint5 : ARRAY[1..2] OF INT;
END_STRUCT
END_TYPE
```

The extended STRUCT contains both base and own members.

**Initialization with named-arg syntax:**
```st
sPolygon : S_POLYGONLINE := (aiStart := [1,1], aiPoint1 := [5,2], ...);
```

URL: `_cds_datatype_structure.html`

### `ENUM`

```st
{attribute 'qualified_only'}
{attribute 'strict'}
TYPE COLOR_BASIC :
(
  yellow,
  green,
  blue := 10
) INT := green;
END_TYPE
```

**Rules:**
- Minimum 2 members.
- Auto-incremented from 0 by default; explicit initial values allowed.
- **Base data type** optional after the closing paren: `INT | UINT | SINT | USINT | DINT | UDINT | LINT | ULINT | BYTE | WORD | DWORD | LWORD`. Default `INT`.
- **Default-value initialization** with `:=` after the base type sets the enum's default initial value.
- `{attribute 'strict'}` is **recommended** — enforces type-safe assignment (only enum members allowed, not raw integers).
- `{attribute 'qualified_only'}` is recommended — forces `COLOR_BASIC.green` syntax.
- See [07-pragmas.md](./07-pragmas.md): `to_string` for getting member name as string.
- Enum can have **text list support** for visualization labels — see sub-page `_cds_declare_enum_with_text_support.html`.

URL: `_cds_datatype_enum.html`

### Implicit Enumeration

Anonymous enum declared inline in a variable declaration. **Local to the POU only.**

```st
PROGRAM PLC_PRG
VAR
  iAlphabet : (Alfa, Bravo, Charlie, Delta, Echo) := Echo;
END_VAR

CASE iAlphabet OF
  Alfa: ...
  Echo: ...
END_CASE
```

**Internal type name:** CODESYS generates `IMPLICIT_ENUM_<POU>_<VarName>`. **Do not rely on this name** — it may change.

URL: `_cds_datatype_implicit_enumeration.html` (and `-1118500.html` for the duplicate listing)

### `ALIAS`

```st
TYPE FRAME : ARRAY[0..1499] OF BYTE; END_TYPE
TYPE SYMBOL : STRING(512); END_TYPE
TYPE INDEX : DINT := -1; END_TYPE          (* alias with custom default *)
TYPE RUNE : DINT(0..GVL.c_diMaxRune); END_TYPE   (* alias + subrange *)
```

**Allowed alias targets:** base data type, data type with size, function block.

**Niche use:** Importing a type from another namespace:
```st
TYPE ENCODING: SBB.ENCODING; END_TYPE       (* ENUM *)
TYPE INFO    : STR.INFO;     END_TYPE       (* STRUCT *)
TYPE IBuilder: SBB.IBuilder; END_TYPE       (* INTERFACE *)
TYPE Range   : SBB.Range;    END_TYPE       (* FB *)
```

This pattern lets a library re-export sub-library types without a wrapper container.

URL: `_cds_datatype_alias.html`

### `UNION`

All members share memory; the largest member's size = the UNION's size. Reading one member reads the bytes others wrote.

```st
TYPE U_VAR_12 :
UNION
  wVar1  : WORD;
  byVar2 : BYTE;
END_UNION
END_TYPE
```

**Rules:**
- Minimum 2 members.
- All members at offset 0.
- Initialization: `( <member name> := <literal> )` — picks one member to seed.

```st
uefficient_1 : U_EFFICIENT := (strMember := 'A');
uefficient_1.wMember := 16#000A;    (* overwrites — affects strMember too *)
```

URL: `_cds_datatype_union.html`

### Subrange type

A variable typed to an integer base + an inclusive value range. Out-of-range assignment is a compile error if the compiler can prove it.

```st
VAR
  i  : INT (-4095..4095);
  ui : UINT (0..10000);
END_VAR

i := 5000;   (* compile error — out of range *)
```

**Allowed base types:** `SINT`, `USINT`, `INT`, `UINT`, `DINT`, `UDINT`, `BYTE`, `WORD`, `DWORD`, `LINT`, `ULINT`, `LWORD`.

**Runtime range checking:** Enabled via `CheckRangeSigned` / `CheckRangeUnsigned` implicit monitoring functions. Compile-time checks are best-effort.

URL: `_cds_datatype_subint.html`

## `__VECTOR[<size>] OF <type>` (CODESYS extension)

SIMD vector type. Native on x86/64+SSE2 and ARM64+NEON; emulated elsewhere.

```st
vcA : __VECTOR[3] OF REAL;
vcA[0] := 1.1; vcA[1] := 2.2; vcA[2] := 3.3;
```

**Constraints:**
- `<size>` ∈ {1..8}
- `<element type>` ∈ {`REAL`, `LREAL`}

Vector operators are `__vc<operator>` prefixed (CODESYS-specific). Optimal vector size depends on target.

URL: `_cds_data_type_vector.html`

## `VERSION`

Struct holding semver-style project/library version info. Auto-generated when "Automatically generate 'Project Information' POUs" / "...Library Information POUs" project option is on.

```st
TYPE VERSION :
STRUCT
  uiMajor       : UINT;   (* major *)
  uiMinor       : UINT;   (* minor *)
  uiServicePack : UINT;   (* service pack *)
  uiPatch       : UINT;   (* patch *)
END_STRUCT
END_TYPE
```

A `GetVersion` function with `VERSION` return type is auto-generated.

URL: `_cds_datatype_version.html`

## Sub-page catalog

Total: 21 pages.

| Sub-page | URL fragment |
|---|---|
| BOOL | `_cds_datatype_bool.html` |
| Integer | `_cds_datatype_integer.html` |
| REAL, LREAL | `_cds_datatype_real.html` |
| STRING | `_cds_datatype_string.html` |
| TIME, LTIME | `_cds_datatype_time.html` |
| DATE family | `_cds_datatype_date_and_time_of_day.html` |
| ANY, ANY_&lt;type&gt; | `_cds_datatype_any.html` |
| WSTRING | `_cds_datatype_wstring.html` |
| BIT | `_cds_datatype_bit.html` |
| __UXINT, __XINT, __XWORD | `_cds_datatype_uxint_xword.html` |
| POINTER TO | `_cds_datatype_pointer.html` |
| REFERENCE TO | `_cds_datatype_reference.html` |
| ARRAY OF | `_cds_datatype_array.html` |
| DUT: TYPE (overview) | `_cds_datatype_type.html` |
| STRUCT | `_cds_datatype_structure.html` |
| Enum | `_cds_datatype_enum.html` |
| Enum with Text List Support | `_cds_declare_enum_with_text_support.html` |
| Implicit Enumeration | `_cds_datatype_implicit_enumeration-1118500.html` |
| Alias | `_cds_datatype_alias.html` |
| UNION | `_cds_datatype_union.html` |
| Subranges | `_cds_datatype_subint.html` |
| __VECTOR | `_cds_data_type_vector.html` |
| VERSION | `_cds_datatype_version.html` |

## Notes for tooling

**Already in parser (`src/parser/ast.ts`):**
- Type expressions: `NamedType`, `QualifiedNamedType`, `ArrayType`, `ReferenceType`, `PointerType`, `StringType` (with `(n)` size), `WStringType`
- DUT objects: `TYPE_DECL` with `StructBody | EnumBody | UnionBody | AliasBody`
- See section A in Explore findings.

**Diagnostic candidates (Stage 5):**
- `POINTER TO BIT`, `REFERENCE TO BIT`, `ARRAY OF BIT`, `ARRAY OF REFERENCE TO ...`, `REFERENCE TO REFERENCE TO ...`, `POINTER TO REFERENCE TO ...` → all errors
- `BIT` outside a STRUCT/FB → error
- Subrange literal that's provably out of range at compile time → error
- ENUM with fewer than 2 members → error
- ENUM without `{attribute 'strict'}` → information (recommend)
- STRUCT/UNION with fewer than 2 members → error
- STRUCT nested member with `AT <address>` clause → error
- `__VECTOR` size outside 1..8 or element type not REAL/LREAL → error

**Hover augmentation:**
- Every elementary type hover shows: range, memory size, IEC vs CODESYS-extension
- Hovering on a string-with-size shows byte capacity vs char capacity in current encoding mode
- Hovering on `LREAL` warns about target-dependent 64-bit support

**Stage 5 deep-dives this into `src/reference/data-types.ts` as a structured table:**

```ts
interface DataType {
  name: string;
  family: 'bool' | 'integer' | 'real' | 'string' | 'time' | 'date' | 'pointer' | 'reference' | 'array' | 'struct' | 'enum' | 'union' | 'alias' | 'vector' | 'system';
  iec: boolean;            // is it part of IEC 61131-3 or a CODESYS extension?
  bits: number | 'platform' | 'variable';   // for __XINT etc.
  range?: { min: string; max: string };
  url: string;
}
```
