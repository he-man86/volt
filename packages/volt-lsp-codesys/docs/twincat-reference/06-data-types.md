# 06 — Data Types (TwinCAT Deltas)

> **Source:** https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2527307403.html
> **Retrieved:** 2026-06-07
> **TwinCAT version:** 3 (current GA)

## Summary

TwinCAT supports all IEC 61131-3 data types. This page covers **TwinCAT-specific additions, limits, and differences** including global data types and struct alignment.

For the base reference see [`../codesys-reference/06-data-types.md`](../codesys-reference/06-data-types.md).

---

## TwinCAT-specific types

| Type | Description |
|---|---|
| `OTCID` | TwinCAT Object ID — a 32-bit handle used by the ADS router to identify COM objects. Used in TwinCAT Module communication. |
| `HEXINT` | Not a separate type; a display hint. Append `16#` prefix to integer literals to use hex notation. No runtime difference from `DINT`/`UDINT`. |
| `PVOID` | Pointer to an untyped memory block. Equivalent to `POINTER TO BYTE`; used in `SysMem` and low-level library APIs. |
| `__SYSTEM.TYPE_CLASS` | Enum returned by `__VARINFO`; describes the kind of a type at compile time. |
| `__SYSTEM.VAR_INFO` | Struct returned by `__VARINFO`; see [03-operators.md](./03-operators.md). |

---

## Global data types (DUT files)

TwinCAT stores global user-defined types (structs, enums, unions, aliases) in `.TcDUT` files. The type is available project-wide without an explicit namespace qualifier once the DUT file is part of the PLC project.

CODESYS stores DUTs in `.dut` files with otherwise identical semantics.

**Multiple types per file:** TwinCAT allows only one top-level type per `.TcDUT` file. Attempting to define two structs in the same file produces a compile error. CODESYS also enforces one type per object — same rule.

---

## String limits

| Property | TwinCAT | CODESYS |
|---|---|---|
| Default `STRING` length | 80 characters | 80 characters |
| Maximum `STRING` length | 255 characters | 255 characters |
| `WSTRING` character width | 2 bytes (UTF-16 LE) | 2 bytes (UTF-16 LE) |
| Maximum `WSTRING` length | 255 characters | 255 characters |

Declare a custom length with `STRING(N)` where N ≤ 255.

---

## Alignment (`pack_mode`)

TwinCAT controls struct layout via `{attribute 'pack_mode' := 'N'}`:

| `pack_mode` | Alignment | Notes |
|---|---|---|
| `0` | Natural alignment (default) | Each member aligned to its own size. Padding may be inserted. |
| `1` | 8-bit packed | No padding; members at consecutive byte offsets. Matches `__attribute__((packed))` in C. |
| `4` | 32-bit aligned | All members aligned to 4-byte boundaries. |
| `8` | 64-bit aligned | All members aligned to 8-byte boundaries. |

```iecst
{attribute 'pack_mode' := '1'}
TYPE ST_Packed :
STRUCT
    bFlag  : BOOL;    // offset 0 (1 byte)
    nValue : DINT;    // offset 1 (no padding — packed)
END_STRUCT
END_TYPE
```

CODESYS uses the same `{attribute 'pack_mode'}` pragma with the same values. Code is portable between vendors.

**When to use `pack_mode 1`:** EtherCAT PDO definitions, Modbus register maps, and any struct that must match a hardware memory layout byte-for-byte. Without it, the compiler inserts alignment padding that breaks the byte map.

---

## Enumerations

TwinCAT supports:

- Named enum type: `TYPE E_State : (Idle, Running, Error) := Idle; END_TYPE`
- Enum with explicit values: `TYPE E_Axis : (Home := 0, Forward := 1, Reverse := -1); END_TYPE`
- `{attribute 'strict'}` — prohibits implicit conversion to/from integer (same as CODESYS)
- `{attribute 'qualified_only'}` — requires `E_State.Running` access form (same as CODESYS)

---

## Union

Unions (`UNION ... END_UNION`) work the same as CODESYS. All members share the same memory starting at offset 0. Total size = size of the largest member.

---

## Aliases

```iecst
TYPE T_Temperature : LREAL; END_TYPE
```

Same syntax and semantics as CODESYS. The alias does NOT create a distinct type for the type system — assignments between the alias and the base type are implicit.
