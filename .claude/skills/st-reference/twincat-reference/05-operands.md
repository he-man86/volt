# 05 — Operands (TwinCAT Deltas)

> **Source:** https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2527299211.html
> **Retrieved:** 2026-06-07
> **TwinCAT version:** 3 (current GA)

## Summary

Operand types in TwinCAT (literals, variables, addresses, constants, function calls) follow IEC 61131-3. This page covers **TwinCAT-specific additions and differences**.

For the base reference see [`../codesys-reference/05-operands.md`](../codesys-reference/05-operands.md).

---

## Direct address operands (`%I`, `%Q`, `%M`)

TwinCAT supports the IEC 61131-3 direct address syntax (`%IX0.0`, `%QW1`, `%MD4`) but **strongly discourages** its use in PLC code. TwinCAT's preferred approach:

1. Declare typed PLC variables without `AT`.
2. Link them to hardware I/O via the **TwinCAT System Manager / XAE I/O mapping** tab.

Direct address variables bypass the I/O mapping table and make the program invisible to TwinCAT Scope, ADS, and OPC UA by default. If you see `AT %I*` / `AT %Q*` in a TwinCAT project, it is typically legacy code.

CODESYS projects routinely use `AT %I*` / `AT %Q*` and expect the SoftPLC runtime to bind them. Neither style is "wrong" — they reflect different IDE architectures.

---

## `__SYSTEM.GetTimestamp()`

TwinCAT exposes the current task timestamp (microseconds since epoch) via the `__SYSTEM` namespace:

```iecst
VAR
    tNow : ULINT;
END_VAR
tNow := __SYSTEM.GetTimestamp();
```

CODESYS equivalent: `SysTimeGetUs()` from `SysTime` library or `GETSYSTEMTIME()`.

---

## Constants from `Tc2_System`

TwinCAT defines system-wide constants in the `Tc2_System` GVL rather than as language-level keywords. Examples:

| Constant | Value | Purpose |
|---|---|---|
| `MAX_STRING_LENGTH` | 255 | Maximum ST `STRING` character count |
| `PLCPRG_VERSION` | string | Runtime version string |
| `TASK_CYCLE_COUNT` | `UDINT` | Cycle counter for the current task |

Access via `Tc2_System.MAX_STRING_LENGTH` or with a `VAR_EXTERNAL` declaration.

---

## Numeric literal suffixes

TwinCAT supports the same IEC 61131-3 typed literals as CODESYS:

```
DINT#42       LREAL#3.14    TIME#500MS    DATE#2026-06-07
BOOL#TRUE     BYTE#16#FF    WORD#2#1010
```

No TwinCAT-specific suffix forms beyond the IEC standard.

---

## `THIS` pointer

Inside a method or property of a function block, `THIS` is the implicit pointer to the current FB instance (same as `this` in C++/C#). Available in both TwinCAT and CODESYS.

```iecst
METHOD GetSelf : POINTER TO FB_MyBlock
GetSelf := THIS;
```

---

## `SUPER` pointer

Inside an extended FB's method, `SUPER^.MethodName()` calls the parent class's implementation. Same in both TwinCAT and CODESYS.
