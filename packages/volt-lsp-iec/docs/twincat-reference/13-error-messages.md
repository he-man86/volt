# 13 — Error Messages and Warnings (TwinCAT)

> **Source:** https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2527368715.html
> **Retrieved:** 2026-06-07
> **TwinCAT version:** 3 (current GA)

## Summary

TwinCAT compiler errors use a different numbering scheme from CODESYS. This page catalogs the most frequently encountered TwinCAT errors and their resolution.

For CODESYS error messages see [`../codesys-reference/13-error-messages.md`](../codesys-reference/13-error-messages.md).

---

## Error code format

TwinCAT compiler errors appear in the Error List panel as:

```
C<NNNN>: <message>   (compiler errors)
L<NNNN>: <message>   (linker errors)
W<NNNN>: <message>   (warnings)
```

ADS and runtime errors use hexadecimal codes (e.g. `0x745 = 1861` — ADS port not connected).

---

## Frequent compiler errors

| Code | Message | Common cause / fix |
|---|---|---|
| `C0001` | Unexpected token | Syntax error; look one line above the highlighted token |
| `C0002` | Identifier expected | Missing variable or type name in declaration |
| `C0032` | Type mismatch | Assigning incompatible types without explicit conversion; add `INT_TO_DINT()` etc. |
| `C0035` | Implicit conversion loses precision | Narrowing conversion (DINT → INT); use explicit conversion function or widen the target |
| `C0080` | Cannot open include file | Library reference missing from the project; add via Library Manager |
| `C0100` | Undefined identifier | Variable or type not declared in scope; check spelling, scope, and GVL availability |
| `C0101` | Identifier already defined | Duplicate declaration; check for same name in VAR block and GVL |
| `C0105` | Method not found | FB does not implement the called method; check IMPLEMENTS, spelling |
| `C0110` | Interface not implemented | FB declares IMPLEMENTS but is missing one or more interface methods |
| `C0115` | Cannot override — base method is FINAL | Remove `OVERRIDE` or change base FB |
| `C0120` | Recursive call detected | ST function or method calls itself (directly or indirectly); TwinCAT does not support recursion in PLC code |
| `C0200` | Array index out of bounds | Compile-time-detectable index exceeds declared bounds |
| `C0201` | Division by zero | Constant divisor is zero |
| `C0300` | Pragma syntax error | Malformed `{attribute ...}` pragma; check quotes and spacing |
| `C0301` | Unknown pragma | Pragma name not recognised; check spelling, see [07-pragmas.md](./07-pragmas.md) |
| `C0400` | Abstract method must not have implementation | Remove the method body or remove `ABSTRACT` |
| `C0401` | FB is abstract and cannot be instantiated | Extend the FB or remove `abstract` attribute |

---

## Frequent linker errors

| Code | Message | Common cause / fix |
|---|---|---|
| `L0010` | Unresolved external reference | A method or function is declared but not defined; check all library references are present |
| `L0020` | Symbol not found in library | Library version mismatch or library not added to project |
| `L0030` | Duplicate symbol | Two libraries export the same name; qualify calls with the namespace |

---

## Frequent warnings

| Code | Message | Notes |
|---|---|---|
| `W0001` | Variable is never used | Declare `VAR_STAT` or remove; safe to ignore in generated code |
| `W0010` | Method hides base class method | Add `OVERRIDE` if intentional; rename if accidental |
| `W0020` | Implicit conversion from REAL to LREAL | Usually harmless; consider using `LREAL` throughout |
| `W0030` | `RETAIN` variable initialised with a non-constant | Initialiser runs only on first download; value is retained across warm restart after that |

---

## ADS error codes (runtime)

ADS errors surface at runtime and in the TwinCAT router log. Common ones:

| Hex | Decimal | Meaning |
|---|---|---|
| `0x1` | 1 | Internal error |
| `0x6` | 6 | Port not connected — bridge is not attached to a running PLC task |
| `0x7` | 7 | Unknown command ID |
| `0x745` | 1861 | ADS port not open / device not connected |
| `0x750` | 1872 | ADS state machine error — PLC is in wrong state (e.g. STOP) |
| `0x1001` | 4097 | Symbol not found — variable name changed or PLC download pending |
| `0x1002` | 4098 | Symbol version invalid — PLC was downloaded since the ADS handle was opened; reconnect |

The Volt bridge returns ADS errors in its HTTP response body when the bridge cannot reach the PLC. The error code appears in the bridge's health response `degradedReason` field.

---

## "Cannot resolve symbolic link" (I/O mapping error)

This is an XAE-level error (not a PLC compiler error): a variable linked in the I/O mapping no longer exists in the PLC project (renamed or deleted). Resolve by re-linking in the I/O mapping tab or removing the stale link.
