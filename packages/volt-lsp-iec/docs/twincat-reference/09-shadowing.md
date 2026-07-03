# 09 — Shadowing Rules (TwinCAT Deltas)

> **Source:** https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2527346443.html
> **Retrieved:** 2026-06-07
> **TwinCAT version:** 3 (current GA)

## Summary

TwinCAT and CODESYS share the same name-resolution search order. This page confirms where TwinCAT behaves identically to CODESYS and documents any differences.

For the base reference see [`../codesys-reference/09-shadowing.md`](../codesys-reference/09-shadowing.md).

---

## Search order — same as CODESYS

TwinCAT resolves an unqualified identifier in this order:

1. **Local variables** (`VAR … END_VAR` in the current POU / method).
2. **Input / output / in-out** (`VAR_INPUT`, `VAR_OUTPUT`, `VAR_IN_OUT`).
3. **Instance variables** (for a method: the FB's member variables declared in the FB body).
4. **Inherited members** (`EXTENDS` chain, outermost ancestor last).
5. **Global variable lists** (`VAR_GLOBAL` in any GVL in the project).
6. **Library namespaces** (libraries added to the project, in the order they appear in the library manager).

First match wins. A local variable shadows a GVL variable of the same name silently (no error, no warning by default).

---

## `{attribute 'strict'}` and shadowing warnings

TwinCAT's `strict` pragma (applied to an enum declaration) disables implicit conversions but does **not** affect shadowing. There is no TwinCAT pragma equivalent to a general "warn on shadow" setting.

The Volt LSP emits a `variable-shadows-global` diagnostic (configurable, off by default) when a local or input variable name matches a GVL variable. This is a Volt LSP extension, not a TwinCAT compiler warning.

---

## Method shadowing in OOP

When an extended FB declares a method with the same name as a method on its base class:

- Without `OVERRIDE`: TwinCAT compiles but the base method is inaccessible via the subclass — effectively shadowed. The compiler emits a warning: *"Method 'X' hides method of base class."*
- With `OVERRIDE`: the method overrides the base. Polymorphic calls through an interface dispatch to the override.
- With `FINAL` on the base method: the subclass cannot override it; attempting to do so is a compile error.

CODESYS follows the same rules.

---

## Namespace qualification to defeat shadowing

When a local variable shadows a GVL variable, qualify the GVL reference explicitly:

```iecst
VAR
    nValue : INT := 5;  // shadows GVL_Constants.nValue
END_VAR

// Access the GVL version explicitly:
GVL_Constants.nValue := 10;
// Access the local:
nValue := 10;
```

Library-qualified access: `Tc2_System.T_MaxString`.
