## Why

The CODESYS device tree (EtherCAT master, drives, axes, I/O modules, bus couplers) is exposed to IEC code
as **implicit global variables** — source reads `EtherCAT_Master.xRestart`, `YDrive.lrActPosition`,
`MAxesGroup := MagazineAxes`. Those globals live in the device tree, which `volt pull` never mirrored, so
every **bare** device reference resolved nowhere and false-positived as an unresolved identifier — ~40 of
the pro2193 LSP floor (after the library-namespace win took it to 95).

A **live spike (2026-07-02)** settled two things:
- The exact IEC type of a device instance (`AXIS_REF`-ish) is only in the *app compiled symbol table*
  (`GetCompileContext(appGuid).GetAllSignaturesFlat()`), which needs a clean build — and the headless test
  rig **can't build** (missing device-support packages → `GetCompileContext` returns null). So types are
  not reliably reachable, and — since a device's members (`lrActPosition`) are internal and not ours to
  validate — the type is informational only.
- The **device descriptor** (Name/Vendor/Type/ID/Version/Order number/Description — the CODESYS
  Information-tab fields) IS reachable build-free, via the scripting `ScriptDeviceObject` facet →
  `GetReadable().DeviceInfo` + `get_device_identification`.

So the LSP only needs the device instance **names** to resolve the references; the descriptor carries the
identity for the human/AI.

## What Changes

**CODESYS (this change — DONE):** the bridge walks the device tree and emits every `IDeviceObject` node
(controller, masters, drives, axes, I/O) as a **read-only `.device` descriptor** file (new item kind
`PlcDevice`=695), materialized 1:1 with the CODESYS tree. The LSP registers each `.device` **filename** as
a known device-instance global (parallel to the library-namespace skip); a bare reference resolves, and
member access into a device's internal type falls through (uncheckable by design). Result on pro2193:
diagnostics **95 → 55**, zero device stragglers.

Alongside it, the whole walk became a **complete 1:1 project mirror**: every container (user folder,
`PlcLogic`/`Application`/`TaskConfig`, the SoftMotion `Kinematics`/`Functions` groupers, and each device)
nests its children under its own name — so the workspace reads exactly as the IDE
(`Device/Plc Logic/Application/<usercode>`, hardware as siblings under `Device/`) instead of hardware
under `Device/` and software flattened at the root.

**TwinCAT/Beckhoff (deferred — this change documents the plan):** the parity boundary is the wire, so
Beckhoff must emit the same `.device` items with a byte-compatible descriptor from the TwinCAT I/O tree.
The downstream (materialize → LSP → corpus) is already vendor-neutral and needs no change. Until then
Beckhoff returns no devices — a documented parity gap that keeps the wire contract identical in shape.
See `design.md` → "TwinCAT implementation".
