# 14 — Library and Namespace Conventions

> **Source:** https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2527332619.html
> **Retrieved:** 2026-06-07
> **TwinCAT version:** 3 (current GA)

## Summary

TwinCAT 3 organises its built-in and add-on libraries under two namespace families: `Tc2_*` (TwinCAT 2 compatibility and general-purpose) and `Tc3_*` (TwinCAT 3 native). Understanding the naming convention tells you at a glance which generation a library targets and whether it is included in TwinCAT Base or requires a separate licence.

This matters for the LSP's `unknown-pragma` and `wrong-vendor-pragma` diagnostics: symbols prefixed `Tc2_` / `Tc3_` are expected in TwinCAT projects and receive the namespace bypass in the unknown-pragma check. In a CODESYS project, seeing `Tc2_` / `Tc3_` imports is a `wrong-vendor-pragma`-equivalent signal.

---

## `Tc2_*` — TwinCAT 2 compatibility and general-purpose libraries

Included in TwinCAT Base (no extra licence). Originally ported from the TwinCAT 2 PLC runtime; available in TC3 for backward compatibility and general use.

| Library | Namespace | Key contents |
|---|---|---|
| `Tc2_Standard` | `Tc2_Standard` | IEC 61131-3 standard FBs: `TON`, `TOF`, `TP`, `CTU`, `CTD`, `CTUD`, `RS`, `SR`, `R_TRIG`, `F_TRIG` |
| `Tc2_System` | `Tc2_System` | Task management (`GETCURTASKINDEX`), timing (`Tc_GetPLCSystemTime`), system info (`Tc_GetCpuUsage`), `T_MaxString`, `F_STRING` |
| `Tc2_Utilities` | `Tc2_Utilities` | String functions (`F_ToASCII`, `F_BYTE_TO_NIBBLES`), DUT sorting, ring buffers (`FB_MemRingBuffer`) |
| `Tc2_Math` | `Tc2_Math` | Extended math: `F_POW`, `F_SQRT`, `F_LOG`, `F_SIN`, `F_COS`, etc. |
| `Tc2_MC2` | `MC` | Motion Control v2: `MC_Power`, `MC_MoveAbsolute`, `MC_Home`, etc. |
| `Tc2_Drive` | `TC_Drive` | Drive profile interfaces: `MC_WriteDriveParameter`, `MC_ReadDriveParameter` |
| `Tc2_EtherCAT` | `Tc2_EtherCAT` | EtherCAT master management: `FB_EcGetSlaveIdentity`, diagnostic FBs |
| `Tc2_IoFunctions` | `Tc2_IoFunctions` | I/O mapping utilities; bit-level access helpers |
| `Tc2_DCOM` | `Tc2_DCOM` | COM/DCOM interop (advanced/legacy) |

---

## `Tc3_*` — TwinCAT 3 native libraries

TwinCAT 3-only; some require additional licences (marked ★).

| Library | Namespace | Key contents |
|---|---|---|
| `Tc3_Module` | `Tc3_Module` | TC3 object communication: `FB_ModuleBase`, `FB_ComponentBase` |
| `Tc3_IotBase` | `Tc3_IotBase` | IoT protocol base: MQTT, AMQP, raw TCP helpers ★ |
| `Tc3_JsonSon` | `Tc3_JsonSon` | JSON serialisation/deserialisation ★ |
| `Tc3_Database` | `Tc3_Database` | Database query and write FBs ★ |
| `Tc3_PackML` | `Tc3_PackML` | PackML state machine |
| `Tc3_Physics` | `Tc3_Physics` | Physical units and conversions |

---

## Library reference format in `.tsproj`

TwinCAT stores library references in the `.tsproj` XML. Two formats exist:

### Version-qualified (recommended)

```xml
<LibraryReference>Tc2_Standard, 3.4.3.0 (Beckhoff Automation GmbH)</LibraryReference>
```

Pins to an exact version. Reproducible builds; safe for CI.

### Wildcard version (`*`)

```xml
<LibraryReference>Tc2_Standard, * (Beckhoff Automation GmbH)</LibraryReference>
```

Resolves to whatever is installed in the TwinCAT installation. Convenient during development; risky in production — a TwinCAT update can silently change behaviour.

### GUID references (legacy TC2 style)

Older `.tsproj` files may use GUID-based references:

```xml
<LibraryReference>{GUID}</LibraryReference>
```

These are not human-readable and break when the library is reinstalled. The TwinCAT Library Manager can migrate them to qualified-name references.

---

## Namespace imports in ST code

Unlike CODESYS, TwinCAT does **not** auto-expose library namespaces to all POUs. Each POU that uses a library symbol must either:

1. Qualify the symbol: `MC.MC_Power`, `Tc2_System.T_MaxString`
2. Or have the library namespace listed in the POU's `{attribute 'namespace'}` declarations (rare; most code qualifies).

The LSP respects unqualified `Tc2_` / `Tc3_` names as expected in a TwinCAT context — they receive the same namespace bypass as `Tc*`-prefixed pragma names.

---

## CODESYS library equivalents

CODESYS does not use `Tc2_*`/`Tc3_*` namespaces. The functional equivalents:

| TwinCAT | CODESYS |
|---|---|
| `Tc2_Standard.TON` | `CAA_Types.TON` / built-in |
| `Tc2_System.T_MaxString` | `STRING(255)` (native) |
| `Tc2_MC2.MC_Power` | `CoDeSys_MC2.MC_Power` |
| `Tc3_PackML` | `CoDeSys_PackML` |

When migrating a project between vendors, these library substitutions are the primary porting cost. The LSP's `wrong-vendor-pragma` diagnostic surfaces `Tc2_`/`Tc3_` references in a CODESYS project as a first warning.

---

See [`../codesys-reference/`](../codesys-reference/00-index.md) for shared language rules that apply to both vendors.
