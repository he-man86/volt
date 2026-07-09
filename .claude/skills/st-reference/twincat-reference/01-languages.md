# 01 — Programming Languages and Editors (TwinCAT Deltas)

> **Source:** https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2527291915.html
> **Retrieved:** 2026-06-07
> **TwinCAT version:** 3 (current GA)

## Summary

TwinCAT 3 supports the same six IEC 61131-3 languages as CODESYS (ST, IL, FBD, LD, SFC, CFC). This page lists the differences in how TwinCAT's editor environment (XAE — eXtended Automation Engineering, a Visual Studio shell) behaves compared to the CODESYS Development System.

For shared language rules see [`../codesys-reference/01-languages-and-editors.md`](../codesys-reference/01-languages-and-editors.md).

---

## Editor environment

| Aspect | TwinCAT 3 XAE | CODESYS |
|---|---|---|
| Host shell | Visual Studio 2017/2019/2022 (Shell or full) | Standalone CODESYS IDE |
| Solution file | `.sln` + `.tsproj` | `.project` |
| POU file extension | `.TcPOU` (XML) | `.st` / `.exp` (text export) |
| DUT extension | `.TcDUT` | `.dut` |
| GVL extension | `.TcGVL` | `.gvl` |
| Interface extension | `.TcITF` | `.itf` |
| Language switcher | Drop-down per network / implementation | Drop-down in object properties |

---

## Online change

Both vendors support online change (downloading code modifications without a PLC cold start). TwinCAT differences:

- TwinCAT calls this **"Online Change"** or **"OC"**; the CODESYS term is also "Online Change".
- TwinCAT requires the PLC task to be in a runnable state; CODESYS allows OC from `STOP`.
- `FB_Reinit` is called on any FB instance whose type changed — same in both.
- TwinCAT `{attribute 'call_after_online_change_slot'}` controls the order of reinit calls; see [07-pragmas.md](./07-pragmas.md).

---

## IL (Instruction List)

IL is **deprecated** in TwinCAT 3.1 Build 4024 and later. The TwinCAT compiler still accepts existing IL code, but the editor no longer creates new IL networks. Migrate IL to ST or FBD before upgrading to TC 4026+.

CODESYS formally deprecated IL in V3.5 SP18 but keeps full editor support for longer.

---

## SFC differences

TwinCAT SFC steps have an optional **qualifier column** (N / S / R / P / P0 / P1) displayed inline in the graphical editor. CODESYS renders qualifiers via a separate dialog. The runtime semantics are identical per IEC 61131-3.

---

## CFC (Continuous Function Chart)

CFC is available in both vendors. TwinCAT CFC does not require explicit execution-order numbering for boxes that have no cyclic dependencies — the compiler determines order. CODESYS CFC requires the user to assign execution-order numbers to every box.

---

## Language server note

The Volt LSP analyzes the ST declaration block of every file regardless of body language. FBD, LD, SFC, CFC bodies are parsed for structure (connections, network topology) but not for semantic diagnostics. IL bodies are parsed for structure only — no IL-specific diagnostics.
