# 11 — Function Block Lifecycle (FB_Init / FB_Reinit / FB_Exit)

> **Source:** https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_method_fb_init_fb_reinit.html
> **Retrieved:** 2026-05-26
> **CODESYS version:** V3.5.22.0

## Summary

Three implicit methods that control function block instance lifecycle. They look like ordinary methods but are wired into runtime events (download, online change, application exit). Misuse silently breaks initialization — code parses, compiles, and runs incorrectly. This is one of the highest-value sections for AI awareness.

## The three methods at a glance

| Method | When called | Required to declare? | Return | Replaces |
|---|---|---|---|---|
| `FB_Init` | Before first use; before online change copy; on factory-reset download | No — implicit by default; declare to add behavior | `BOOL` (unused) | CoDeSys V2.3 `INI` operator |
| `FB_Reinit` | After online change copy; explicitly callable to reset instance | Yes (must be explicit) | `BOOL` (unused) | — |
| `FB_Exit` | Before instance removal (online change, app exit) | Yes (must be explicit) | `BOOL` (unused) | — |

**Return type rule:** All three return `BOOL`. The runtime ignores the value. Changing the return type is undefined behavior.

## Critical rules

1. **Never call `SUPER^.FB_Init`** from your own `FB_Init`. By the time your code runs, implicit initialization has already happened. Calling `SUPER^.FB_Init` re-initializes twice.
2. **These are not constructors.** They behave differently from C#/C++/Java constructors. The implications matter most for derived FBs — see "Derived FBs" below.
3. **For derived FBs, `FB_Init` parameters must match the base FB's `FB_Init` parameters.** You can add new parameters, but you must keep the base ones in the same positions.
4. **`FB_Exit` runs in reverse hierarchy order; `FB_Init` runs in forward.** A 3-level chain `SubSub EXTENDS Sub EXTENDS Main`:
   - Exit: `SubSub.FB_Exit → Sub.FB_Exit → Main.FB_Exit`
   - Init: `Main.FB_Init → Sub.FB_Init → SubSub.FB_Init`
5. **Breakpoints in `FB_Init` may not behave as expected.** Same for methods marked `{attribute 'call_after_init'}`. Debug logging > breakpoints in these methods.
6. **`POINTER` and `REFERENCE` variables can become stale after online change.** The copy operation moves the memory; pointers to the old instance break. Handle this in `FB_Exit(bInCopyCode := TRUE)` or `FB_Reinit`.
7. **`INTERFACE` variables are auto-adapted by the compiler during online change.** No special handling needed.
8. **`{attribute 'no_copy'}` on a variable** prevents that variable from being copied during online change; it keeps its initial value. Useful when copying would invalidate state.

## Signatures

### `FB_Init`
```st
METHOD FB_Init : BOOL
VAR_INPUT
    bInitRetains : BOOL;  // TRUE: retain variables are being initialized (reset warm / reset cold)
    bInCopyCode  : BOOL;  // TRUE: instance will be copied afterward (online change)
END_VAR
```

May add extra `VAR_INPUT` parameters; those become required at instantiation:
```st
METHOD PUBLIC FB_Init : BOOL
VAR_INPUT
    bInitRetains : BOOL;
    bInCopyCode  : BOOL;
    iCOMnum      : INT;   // extra parameter
END_VAR
```
Instantiation:
```st
com1 : serialdevice(iCOMnum := 1);
com0 : serialdevice(iCOMnum := 0);
```

### `FB_Reinit`
```st
METHOD FB_Reinit : BOOL
(* no parameters *)
```
Callable from application code at any time to reset an instance.

### `FB_Exit`
```st
METHOD FB_Exit : BOOL
VAR_INPUT
    bInCopyCode : BOOL;  // TRUE: exit before online-change copy; FALSE: exit before app removal
END_VAR
```

## Detecting which operating case via parameters

The two `BOOL` parameters tell you why the method was called:

| `bInitRetains` | `bInCopyCode` | Scenario |
|---|---|---|
| `TRUE` | `FALSE` | First download to factory-reset PLC; retains are being seeded |
| `FALSE` | `TRUE` | Online change — instance is being copied to new memory location |
| `FALSE` | `FALSE` | New download replacing an existing app (in `FB_Exit`) |

The CODESYS page details four scenarios in long form; the table above is the compressed view.

## Online change sequence

When the application is changed online with FB declaration changes:

1. `old_inst.FB_Exit(bInCopyCode := TRUE)` — last chance to clean up the old instance
2. `new_inst.FB_Init(bInitRetains := FALSE, bInCopyCode := TRUE)` — initialize the new memory
3. `copy(&old_inst, &new_inst)` — preserve existing values
4. `new_inst.FB_Reinit()` — final fixup; sets any values that must be re-derived

If only the **implementation** of an FB changes (not the declaration), no copy happens and none of these methods are called.

## `{attribute 'call_after_init'}` — the post-init hook

`FB_Init` runs **before** initial assignments like `T1 : TON := (PT := t#500ms);`. If you need code that runs **after** initial assignments but before tasks start, use:

```st
{attribute 'call_after_init'}
METHOD PUBLIC MyInit : BOOL
(* runs after FB_Init AND after initial assignments *)
END_METHOD
```

Rules for `call_after_init`:
- The attribute goes above the **declaration part of the function block body** AND above the **declaration of the method**.
- Method name is free **except** `FB_Init`, `FB_Reinit`, `FB_Exit`.
- A POU that extends one with `call_after_init` **must also** use the attribute.
- Recommended pattern: override with the same method name + signature + attribute, call `SUPER^.MyInit` from the override.
- Each `call_after_init` method runs once per instance after initial assignments are processed.
- **Available since compiler version 3.4.1.0.**

## Derived FBs

The page documents the chain order explicitly:

```
SubSub EXTENDS Sub EXTENDS Main

Calling order during online change:
  Exit:  SubSub.FB_Exit → Sub.FB_Exit → Main.FB_Exit
  Init:  Main.FB_Init  → Sub.FB_Init   → SubSub.FB_Init
```

Init parameters must be compatible: derived `FB_Init` declares the same parameters as base, optionally adding extras at the end.

## Notes for tooling

**Diagnostic candidates (Stage 3):**
- `FB_Init` / `FB_Reinit` / `FB_Exit` with wrong return type → error ("must return BOOL")
- `FB_Init` declared without the implicit `bInitRetains` + `bInCopyCode` params → error (or warning if the FB has no base — the spec is fuzzy here)
- `FB_Exit` missing `bInCopyCode` param → error
- `SUPER^.FB_Init` call detected in body → error ("FB_Init is implicitly called; never explicitly chain SUPER")
- Derived FB whose `FB_Init` signature drops a base parameter → error

**Hover augmentation (Stage 3):**
- Hovering on any of the three method names shows the implicit parameter table + which scenarios fire which method
- Hovering on `{attribute 'call_after_init'}` shows the post-init contract

**Not enforceable in LSP:**
- Whether `POINTER`/`REFERENCE` variables are stale-after-online-change — runtime concern
- Whether `{attribute 'no_copy'}` is correctly applied — requires intent inference

**Stage 3 deep-dives this into `src/reference/lifecycle.ts`.**

## Sub-pages

This section has no sub-pages on the CODESYS site.
