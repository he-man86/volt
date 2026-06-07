# 10 — Keywords (TwinCAT Deltas)

> **Source:** https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2527353867.html
> **Retrieved:** 2026-06-07
> **TwinCAT version:** 3 (current GA)

## Summary

TwinCAT reserves the same IEC 61131-3 keywords as CODESYS and adds a small set of OOP keywords. This page lists only the **TwinCAT-specific additions**.

For the full base keyword list see [`../codesys-reference/10-keywords.md`](../codesys-reference/10-keywords.md).

---

## OOP keywords (TwinCAT 3 additions)

These keywords were introduced in TwinCAT 3 alongside the object-oriented language extensions. They are also present in modern CODESYS (V3.5 SP4+), so code using them is largely portable.

| Keyword | Purpose |
|---|---|
| `INTERFACE` | Declares an interface type (a set of method signatures without implementation) |
| `IMPLEMENTS` | Specifies that an FB implements one or more interfaces: `FB_Motor IMPLEMENTS I_Device, I_Diagnostics` |
| `EXTENDS` | Single-inheritance: `FB_PneumaticDrive EXTENDS FB_Drive` |
| `ABSTRACT` | Marks an FB or method as abstract (no direct instantiation / must be overridden) |
| `FINAL` | Marks an FB or method as non-inheritable / non-overridable |
| `OVERRIDE` | Explicit override marker on a method that replaces a base-class method |
| `METHOD` | Declares a method on a function block (keyword in the POU header) |
| `PROPERTY` | Declares a property (getter/setter pair) on an FB |

---

## `INTERFACE` keyword

```iecst
INTERFACE I_Sensor
    METHOD GetValue : LREAL
    END_METHOD
    METHOD Reset
    END_METHOD
END_INTERFACE
```

An interface declares method signatures without bodies. An FB implementing the interface must provide all declared methods.

---

## `EXTENDS` and `IMPLEMENTS` together

```iecst
FUNCTION_BLOCK FB_TempSensor
    EXTENDS FB_SensorBase
    IMPLEMENTS I_Sensor, I_Diagnostics
VAR
    ...
END_VAR
```

- At most **one** base FB (`EXTENDS`). TwinCAT does not support multiple inheritance of implementation.
- Any number of interfaces (`IMPLEMENTS`, comma-separated).

---

## `ABSTRACT` FB

```iecst
{attribute 'abstract'}
FUNCTION_BLOCK ABSTRACT FB_AbstractDrive
    METHOD ABSTRACT Execute
    END_METHOD
END_FUNCTION_BLOCK
```

TwinCAT uses the pragma `{attribute 'abstract'}` on the FB itself; the `ABSTRACT` keyword appears on abstract method declarations inside the FB. CODESYS uses the same pattern.

---

## `THIS` and `SUPER`

Not technically keywords in the IEC sense, but treated as reserved in TwinCAT:

- `THIS` — pointer to the current FB instance (within a method or property body).
- `SUPER` — pointer to the base FB instance; `SUPER^.MethodName()` calls the parent implementation.

---

## Keywords NOT in CODESYS

TwinCAT 3 has no IEC-level keywords that are completely absent from CODESYS — the OOP extensions above were added to both vendors in parallel (CODESYS V3.5 SP4, TwinCAT 3.1 Build 4020). Older CODESYS V2/V3.3 projects may lack them.

---

## `PROGRAM` vs `FUNCTION_BLOCK`

Both vendors: `PROGRAM` is a singleton (one instance per application); `FUNCTION_BLOCK` is instantiatable. TwinCAT calls the main cycle entry point a `PROGRAM` by convention (`MAIN`). No difference from CODESYS.
