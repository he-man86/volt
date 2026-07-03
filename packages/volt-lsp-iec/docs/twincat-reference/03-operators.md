# 03 — Operators (TwinCAT Deltas)

> **Source:** https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2527291915.html
> **Retrieved:** 2026-06-07
> **TwinCAT version:** 3 (current GA)

## Summary

TwinCAT inherits most CODESYS operators (see [`../codesys-reference/03-operators.md`](../codesys-reference/03-operators.md)). This page documents **only the deltas** — operators TwinCAT adds, removes, or defines differently from CODESYS.

---

## Dynamic memory: `__NEW` and `__DELETE`

TwinCAT 3 exposes controlled heap allocation via two built-in operators. These are the **only** safe way to allocate memory at runtime in TwinCAT PLC code; `SysMem` library calls exist but are not the recommended path.

### `__NEW`

```
__NEW(TypeName [, count])
```

- Returns `POINTER TO TypeName` (or `POINTER TO ARRAY [0..count-1] OF TypeName`).
- Returns `0` (null pointer) if allocation fails — always check before dereferencing.
- `count` is optional; omit for a single instance. When present, allocates an array of `count` elements.
- The allocated block is zero-initialized.

```iecst
VAR
    pMotor : POINTER TO FB_Motor;
END_VAR

pMotor := __NEW(FB_Motor);
IF pMotor <> 0 THEN
    pMotor^.Init();
END_IF
```

### `__DELETE`

```
__DELETE(pointer)
```

- Frees the block allocated by `__NEW`. Sets the pointer to `0` after freeing.
- Calling on a null pointer is safe (no-op).
- Double-free is **undefined behaviour** — guard with a null check if lifetime is unclear.

```iecst
IF pMotor <> 0 THEN
    __DELETE(pMotor);  // pMotor is 0 after this
END_IF
```

**CODESYS note:** CODESYS exposes identical `__NEW`/`__DELETE` semantics. Code using them is portable, but CODESYS projects typically use `F_ObjCreate`/`F_ObjDelete` from the standard library instead.

---

## Reference validity: `__ISVALIDREF`

```
__ISVALIDREF(ref)
```

- Evaluates to `TRUE` if `ref` (a `REFERENCE TO` variable) currently points to a valid object.
- Evaluates to `FALSE` if the reference is unbound (default-constructed and never assigned).
- Available in both TwinCAT and modern CODESYS — behaviour is identical.

```iecst
VAR
    refAxis : REFERENCE TO AXIS_REF;
END_VAR

IF __ISVALIDREF(refAxis) THEN
    refAxis.fSetVeloDeceleration := 1000.0;
END_IF
```

---

## Variable introspection: `__VARINFO`

```
__VARINFO(varname [, attribute-flags])
```

Returns a value of type `__SYSTEM.VAR_INFO` containing compile-time metadata about `varname`:

| Field | Type | Content |
|---|---|---|
| `Symbol` | `T_MaxString` | Symbol name (unqualified) |
| `TypeName` | `T_MaxString` | IEC type name (e.g. `"LREAL"`) |
| `TypeClass` | `__SYSTEM.TYPE_CLASS` | Enum: `PRIMITIVE`, `ENUM`, `STRUCT`, `FB`, `ARRAY`, … |
| `BitSize` | `UDINT` | Size in bits |
| `BitOffset` | `UDINT` | Bit offset within containing type (struct context) |
| `ArrayDimension` | `UDINT` | Array dimensions (0 for non-array) |
| `LowerBound` | `UDINT` | Lower array bound (first dimension) |

**CODESYS note:** CODESYS has a `__VARINFO` operator but the returned struct fields differ. Code using `__VARINFO` is NOT portable.

---

## OOP operators (TwinCAT-only)

These three operators support COM/interface-based polymorphism in TwinCAT's object model. They have no CODESYS equivalent.

### `__QUERY_INTERFACE`

```
__QUERY_INTERFACE(instance, interface_variable)
```

- Returns `TRUE` and writes a reference to `interface_variable` if `instance` implements the queried interface.
- Returns `FALSE` and leaves `interface_variable` unset otherwise.
- `interface_variable` must be a `REFERENCE TO I_Something`.

```iecst
VAR
    fbDevice : FB_Drive;
    refDiag  : REFERENCE TO I_Diagnostics;
END_VAR

IF __QUERY_INTERFACE(fbDevice, refDiag) THEN
    refDiag.LogStatus();
END_IF
```

### `__QUERY_POINTER`

```
__QUERY_POINTER(instance, pointer_variable)
```

Same semantics as `__QUERY_INTERFACE` but writes a `POINTER TO I_Something` rather than a reference.

### `__TRY_CAST`

```
__TRY_CAST(source_pointer, target_pointer)
```

- Returns `TRUE` if `source_pointer` points to an object that is a subtype of `target_pointer`'s pointed-to type.
- On success writes the same address into `target_pointer`.
- On failure `target_pointer` is set to `0` (null).

---

## Operators NOT in TwinCAT (CODESYS-only)

| CODESYS operator | Notes |
|---|---|
| `__POOL` | CODESYS-specific runtime memory pool; no TC equivalent |
| `__MONITORED_VAR` | CODESYS runtime instrumentation; no TC equivalent |

When porting code from CODESYS to TwinCAT: search for `__POOL` usage first — it typically requires a redesign using `__NEW`/`__DELETE` with an explicit free list.

---

## Standard operators — same in both

The following operators from CODESYS are available unchanged in TwinCAT:

`ADR`, `ADRINST`, `BITADR`, `SIZEOF`, `XSIZEOF`, `SEL`, `MUX`, `LIMIT`, `MOVE`, `CONCAT`, `DELETE` (string), `INSERT`, `REPLACE`, `FIND`, `LEFT`, `RIGHT`, `MID`, `LEN`, `UPPER_BOUND`, `LOWER_BOUND`.
