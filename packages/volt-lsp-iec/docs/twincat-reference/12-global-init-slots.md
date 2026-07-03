# 12 — Reserved Init Slots (TwinCAT)

> **Source:** https://infosys.beckhoff.com/content/1033/tc3_plc_intro/1600399243.html
> **Retrieved:** 2026-06-07
> **TwinCAT version:** 3 (current GA)

## Summary

TwinCAT uses the same `{attribute 'global_init_slot' := <N>}` pragma as CODESYS (see [`../codesys-reference/12-global-init-slots.md`](../codesys-reference/12-global-init-slots.md)). The **slot numbering is independent** — do not share numbers between a CODESYS project and a TwinCAT project. This page documents the TwinCAT-specific reserved ranges and the recommended user range.

---

## Key rules (TwinCAT-specific)

1. **Default user slot is `50000`** — same number as CODESYS, but the reserved table below is different.
2. **Lower number → earlier init** — same semantics as CODESYS.
3. **Slots 0–65535 are valid.** TwinCAT does not restrict the upper bound at the compiler level.
4. **Slots 0–99 are reserved** for the TwinCAT runtime kernel itself. Do not use them.
5. **Slots 100–999 are reserved** for Beckhoff standard libraries (Tc2_System, Tc2_Standard, etc.). Avoid unless you are maintaining a Beckhoff library.
6. **User code: use 1000–65535.** Slots 1000–49989 run before the default GVL slot; slots ≥ 50001 run after user POUs.

---

## Slot map

| Slot range | Owner | Notes |
|---|---|---|
| 0–99 | TwinCAT runtime kernel | Boot-time system init; hard reserved |
| 100–199 | Tc2_System | `Tc_SysGlobalInit`, `Tc_SysTaskList`, etc. |
| 200–299 | Tc2_Standard | Standard IEC 61131-3 function block instances |
| 300–399 | Tc2_Utilities | Utility library GVLs |
| 400–499 | Tc2_Math | Math library init |
| 500–599 | Tc3_Module | TC3 object-model base init |
| 600–699 | Tc3_IotBase | IoT connection management |
| 700–999 | Reserved for future Beckhoff use | |
| **49990** | Compiler default | **Default slot for GVLs** (same as CODESYS) |
| **50000** | Compiler default | **Default slot for user POUs** (same as CODESYS) |
| 50001–65535 | User-available | After all user POUs; useful for teardown/shutdown ordering |

> **Note:** The 100–999 ranges are based on Beckhoff documentation as of TwinCAT 3.1 Build 4024. New library versions may claim additional slots. When in doubt, check the library's GVL source in the TwinCAT library manager.

---

## Difference from CODESYS

The CODESYS slot map has a much denser reservation table, with slots for Visu, DataSources, AlarmManager, IoConfig, etc., up to slot 49980. TwinCAT does NOT include those CODESYS-specific subsystems.

The safe zone for user code is the same in both: **above 1000 and below 49989** for "before GVLs"; **49991–49999** for "after GVLs but before user POUs"; **50001+** for "after everything".

---

## LSP behavior

The `init-slot-collision` diagnostic fires when a slot number matches an entry in `reference/init-slots.ts`. The TC entries in that file use the ranges above. Set `volt.structuredText.vendor = "twincat"` (or use `"auto"` with a TC workspace) so the LSP applies TC-specific reserved ranges rather than CODESYS ones.
