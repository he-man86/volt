# 08 — Identifiers (TwinCAT Deltas)

> **Source:** https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2527339019.html
> **Retrieved:** 2026-06-07
> **TwinCAT version:** 3 (current GA)

## Summary

TwinCAT identifier rules follow IEC 61131-3 with minor additions. This page covers only the **TwinCAT-specific extensions**.

For the base reference see [`../codesys-reference/08-identifiers.md`](../codesys-reference/08-identifiers.md).

---

## Base rules (same as CODESYS)

- Case-insensitive: `myVar`, `MyVar`, `MYVAR` are the same identifier.
- First character: letter or underscore.
- Subsequent characters: letters, digits, underscores.
- Maximum length: 32 characters in TwinCAT 3.1 (same as CODESYS V3).
- Reserved keywords may not be used as identifiers; see [10-keywords.md](./10-keywords.md).

---

## `__SYSTEM` namespace

TwinCAT reserves the `__SYSTEM` namespace for compiler-intrinsic types and functions. Identifiers beginning with `__SYSTEM.` are built-in:

| Identifier | Kind | Purpose |
|---|---|---|
| `__SYSTEM.VAR_INFO` | Struct | Returned by `__VARINFO()` |
| `__SYSTEM.TYPE_CLASS` | Enum | Type classification returned by `__VARINFO()` |
| `__SYSTEM.GetTimestamp` | Function | Microsecond task timestamp |

Do not declare variables or types that begin with `__SYSTEM` — the compiler treats them as reserved.

---

## Double-underscore prefix (`__`)

Identifiers beginning with `__` (double underscore) are reserved for TwinCAT compiler intrinsics: `__NEW`, `__DELETE`, `__ISVALIDREF`, `__VARINFO`, `__QUERY_INTERFACE`, `__QUERY_POINTER`, `__TRY_CAST`. Do not use `__` as a prefix for user-defined identifiers.

CODESYS also reserves `__` for its own built-ins (`__POOL`, `__MONITORED_VAR`). Portable code avoids the `__` prefix entirely.

---

## `Tc` prefix convention

Identifiers beginning with `Tc` followed by an uppercase letter or digit are treated as belonging to the TwinCAT namespace in the Volt LSP's `unknown-pragma` check (e.g. `TcLinkTo`, `TcContextId`). This is a Volt LSP convention, not a TwinCAT compiler constraint — the compiler does not enforce namespace prefixing.

User-defined attribute names that happen to start with `Tc` should be renamed to avoid false negatives in the pragma check (they won't warn even if unrecognised).

---

## Object naming conventions (not enforced)

Beckhoff's recommended style (from their sample libraries):

| Kind | Prefix | Example |
|---|---|---|
| Function Block | `FB_` | `FB_MotorControl` |
| Interface | `I_` | `I_Diagnostics` |
| Method | none | `Execute`, `Reset` |
| Enum | `E_` | `E_AxisState` |
| Struct | `ST_` | `ST_MotorParams` |
| Global Variable List | `GVL_` | `GVL_Constants` |
| DUT (general) | none or prefix by kind | |
| Function | `F_` | `F_Clamp` |
| Program | `PRG_` | `PRG_Main` |

These are conventions documented in Beckhoff's TwinCAT Style Guide — the compiler does not enforce them.
