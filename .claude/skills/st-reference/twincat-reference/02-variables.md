# 02 — Variables (TwinCAT Deltas)

> **Source:** https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2527315595.html
> **Retrieved:** 2026-06-07
> **TwinCAT version:** 3 (current GA)

## Summary

Variable declaration syntax in TwinCAT is the same as CODESYS. This page covers only the **TwinCAT-specific extensions and differences**.

For the base variable reference see [`../codesys-reference/02-variables.md`](../codesys-reference/02-variables.md).

---

## `VAR_STAT` — static local variables

Both CODESYS and TwinCAT support `VAR_STAT`. In TwinCAT, static local variables inside a method or function retain their value across calls (same as `static` in C). TwinCAT documents this section more prominently because it's heavily used with TwinCAT-style OOP.

```iecst
METHOD CountCalls : DINT
VAR_STAT
    nCalls : DINT;
END_VAR

nCalls := nCalls + 1;
CountCalls := nCalls;
```

---

## `AT` address assignment and I/O linking

TwinCAT PLC variables are linked to hardware I/O via the **I/O mapping** in XAE, not via `AT %I*` / `AT %Q*` address literals at the variable level. Using `AT %I*` directly in a TwinCAT POU is technically supported but strongly discouraged — it bypasses the I/O configuration and breaks the symbolic link table.

**CODESYS approach:** `AT %IX0.0 : BOOL;` — direct bit address.  
**TwinCAT approach:** Declare `bSensor : BOOL;` with no `AT`, then link in the I/O mapping tab.

---

## `PERSISTENT` vs `RETAIN`

TwinCAT distinguishes the storage areas at the hardware level:

| Qualifier | TwinCAT meaning | CODESYS meaning |
|---|---|---|
| `RETAIN` | Survives warm restart (power cycle); stored in NVRAM retain area | Same |
| `PERSISTENT` | Survives cold restart + firmware update; stored in file-backed persistent area | Same conceptually; storage mechanism differs per vendor |

TwinCAT's persistent area writes a binary file (`.dat`) at every change. CODESYS persistent storage is runtime-dependent (some targets write on shutdown only).

The pragma alternatives `{attribute 'TcRetain'}` and `{attribute 'TcPersistent'}` apply these qualifiers without changing the variable's memory area — useful in libraries where the consumer controls storage.

---

## Symbol generation and ADS visibility

By default every declared variable becomes an ADS symbol (visible via OPC UA, ADS client, TwinCAT Scope). Suppress with:

```iecst
{attribute 'TcNoSymbol'}
bInternalState : BOOL;
```

CODESYS uses `{attribute 'hide'}` for a similar but not identical effect (hides from the tree view; ADS/OPC UA behaviour varies by runtime).

---

## External variables (`VAR_EXTERNAL`)

TwinCAT supports `VAR_EXTERNAL` to reference GVL variables from inside a POU without passing them as parameters. Same syntax as CODESYS; both vendors caution against overuse (tight coupling, harder to test).

---

## `__VARINFO` introspection

See [03-operators.md](./03-operators.md) for the TwinCAT-specific `__VARINFO` operator which returns compile-time metadata about any declared variable.
