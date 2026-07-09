# 04 — Type Conversion (TwinCAT Deltas)

> **Source:** https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2527323787.html
> **Retrieved:** 2026-06-07
> **TwinCAT version:** 3 (current GA)

## Summary

Type conversion rules in TwinCAT are identical to CODESYS for all IEC 61131-3 types. This page covers the **TwinCAT-specific additions and behavioural differences**.

For the base reference see [`../codesys-reference/04-type-conversion.md`](../codesys-reference/04-type-conversion.md).

---

## Implicit conversions — same rules

TwinCAT follows the same implicit widening rules as CODESYS: narrowing conversions (e.g. `DINT` → `INT`) require an explicit conversion function; widening is automatic. No differences here.

---

## `STRING` ↔ `WSTRING`

TwinCAT's string model:

- `STRING` — 1-byte-per-character (Latin-1 / code page 1252 by default).
- `WSTRING` — 2-byte-per-character (UTF-16 LE).
- Explicit conversion: `STRING_TO_WSTRING()` / `WSTRING_TO_STRING()` (from `Tc2_System`).
- The pragma `{attribute 'TcEncoding' := 'UTF-8'}` on a `STRING` variable tells TwinCAT to interpret bytes as UTF-8 (display only — does NOT change storage width).

CODESYS uses the same `STRING`/`WSTRING` split but has no `TcEncoding` pragma.

---

## `LREAL` ↔ `REAL` precision

Same as CODESYS: `REAL` is 32-bit IEEE 754, `LREAL` is 64-bit. Implicit narrowing from `LREAL` to `REAL` is a warning (not error) in TwinCAT — same in CODESYS.

---

## `ANY` type in function signatures

TwinCAT supports the `ANY` pseudo-type in function parameter declarations, allowing a function to accept any IEC type. The compiler resolves the actual type at the call site. `ANY_NUM`, `ANY_BIT`, `ANY_INT`, `ANY_REAL` sub-categories are also supported.

CODESYS supports the same `ANY` family. Behaviour is identical.

---

## Enumeration conversions

TwinCAT supports implicit conversion of enumeration values to their underlying integer type for arithmetic. Explicit conversion back: `INT_TO_<EnumType>(value)`.

With `{attribute 'strict'}` on the enum declaration, implicit conversion is disabled and all arithmetic on enum values becomes a compile error — same as CODESYS strict enums.

---

## `POINTER TO` and type safety

TwinCAT allows casting any pointer to `POINTER TO BYTE` and back. The `^` dereference operator works on any typed pointer. Same rules as CODESYS.

`__TRY_CAST` (see [03-operators.md](./03-operators.md)) provides safe interface downcasting without raw pointer arithmetic.
