# 02 — Variables

> **Source:** https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_struct_reference_variable_types.html
> **Retrieved:** 2026-05-26
> **CODESYS version:** V3.5.22.0

## Summary

CODESYS provides 11+ distinct variable kinds, each with its own scope, lifetime, retentivity, and pass-by-semantics. The choice of `VAR_*` keyword is **load-bearing** — it determines memory location, initialization, and how the variable behaves across reset/download/online-change. The AI must pick the right kind based on intent; this section captures the rules.

## The variable kinds

| Keyword | Scope | Pass semantics | Lifetime | Notes |
|---|---|---|---|---|
| `VAR` | Local to POU | n/a | POU lifetime | Default local. Read-only access externally via instance path. |
| `VAR_INPUT` | FB/function/method input | **Pass-by-value** (copy) | Per call | Can be `CONSTANT`/`RETAIN`/`PERSISTENT`. |
| `VAR_OUTPUT` | FB/function/method output | Read by caller via `=>` | Per call | For functions/methods, callers must assign with `=>` syntax. |
| `VAR_IN_OUT` | FB/function/method I/O | **Pass-by-reference** (pointer) | Per call | Read-write; changes persist back to caller. Cannot pass literal, constant, or bit variable directly. |
| `VAR_GLOBAL` | Application-wide | n/a | Application lifetime | Declared in GVL or POU declaration. Initialized before local POU vars (compiler ≥ 3.2.0.0). |
| `VAR_TEMP` | Local to POU | n/a | **Per call** — re-initialized each call | **Programs and FBs only.** Not for functions. ExST extension. |
| `VAR_STAT` | Local to namespace | n/a | Application lifetime; initialized on download | C-like static. Holds value across calls. ExST extension. |
| `VAR_EXTERNAL` | Imports a global | n/a | Lifetime of global | IEC-compliance only — CODESYS doesn't require it. Initialization not permitted. |
| `VAR_INST` | **Methods only** | n/a | FB instance lifetime | Stored in FB's instance stack, NOT method stack. Survives across method calls. |
| `VAR_CONFIG` | GVL only | n/a | Configures address for FB instances | Maps device I/O addresses (`%I*`) to full instance paths. |
| `VAR_ACCESS` | (export-format) | — | — | Reserved keyword; rarely used. |
| `VAR_GENERIC CONSTANT` | Function generics | — | — | Generic-constant variant. Used in function templates. |

## Modifiers (combine with `VAR_*` keywords)

| Modifier | Effect | Allowed scopes |
|---|---|---|
| `CONSTANT` | Read-only; must have initial value at declaration | `VAR`, `VAR_INPUT`, `VAR_STAT`, `VAR_GLOBAL` |
| `RETAIN` | Stored in retain memory; survives warm-reset and download | `VAR`, `VAR_INPUT`, `VAR_OUTPUT`, `VAR_IN_OUT`, `VAR_STAT`, `VAR_GLOBAL` |
| `PERSISTENT` | Stored in persistent memory; survives cold-reset and download | `VAR_GLOBAL PERSISTENT RETAIN` is canonical; locally only with `PERSISTENT RETAIN` or `RETAIN PERSISTENT` |
| `NON_RETAIN` | Explicitly NOT retained (overrides cascading retain) | Used in retain contexts |

## Key rules per kind

### `VAR` — local

```st
VAR
  iVar1 : INT;
END_VAR
```
External read access via instance path (`pou.iVar1`). External **write** requires `VAR_OUTPUT`.

### `VAR_INPUT` — input parameters

```st
VAR_INPUT
  iIn1 : INT;
END_VAR
```
Pass-by-value: caller's value is copied. Caller cannot observe the callee's modifications.

### `VAR_OUTPUT` — output parameters

```st
VAR_OUPUT
  iOut1 : INT;
END_VAR
```
**Functions and methods** require callers to assign outputs explicitly:
```st
fun(iIn1 := 1, iIn2 := 2, iOut1 => iLoc1, iOut2 => iLoc2);
```
(Spelled `VAR_OUPUT` in some examples on the CODESYS site — likely a typo in their docs; the parser accepts `VAR_OUTPUT`.)

### `VAR_IN_OUT` — pass-by-reference

```st
VAR_IN_OUT
  aData : ARRAY[0..1] OF DUT_A;
END_VAR
```

**Rules:**
- Caller passes a **variable** (not a literal, not a bit variable, not a property).
- The callee's writes affect the caller's variable directly.
- **Cannot be read/written externally via `fb.varName`** — that only works for `VAR_INPUT`/`VAR_OUTPUT`. `VAR_IN_OUT` is call-site-only.
- **Strings:** caller's and callee's `STRING(n)` lengths should match. Mismatch can corrupt data on write. Exception: `VAR_IN_OUT CONSTANT` strings auto-pass full length.
- **Bit variables:** cannot pass a bit variable directly; needs intermediate variable.
- **Properties:** cannot pass.

### `VAR_GLOBAL` — global

```st
VAR_GLOBAL
  g_iVar1 : INT;
END_VAR
```

- Local variable with same name **shadows** the global within its POU.
- Reference via `.g_iVar1` (leading dot) or `GVL.g_iVar1` (if qualified) forces global resolution.
- Compiler ≥ 3.2.0.0 initializes globals before local POU variables.

### `VAR_TEMP` — temporary

```st
VAR_TEMP
  iTmp : INT;
END_VAR
```

- **Only** in programs and FBs (NOT in functions).
- Re-initialized on every POU call.
- **Conflicts:** `VAR_TEMP` in a program with `{attribute 'subsequent'}` → compile error.

### `VAR_STAT` — static (C-style)

```st
VAR_STAT
  iCounter : INT;
END_VAR
```

- Local to its namespace; not visible elsewhere.
- Initialized **on download**, not on each call.
- Retains value across calls — useful for counters, state machines inside functions.
- ExST extension.

### `VAR_EXTERNAL` — IEC-style global import

```st
VAR_EXTERNAL
  iVarExt1 : INT;
END_VAR
```

- "Imports" a `VAR_GLOBAL` into a POU.
- Initialization not permitted (the global already has one).
- **CODESYS does NOT require this for global access** — IEC-compliance feature only. Plain reference to the global also works.

### `VAR_INST` — method instance variable

```st
METHOD meth_last : INT
VAR_INPUT iVar : INT; END_VAR
VAR_INST iLast : INT := 0; END_VAR

meth_last := iLast;
iLast := iVar;
```

- **Methods only.**
- Stored in the FB instance's stack, not the method's call stack.
- Retains value across calls of the same method on the same instance.
- Monitorable in declaration-part view.

### `VAR_CONFIG` — address binding

```st
(* In an FB *)
FUNCTION_BLOCK locio
VAR
  xLocIn AT %I* : BOOL := TRUE;     (* incomplete address *)
END_VAR

(* In a GVL — variable configuration *)
VAR_CONFIG
  PLC_PRG.locioVar1.xLocIn AT %IX1.0 : BOOL;
END_VAR
```

Binds a full I/O address to an FB instance variable that was declared with an incomplete address (`%I*`). The GVL providing this is called a **variable configuration**.

### `RETAIN` — retain memory

```st
VAR RETAIN
  iVarRetain : INT;
END_VAR
```

| Declared in | Retain scope |
|---|---|
| Program | Just the variable (with redundancy: entire program) |
| Global variable list | Just the variable (with redundancy: entire GVL) |
| **Function block** | **Entire FB instance + all its data** — only the declared retain variable is "protected" but the whole instance lives in retain memory |
| Function | **No effect** — declaration is silently ignored |
| Function (persistent local) | **No effect** |

**Tip from CODESYS:** "Whenever possible, avoid using RETAIN to mark the variables of a function block." Use program/GVL scope instead.

**Disallowed:** `AT %I*`-style address binding on retain variables.

### `PERSISTENT` — persistent memory

```st
VAR_GLOBAL PERSISTENT RETAIN
  g_iCounter : INT;
  // Generated instance path of persistent variable:
  PLC_PRG.fb_A.iPersistentCounter_A : INT;
END_VAR
```

- Canonical form: `VAR_GLOBAL PERSISTENT RETAIN` in the persistent global variable list.
- In a POU: `VAR PERSISTENT RETAIN` or `VAR RETAIN PERSISTENT` — equivalent since V3.3.0.1. Bare `PERSISTENT` (without `RETAIN`) is also accepted at POU scope from V3.3.0.1.
- **Forbidden in FBs:** an FB cannot have `VAR PERSISTENT` alone — must be `VAR PERSISTENT RETAIN`.
- **No** `AT`-bound addresses.
- **Avoid `POINTER TO`** — addresses can change across downloads, invalidating the pointer. Compiler warns.
- **Avoid embedded instance paths** — doubles memory usage and increases cycle time. Declare directly in the persistent variable list.

### Memory area cheat sheet

| Variable | Memory area | Survives warm reset? | Survives cold reset? | Survives download? |
|---|---|---|---|---|
| `VAR` | Normal | No | No | No |
| `VAR RETAIN` | Retain | **Yes** | No | **Yes** (depending on download mode) |
| `VAR PERSISTENT RETAIN` | Persistent | **Yes** | **Yes** | **Yes** |

## `THIS` and `SUPER` pointers

Documented in [01-languages-and-editors.md](./01-languages-and-editors.md). Quick recap:
- `THIS^` is the FB's own instance. Use to disambiguate FB field from a method-local var.
- `SUPER^` is the base FB instance for `EXTENDS`-derived FBs. Use to call base-class methods/access base fields.
- Neither is supported in IL.

## Implicit Enumeration

URL: `_cds_datatype_implicit_enumeration.html` (also referenced from section 06). Implicit enums are integer values used positionally — covered fully in [06-data-types.md](./06-data-types.md) under ENUM.

## Sub-page catalog

Total: 17 pages.

| Sub-page | URL fragment |
|---|---|
| VAR | `_cds_vartypes_var.html` |
| VAR_INPUT | `_cds_vartypes_var_input.html` |
| VAR_OUTPUT | `_cds_vartypes_var_output.html` |
| VAR_IN_OUT | `_cds_vartypes_var_in_out.html` |
| VAR_GLOBAL | `_cds_vartypes_var_global.html` |
| VAR_TEMP | `_cds_vartypes_var_temp.html` |
| VAR_STAT | `_cds_vartypes_var_stat.html` |
| VAR_EXTERNAL | `_cds_vartypes_var_external.html` |
| VAR_INST | `_cds_vartypes_var_inst.html` |
| VAR_CONFIG | `_cds_vartypes_var_config.html` |
| CONSTANT | `_cds_vartypes_constant.html` |
| VAR_GENERIC CONSTANT | `_cds_vartypes_var_generic_constant.html` |
| PERSISTENT | `_cds_var_persistent.html` |
| RETAIN | `_cds_var_retain.html` |
| SUPER | `_cds_pointer_super.html` |
| THIS | `_cds_pointer_this.html` |
| Implicit Enumeration | `_cds_datatype_implicit_enumeration.html` |

## Notes for tooling

**Already supported in parser:**
- `VarSection` AST node carries all `VAR_*` kinds (`src/parser/ast.ts:156-177`)
- `VarSectionKind` enum: `VAR | VAR_INPUT | VAR_OUTPUT | VAR_IN_OUT | VAR_TEMP | VAR_STAT | VAR_INST | VAR_EXTERNAL | VAR_GLOBAL | VAR_CONFIG | VAR_ACCESS`
- Modifiers `CONSTANT`, `RETAIN`, `PERSISTENT` already parsed
- `AT <address>` clause is captured (TwinCAT `%I*` and CODESYS forms)

**Diagnostic candidates:**
- `VAR_TEMP` in a function → error ("only in programs and FBs")
- `VAR_TEMP` in a program with `{attribute 'subsequent'}` → error
- `VAR_INST` outside a method → error ("methods only")
- `VAR PERSISTENT` (without `RETAIN`) in an FB → error
- `RETAIN` in a function → warning ("ignored in functions")
- `VAR_IN_OUT` parameter passed a literal/constant at call site → error (Stage 5+, requires call-site analysis)
- `VAR_CONFIG` outside a GVL → error
- `VAR_EXTERNAL` with initialization → error

**Hover augmentation:**
- Hovering on each VAR kind shows: scope, pass-semantics, lifetime, memory area
- Hovering on `RETAIN`/`PERSISTENT` shows the survival table
