# 12 — Global Init Slots

> **Source:** https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_global_init_slots.html
> **Retrieved:** 2026-05-26
> **CODESYS version:** V3.5.22.0

## Summary

Global variables and initialization-time POUs are processed in a fixed numeric order — the **slot number** determines when they run during application startup. Higher slot = later. CODESYS reserves certain slot ranges for internal subsystems (visualization, IO mapping, libraries) and ships a default slot of `50000` for user code.

Understanding this is critical when you write code that **depends on something else being initialized first**. The standard hook for "run my init after X" is the pragma `{attribute 'global_init_slot' := <N>}` placed on a POU. See [07-pragmas.md](./07-pragmas.md).

## Critical rules

1. **Default user slot is `50000`.** All ordinary user code initializes in that slot.
2. **Lower number → earlier.** A POU with slot `49990` runs before everything in `50000`.
3. **Slot collisions are allowed.** Two GVLs at the same slot have undefined order relative to each other; depending on this is a bug.
4. **Most slot numbers are reserved by CODESYS subsystems** — see table below. Don't pick a slot you don't understand.
5. **The default value for all GVLs is `49990`** (one tick before user POUs), so GVLs always initialize before user FBs.
6. **The pragma `{attribute 'global_init_slot' := <N>}` overrides the default** for the POU it decorates.

## The full slot map (V3.5.22.0)

Reproduced from the CODESYS page. Use this when picking a slot for `{attribute 'global_init_slot'}`.

| Slot | Owner | POU | Purpose |
|---|---|---|---|
| 123 | GVLObject | `__var_persistent_write` | Copy persistent vars from persistent list to mapped instance paths |
| 199 | Compiler | `__var__retain__read__` | Copy retain vars from retain area (target setting `retain-in-cycle-code`) |
| 200 | LanguageModelManager | `__ValidateLicenseMetrics` | Send `AppBasedLicenseMetrics` to runtime |
| 500 | VisualObject | `Visu__VisualManager__AfterInitProgram` | Visu init (group: `Called within Visu-Initialization`) |
| 500 | VisualObject | `__datasourcesFrame` | Visu↔data source interaction |
| 600 | DataSourcesObject | `__datasourcesUpdateByDefaultCall`, `__datasourcesUpdateByDefaultGVL` | Data source init |
| 1000 | DeviceObject | `IoGlobalInit__Pou` | Device object instances |
| 1000 | Library: Datasource Application V3 | `AccessLogger` | Library logging init |
| 1000 | Library: Datasource Symbolic Access | `Logger` | Library logging init |
| 1000 | Library: Datasources | `Logger` | Library logging init |
| 1234 | ApplicationComposer | `AC_Init` | Generated POU init |
| 1234 | ApplicationComposer | `AC_OnlineChange` | Online-change reinit for AC-created FBs |
| 10000 | Library: Datasource Symbolic Access | `GVL_EarlyInit` | Symbolic data source early init |
| 20000 | Library: Alarm Manager | `AlarmConstants` | Alarm handling init |
| 24000 | Library: VisuElemBase | `Private_Visu_Globals`, `GVL_NativeElement`, `GVL_TypeInformation` | Visu init |
| 24000 | Library: Visu Interfaces | `GVL` | Visu init |
| 25000 | Library: VisuElemBase | `GVL_CommandManager`, `Visu_Globals` | Visu init |
| 25000 | Library: VisuCommandInterface | `GVL` | Visu init |
| 25000 | Library: RecipeManagement | `GVL_RecipeManagement_Temp` | Visu init |
| 25990 | Library: VisuElemBase | `VisuFctDatasourcesResourceEntryAllocatorGet_MBM`, `..._SysMem` | Visu resource init |
| 26000 | Library: VisuElemBase | `Visu_Resources` | Visu init |
| 30000 | Library: Alarm Manager | `AlarmGlobals` | Alarm processing |
| 30000 | Library: Alarm Manager | `GloballyForAlarmStorage` | Alarm storage (post `_3SStorage`) |
| 30000 | Library: VisuFPlot | `GlobalInstances` | Visu init |
| 30000 | Library: VisuTrendStorageAccess | `GlobalInstances` | Visu init |
| 39900 | DeviceObject | `IoConfig_Globals_ModuleList` | Module list for all device connectors |
| 40000 | DeviceObject | `IoConfig_Globals_Mapping` | Mapped variables from all devices |
| 40000 | TrendRecordingObject | `__GVL__TrendRecordingManager` | Trend recording init |
| 40100 | DeviceObject | `IoConfig_Forces_Reset` | Force variables for I/O mapping (if option set) |
| **49980** | Compiler | All `VAR_STAT` | Initialize all `VAR_STAT` variables |
| **49985** | Compiler | `__MemManDefinition` | Dynamic memory management GVL (must precede normal GVLs) |
| **49990** | Compiler | All GVLs | **Default slot for global variable lists** |
| **50000** | Compiler | Default slot | **Default slot for all user POUs** (programs, FBs) |
| 50000 | VisualObject | `Visu__VisualManager__GVL__0` | Visu init |
| 50500 | VisualObject | `__VisuInitInstantiation_GVL` | Visu init |
| 51000 | VisualObject | `Visu__VisualManager__CommonGVL` | Visu init |
| 55000 | VisualObject | `Visu__VisualManager__GVL__2` | Visu init |
| 56000 | VisualObject | `__NativeElementUserDefTypesCall`, `__NativeElementUserDefTypesGVL` | Visu HTML5 control type info |
| 56000 | DataSourcesObject | `__providerSymbolsCall`, `__providerSymbolsGVL`, `__datasourcesSymbolsCall`, `__datasourcesSymbolsGVL` | Data source symbols |
| 56500 | DataSourcesObject | `__GVL_Datasources_Constants` | Data source constants |
| 57000 | DataSourcesObject | `__datasourcesInstancesCall`, `__datasourcesInstancesGVL` | Data source instances |
| 58000 | DataSourcesObject | `__GVL_Datasources` | Data source |
| 60000 | DeviceObject | `IoConfig_Globals` | FB instances of all devices (fieldbus slaves, SoftMotion axes, …) |
| 60000 | TrendRecordingObject | `__GVL__TrendRecording__` + name | Trend recording init |
| 60100 | DeviceObject | `IoConfigRemote_Globals` | Mapped vars for safety SIL3 context |
| 70000 | Library: VisuElemBase | `Private_Visu_Globals_LateInit` | Visu late init |
| 70000 | Library: Visu Utils | `PublicVariables`, `Variables` | Visu late init |
| 123456 | UnitConversionObject | `"__"` + name + `_InitPrg` | Data source interaction |
| 150000 | Library: VisuDialogs | `Dialog_Variables`, `Dialog_Variables_Exp` | Visu dialog init |
| 150000 | RecipeManObject | `GVL_RecipeManagement_3300`, `GVL_RecipeManagement` | Recipe init |
| 151000 | RecipeManObject | `RecipeManagementInitAfterGlobalInit` | Recipe init (uses `call_after_online_change_concurrent_slot 1000`) |
| 200000 | Library: VisuElemBase | `GVL_ShutdownCheck` | Visu shutdown handling |

## Practical recipe for picking a slot

| Need | Slot to pick |
|---|---|
| Initialize **before** any user GVL | < 49990 (e.g. 49000) |
| Initialize **after** all user GVLs, before user FBs | between 49990 and 50000 — basically a slot like 49995 |
| Initialize **before** I/O mapping is read | < 40000 (e.g. 39000) |
| Initialize **after** I/O mapping is set up | > 60000 (e.g. 60500) |
| Initialize **after** visualization is ready | > 70000 |
| Initialize at the very end | > 200000 |

## Notes for tooling

**Diagnostic candidates (Stage 6):**
- `{attribute 'global_init_slot' := <N>}` where N collides with a CODESYS-reserved slot → warning ("slot N is reserved for X")
- Slot value outside reasonable range (negative, very large, non-integer) → error

**Hover augmentation:**
- Hovering on `{attribute 'global_init_slot' := N}` shows what runs at that slot range

**Not enforceable in LSP:**
- Whether the *dependency intent* is met — runtime concern
- Order between two GVLs at the same slot — undefined; can't verify intent

**Stage 6 deep-dives this into `src/reference/init-slots.ts`.**

## Sub-pages

This section has no sub-pages on the CODESYS site.
