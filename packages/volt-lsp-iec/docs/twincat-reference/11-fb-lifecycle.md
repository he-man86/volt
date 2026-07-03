# 11 — Methods FB_Init, FB_Reinit, FB_Exit (TwinCAT Deltas)

> **Source:** https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2527361291.html
> **Retrieved:** 2026-06-07
> **TwinCAT version:** 3 (current GA)

## Summary

`FB_Init`, `FB_Reinit`, and `FB_Exit` work the same in TwinCAT and CODESYS. This page confirms the shared behaviour and documents the **TwinCAT-specific nuances**.

For the base reference see [`../codesys-reference/11-fb-lifecycle.md`](../codesys-reference/11-fb-lifecycle.md).

---

## `FB_Init` — same as CODESYS

Called once when an FB instance is created (application download, `__NEW`, or power-up). Signature:

```iecst
METHOD FB_Init : BOOL
VAR_INPUT
    bInitRetains  : BOOL;   // TRUE on first download; FALSE on online change
    bInCopyCode   : BOOL;   // TRUE when called inside an online change code copy
END_VAR
```

- Return value is ignored by the runtime (always declared `BOOL` for signature compatibility).
- Additional custom parameters may be added after `bInitRetains` / `bInCopyCode` — the runtime passes defaults; callers can pass explicit values via the `init` syntax:

```iecst
fbMotor : FB_Motor(nMaxSpeed := 3000, fGain := 1.5);
```

This extended init syntax is available in both TwinCAT and CODESYS.

---

## `FB_Reinit` — same as CODESYS

Called after an online change when the FB's implementation changed (method body modified but type layout unchanged). Signature:

```iecst
METHOD FB_Reinit : BOOL
```

No parameters. Use to re-arm timers, reset one-shot flags, or reconnect references that may have been invalidated.

---

## `FB_Exit` — same as CODESYS

Called before the FB is destroyed — on application stop, explicit `__DELETE`, or online change layout replacement. Signature:

```iecst
METHOD FB_Exit : BOOL
VAR_INPUT
    bInCopyCode : BOOL;
END_VAR
```

`bInCopyCode = TRUE` means the FB will be re-created immediately (layout-changing online change). Use this to release external resources (COM references, ADS connections, dynamic memory).

---

## TwinCAT-specific: call ordering via `{attribute 'call_after_online_change_slot'}`

After an online change, TwinCAT calls `FB_Reinit` on all affected instances. The order is undefined unless you use the pragma:

```iecst
{attribute 'call_after_online_change_slot' := '100'}
METHOD FB_Reinit : BOOL
```

Lower slot = earlier reinit call. Same slot-ordering semantics as `{attribute 'global_init_slot'}` (see [12-global-init-slots.md](./12-global-init-slots.md)).

CODESYS has no equivalent ordering mechanism for `FB_Reinit`. CODESYS projects that depend on reinit order are relying on undefined behaviour.

---

## TwinCAT-specific: `FB_Init` called by `__NEW`

When an FB is allocated dynamically via `__NEW(FB_Motor)`, `FB_Init` is called automatically with `bInitRetains := FALSE` and `bInCopyCode := FALSE`. You cannot pass custom init parameters via `__NEW`; do so after allocation:

```iecst
pMotor := __NEW(FB_Motor);
IF pMotor <> 0 THEN
    pMotor^.SetSpeed(3000);   // manual post-init
END_IF
```

CODESYS `__NEW` also calls `FB_Init` automatically — same behaviour.

---

## `FB_Exit` and `__DELETE`

`__DELETE(pMotor)` calls `FB_Exit` (with `bInCopyCode := FALSE`) before freeing the block. Always implement `FB_Exit` in FBs that hold:

- ADS connections (`FB_AdsConnection`)
- TwinCAT Module references
- Dynamically allocated sub-objects (call `__DELETE` on children in `FB_Exit`)

Failing to release ADS connections in `FB_Exit` causes handle leaks visible in the TwinCAT router.
