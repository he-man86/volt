# 07 — Pragmas (TwinCAT Additions)

> **Source:** https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2529567115.html
> **Retrieved:** 2026-06-07
> **TwinCAT version:** 3 (current GA)

## Summary

TwinCAT inherits most CODESYS attribute pragmas (see [`../codesys-reference/07-pragmas.md`](../codesys-reference/07-pragmas.md)). This page lists **TwinCAT-specific additions** — pragmas with the `Tc*` prefix, plus a few inherited names TwinCAT documents distinctly that CODESYS does not.

When a user writes a TwinCAT pragma in a CODESYS project (or vice versa), the LSP raises a `wrong-vendor-pragma` warning and suggests the equivalent in the active vendor where one exists.

---

## TwinCAT-specific (`Tc*` prefix)

| Pragma | Purpose | Insert location |
|---|---|---|
| `TcCallAfterOutputUpdate` | Method runs after the task's output update phase, before next input read | Above method declaration |
| `TcContextId` | Numeric task-context selector for `VAR_GLOBAL`s shared across tasks | Above var or POU declaration |
| `TcContextName` | Named task-context selector (e.g. `'PlcTask'`) | Above `VAR_GLOBAL` / POU / variable declaration |
| `TcDisplayScale` | Display scaling for engineering units in monitoring | Above variable |
| `TcEncoding` | Character encoding for STRING variables (UTF-8, etc.) | Above variable |
| `TcGlobalDataType` | Mark a DUT as a globally-shared data type for OPC UA / ADS | Above DUT declaration |
| `TcHideSubItems` | Hide nested struct members from the Visual Studio object browser | Above struct |
| `TcIgnorePersistent` | Exclude this variable from persistent-data file generation | Above variable |
| `TcInitOnReset` | Re-initialize this variable on PLC reset (vs. retain) | Above variable |
| `TcInitSymbol` | Specify the symbol used to initialize this variable from configuration | Above variable |
| `TcLinkTo`, `TcLinkToOSO` | Auto-link a variable to a hardware input/output by symbolic path | Above variable in FB/GVL, or above instance declaration |
| `TcNcAxis` | Bind to an NC motion axis index | Above variable (typically `AXIS_REF`) |
| `TcNoSymbol`, `tc_no_symbol` | Exclude from symbol generation (ADS / OPC UA invisible) | Above variable or POU |
| `TcPersistent` | Mark as persistent without changing memory area (alternative to `PERSISTENT`) | Above variable |
| `TcRetain` | Mark as retain without changing memory area | Above variable |
| `TcRpcEnable` | Activate a method for ADS Remote Procedure Call (required for OPC UA method exposure) | Above method declaration |
| `TcSwapDWord` | Byte-swap 32-bit words on read/write (endianness conversion) | Above variable |
| `TcSwapWord` | Byte-swap 16-bit words on read/write | Above variable |
| `Tc2GvlVarNames` | Compatibility: keep TwinCAT 2-style global variable naming | Above `VAR_GLOBAL` |

---

## Equivalents to CODESYS pragmas

Where a TwinCAT pragma has a roughly-equivalent CODESYS counterpart, the LSP's `wrong-vendor-pragma` diagnostic suggests it:

| TwinCAT | CODESYS equivalent | Notes |
|---|---|---|
| `TcRetain` | `RETAIN` (modifier) or `{attribute 'no_init'}` partial | Closest match; semantics differ slightly |
| `TcPersistent` | `PERSISTENT` (modifier) | Closest match |
| `TcNoSymbol` | `{attribute 'hide'}` partial | `hide` affects UI; `TcNoSymbol` also excludes symbols |
| `TcCallAfterOutputUpdate` | `{attribute 'call_after_online_change_slot'}` partial | Different lifecycle hook; no exact equivalent |
| (no equivalent) | `{attribute 'qualified_only'}` | TwinCAT also has this (shared) |

---

## Inherited but TwinCAT-documented additions

Pragmas that originate in CODESYS but TwinCAT documents with extensions/differences:

| Pragma | TwinCAT extension |
|---|---|
| `c++_compatible` | Documented in TwinCAT for ADS/C++ interop. May exist in CODESYS but is more commonly cited in TwinCAT contexts. |
| `memory_check` | Documented in TwinCAT static-analysis context |
| `minimal_input_size` | TwinCAT-flagged |
| `no_explicit_call` | TwinCAT-flagged (Action / Method calling restrictions) |
| `noflow` / `flow` | TwinCAT static-analysis directives |
| `parameterstringof` | TwinCAT static-analysis |
| `strict` | TwinCAT enum-strictness directive (also in modern CODESYS) |

These are tagged as `"shared"` in the LSP catalog — both vendors accept them. If we discover TwinCAT-only nuances later, we'll re-tag.

---

## Notes for tooling

- Each TwinCAT pragma here gets a `vendor: "twincat"` entry in `src/reference/pragmas.ts`.
- `equivalentIn.codesys` is set for the pragmas in the equivalents table above.
- The `wrong-vendor-pragma` diagnostic uses these entries to produce the user-facing suggestion.
- TwinCAT-only inherited pragmas (`c++_compatible`, etc.) are tagged `vendor: "shared"` unless we learn otherwise.
