/**
 * CODESYS global initialization slots.
 * Source: `docs/codesys-reference/12-global-init-slots.md`.
 *
 * Vendor-specific: this slot table is CODESYS-only. TwinCAT has its
 * own reserved-slot ranges that differ (Beckhoff InfoSys documents
 * them in the call_after_global_init_slot page). When `vendor=twincat`
 * the init-slot-collision diagnostic should consult the TwinCAT
 * reservation table instead — not yet captured here, but the structure
 * is ready for `RESERVED_INIT_SLOTS_TWINCAT` to live next to this one.
 *
 * Reserved slot ranges that CODESYS subsystems use. The `init-slot-
 * collision` diagnostic consults this table when a user POU/GVL declares
 * `{attribute 'global_init_slot' := '<N>'}` to flag collisions.
 *
 * Defaults:
 *   - GVL default slot: 49990
 *   - POU default slot: 50000
 *
 * Encoded as a flat list — small enough that we don't bother with
 * range indexing.
 */

export interface InitSlot {
	slot: number;
	owner: string;
	pou: string;
	purpose: string;
	/**
	 * True for the slots CODESYS *expects* user code to live in (the
	 * GVL default 49990 and the POU default 50000). Picking these
	 * isn't a collision — it's the documented intent. The diagnostic
	 * filters defaults out before warning, so picking 50000 explicitly
	 * is a no-op equivalent to omitting the pragma.
	 */
	isUserDefault?: boolean;
}

export const RESERVED_INIT_SLOTS: ReadonlyArray<InitSlot> = [
	{ slot: 123, owner: "GVLObject", pou: "__var_persistent_write", purpose: "Copy persistent vars from persistent list to mapped instance paths" },
	{ slot: 199, owner: "Compiler", pou: "__var__retain__read__", purpose: "Copy retain vars from retain area" },
	{ slot: 200, owner: "LanguageModelManager", pou: "__ValidateLicenseMetrics", purpose: "Send AppBasedLicenseMetrics to runtime" },
	{ slot: 500, owner: "VisualObject", pou: "Visu__VisualManager__AfterInitProgram", purpose: "Visu init" },
	{ slot: 500, owner: "VisualObject", pou: "__datasourcesFrame", purpose: "Visu↔data-source interaction" },
	{ slot: 600, owner: "DataSourcesObject", pou: "__datasourcesUpdateByDefaultCall / GVL", purpose: "Data source init" },
	{ slot: 1000, owner: "DeviceObject", pou: "IoGlobalInit__Pou", purpose: "Device object instances" },
	{ slot: 1000, owner: "Library: Datasource*", pou: "AccessLogger / Logger", purpose: "Library logging init" },
	{ slot: 1234, owner: "ApplicationComposer", pou: "AC_Init / AC_OnlineChange", purpose: "Generated POU init / online-change reinit" },
	{ slot: 10000, owner: "Library: Datasource Symbolic Access", pou: "GVL_EarlyInit", purpose: "Symbolic data-source early init" },
	{ slot: 20000, owner: "Library: Alarm Manager", pou: "AlarmConstants", purpose: "Alarm handling init" },
	{ slot: 24000, owner: "Library: VisuElemBase / Visu Interfaces", pou: "Private_Visu_Globals / GVL_NativeElement / GVL_TypeInformation / GVL", purpose: "Visu init" },
	{ slot: 25000, owner: "Library: VisuElemBase / VisuCommandInterface / RecipeManagement", pou: "GVL_CommandManager / Visu_Globals / GVL / GVL_RecipeManagement_Temp", purpose: "Visu init" },
	{ slot: 25990, owner: "Library: VisuElemBase", pou: "VisuFctDatasourcesResourceEntryAllocator{_MBM,_SysMem}", purpose: "Visu resource init" },
	{ slot: 26000, owner: "Library: VisuElemBase", pou: "Visu_Resources", purpose: "Visu init" },
	{ slot: 30000, owner: "Library: Alarm Manager / VisuFPlot / VisuTrendStorageAccess", pou: "AlarmGlobals / GloballyForAlarmStorage / GlobalInstances", purpose: "Alarm + visu init" },
	{ slot: 39900, owner: "DeviceObject", pou: "IoConfig_Globals_ModuleList", purpose: "Module list for all device connectors" },
	{ slot: 40000, owner: "DeviceObject / TrendRecordingObject", pou: "IoConfig_Globals_Mapping / __GVL__TrendRecordingManager", purpose: "Mapped vars + trend recording" },
	{ slot: 40100, owner: "DeviceObject", pou: "IoConfig_Forces_Reset", purpose: "Force vars for I/O mapping" },
	{ slot: 49980, owner: "Compiler", pou: "All VAR_STAT", purpose: "Initialize VAR_STAT variables" },
	{ slot: 49985, owner: "Compiler", pou: "__MemManDefinition", purpose: "Dynamic memory management (must precede normal GVLs)" },
	{ slot: 49990, owner: "Compiler", pou: "All GVLs", purpose: "DEFAULT slot for global variable lists", isUserDefault: true },
	{ slot: 50000, owner: "Compiler", pou: "Default slot", purpose: "DEFAULT slot for user POUs (programs, FBs)", isUserDefault: true },
	{ slot: 50000, owner: "VisualObject", pou: "Visu__VisualManager__GVL__0", purpose: "Visu init" },
	{ slot: 50500, owner: "VisualObject", pou: "__VisuInitInstantiation_GVL", purpose: "Visu init" },
	{ slot: 51000, owner: "VisualObject", pou: "Visu__VisualManager__CommonGVL", purpose: "Visu init" },
	{ slot: 55000, owner: "VisualObject", pou: "Visu__VisualManager__GVL__2", purpose: "Visu init" },
	{ slot: 56000, owner: "VisualObject / DataSourcesObject", pou: "__NativeElementUserDefTypes* / __providerSymbols* / __datasourcesSymbols*", purpose: "Visu HTML5 + data source symbols" },
	{ slot: 56500, owner: "DataSourcesObject", pou: "__GVL_Datasources_Constants", purpose: "Data source constants" },
	{ slot: 57000, owner: "DataSourcesObject", pou: "__datasourcesInstances*", purpose: "Data source instances" },
	{ slot: 58000, owner: "DataSourcesObject", pou: "__GVL_Datasources", purpose: "Data source GVL" },
	{ slot: 60000, owner: "DeviceObject / TrendRecordingObject", pou: "IoConfig_Globals / __GVL__TrendRecording__*", purpose: "Device FB instances + trend recording" },
	{ slot: 60100, owner: "DeviceObject", pou: "IoConfigRemote_Globals", purpose: "Safety SIL3 context mapped vars" },
	{ slot: 70000, owner: "Library: VisuElemBase / Visu Utils", pou: "Private_Visu_Globals_LateInit / PublicVariables / Variables", purpose: "Visu late init" },
	{ slot: 123456, owner: "UnitConversionObject", pou: '"__" + name + "_InitPrg"', purpose: "Data-source interaction" },
	{ slot: 150000, owner: "Library: VisuDialogs / RecipeManObject", pou: "Dialog_Variables{,_Exp} / GVL_RecipeManagement{,_3300}", purpose: "Visu dialogs + recipes" },
	{ slot: 151000, owner: "RecipeManObject", pou: "RecipeManagementInitAfterGlobalInit", purpose: "Recipes (uses call_after_online_change_concurrent_slot 1000)" },
	{ slot: 200000, owner: "Library: VisuElemBase", pou: "GVL_ShutdownCheck", purpose: "Visu shutdown handling" },
];

export const GVL_DEFAULT_SLOT = 49990;
export const POU_DEFAULT_SLOT = 50000;

/**
 * Look up *vendor-reserved* slots overlapping with a user-provided slot
 * value. Returns an empty array when the slot is a user-default (49990
 * or 50000): picking a default isn't a collision, it's the documented
 * intent, even when vendor subsystems also happen to live in the same
 * slot. Suppressing the warning entirely there avoids flagging every
 * project that explicitly sets the default — which would be noisy and
 * actionless (you'd get the same vendor co-occupation by omitting the
 * pragma altogether).
 */
export function getReservationsAtSlot(slot: number): readonly InitSlot[] {
	const all = RESERVED_INIT_SLOTS.filter((s) => s.slot === slot);
	if (all.some((s) => s.isUserDefault === true)) return [];
	return all;
}

export const INIT_SLOTS_SOURCE = {
	url: "https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_global_init_slots.html",
	localFile: "docs/codesys-reference/12-global-init-slots.md",
	retrievedAt: "2026-05-26",
};
