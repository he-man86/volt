using System;

namespace BeckhoffBridge.Helpers;

/// <summary>
/// TwinCAT tree-item type codes. Same numeric space serves two uses:
///   - <c>ITcSmTreeItem.CreateChild(name, subType, ...)</c> — writing
///   - <c>ITcSmTreeItem.ItemType</c> property — reading
///
/// (The historical "SubType" suffix on the constants comes from CreateChild's
/// parameter name. They work equally well comparing against ItemType reads.)
///
/// Critical gotcha: read code MUST consult <c>ItemType</c>, NOT
/// <c>ItemSubType</c>. ItemSubType returns 0 for everything inside the
/// NestedProject (POUs / DUTs / GVLs / methods / properties / folders /
/// actions). Reading ItemSubType was the root cause of /readAll silently
/// returning empty for years and of the empty-folder-vs-empty-action
/// misclassification. Use <see cref="BeckhoffConnection.GetItemType"/>.
///
/// Codes (verification status from probing TwinCAT XAE 15.0 via /debug):
///   600 = NestedProject root              [verified — PlcSample_BasicPlcElements Project]
///   601 = Folder                          [verified — POUs/DUTs/GVLs/Drives/SumComparison]
///   602 = Program (PRG)                   [verified — PLC_PRG, MAIN, SumComparison]
///   603 = Function (FC)                   [verified — F_SumComparison_ST/FBD, CheckBounds, CheckDivDInt, CheckPointer]
///   604 = Function Block (FB)             [verified — FB_RateLimiter, FB_Sample, FB_StateMachine]
///   605 = Enumeration (DUT)               [verified — E_StateMachine]
///   606 = Struct (DUT)                    [verified — ST_Sample]
///   608 = Action                          [verified — action1]
///   609 = Method                          [verified — Reset, Update, Execute]
///   610 = Interface Method                [verified — METH on ITF]
///   611 = Property                        [verified — output]
///   612 = Interface Property              [verified — Prop on ITF]
///   613 = Property Get                    [inherited — needs sample (Get accessor on FB property)]
///   614 = Property Set                    [inherited — needs sample (Set accessor on FB property)]
///   615 = Global Variable List (GVL)      [verified — GVL_Basic]
///   617 = Library Manager                 [verified by name — "References" → 617]
///   618 = Interface                       [verified — ITF]
///   619 = Visualization                   [verified — "Visualization"]
///   620 = Visualization Manager           [verified — "Visualization Manager"]
///   621 = Task                            [verified by name — "PlcTask" → 621]
///   625 = GlobalTextList                  [verified — "GlobalTextList"]
///   628 = ImagePool                       [verified — "ImagePool", "ImagePool_1"]
///   631 = Class Diagram (UML)             [verified — "Class Diagram"]
///   632 = RecipeManager                   [verified — "RecipeManager"]
///   633 = Recipes container               [verified — "Recipes" under RecipeManager]
///   650 = Task call reference             [verified — "MAIN" entry under PlcTask]
///   652 = External Types                  [verified — "External Types"]
///   653 = TMC file (TwinCAT Module Class) [verified — "PlcSample_BasicPlcElements.tmc"]
///   654 = Interface Property Get          [verified — Get accessor on Prop of ITF (via shallow probe)]
///   655 = Interface Property Set          [verified — Set accessor on Prop of ITF (via shallow probe)]
///   657 = Library                         [verified by name — "CmpBitmapPool", "RecipeManagement", "Tc2_Standard", "Tc2_System", "Tc3_Module" → 657]
///
/// Remaining PLC-tree gaps (600-range): 607, 616, 622-624, 626-627, 629-630,
/// 634-649, 651, 656, 658+. Likely persistent vars, NWLs, alarm configurations,
/// trace, etc. Probe via /tree as new project content appears.
///
/// System-tree type codes (outside the 600-range — surfaced via /tree
/// endpoint, ITcSysManager.LookupTreeItem paths). volt-agent's CRUD
/// surface stays inside the PLC tree (POU/DUT/GVL/Interface), so these
/// codes are documented for discovery / completeness, not for routing:
///   0   = SYSTEM root container                  [verified — TwinCAT root]
///   1   = Sub-task (child of Tasks)              [verified — PlcTask under Tasks]
///   14  = PLC root                               [verified — TIPC]
///   16  = Tasks container                        [verified — TwinCAT system tasks]
///   17  = I/O Devices container                  [verified — TIID]
///   19  = MOTION / NC                            [verified — TINC and its inner MOTION node]
///   31  = Routes                                 [verified — TIRT]
///   56  = PLC Project (within TIPC)              [verified — PlcSample_BasicPlcElements]
///   57  = PLC Project Instance                   [verified — PlcSample_BasicPlcElements Instance]
///   200 = CAM                                    [verified by name — "CAM"]
///   505 = SAFETY                                 [verified — TISC]
///
/// <see cref="ToNodeType"/> warns once per unmapped code so they surface
/// in bridge.log — /debug them when they appear, then add to this map.
/// Use /tree (no args = walks all system subtrees; { path: "TIID" } = a
/// specific subtree) to enumerate everything reachable from
/// ITcSysManager and watch for codes not yet listed above.
/// </summary>
internal static class BlockTypeMapper
{
	// SubType constants — pass to CreateChild AND compare against ItemType reads.
	public const int FolderSubType = 601;
	public const int ProgramSubType = 602;
	public const int FunctionSubType = 603;
	public const int FunctionBlockSubType = 604;
	public const int EnumSubType = 605;
	public const int StructSubType = 606;
	public const int ActionSubType = 608;
	public const int MethodSubType = 609;
	public const int InterfaceMethodSubType = 610;
	public const int PropertySubType = 611;
	public const int InterfacePropertySubType = 612;
	public const int PropertyGetSubType = 613;
	public const int PropertySetSubType = 614;
	public const int GvlSubType = 615;
	public const int LibraryManagerSubType = 617;
	public const int InterfaceSubType = 618;
	public const int TaskSubType = 621;
	public const int InterfacePropertyGetSubType = 654;
	public const int InterfacePropertySetSubType = 655;
	public const int LibrarySubType = 657;

	// System-tree codes (outside the 600-range, discovered via /tree). Not
	// part of volt-agent's CRUD surface — kept here only so ToNodeType
	// produces friendly names for /tree + /debug responses instead of
	// "unknown". Adding a code here does NOT make it routable through
	// IsTopLevelCrud (which still gates RefsHandler / PushHandler).
	public const int SystemRoot = 0;
	public const int SubTaskSystem = 1;
	public const int PlcRoot = 14;
	public const int TasksContainer = 16;
	public const int DevicesContainer = 17;
	public const int MotionRoot = 19;
	public const int RoutesRoot = 31;
	public const int PlcProjectContainer = 56;
	public const int PlcProjectInstance = 57;
	public const int CamRoot = 200;
	public const int SafetyRoot = 505;

	// In-NestedProject support items (discovered via /tree with the
	// NestedProject root). All filtered out of /refs by IsTopLevelCrud —
	// kept here for friendly /tree / /debug output and so the
	// unmapped-code warning loop doesn't spam bridge.log.
	public const int NestedProjectRoot = 600;
	public const int Visualization = 619;
	public const int VisualizationManager = 620;
	public const int GlobalTextList = 625;
	public const int ImagePool = 628;
	public const int ClassDiagram = 631;
	public const int RecipeManager = 632;
	public const int RecipesContainer = 633;
	public const int TaskCallReference = 650;
	public const int ExternalTypes = 652;
	public const int TmcFile = 653;

	/// <summary>
	/// Convert a CODESYS-style POU type to a TwinCAT CreateChild subType.
	/// </summary>
	public static int PouTypeToSubType(string pouType)
	{
		return pouType.ToLowerInvariant() switch
		{
			"function_block" or "fb" => FunctionBlockSubType,
			"function" or "fc" => FunctionSubType,
			"program" or "prg" => ProgramSubType,
			_ => throw new ArgumentException($"Unknown POU type: {pouType}"),
		};
	}

	/// <summary>
	/// Convert a CODESYS-style DUT type to a TwinCAT CreateChild subType.
	/// </summary>
	public static int DutTypeToSubType(string dutType)
	{
		return dutType.ToLowerInvariant() switch
		{
			"structure" or "struct" or "union" or "alias" => StructSubType,
			"enumeration" or "enum" => EnumSubType,
			_ => throw new ArgumentException($"Unknown DUT type: {dutType}"),
		};
	}

	/// <summary>
	/// Convert a TwinCAT type code (from ItemType or CreateChild subType) to
	/// the unified node type string. Returns "unknown" for unmapped codes —
	/// logs a one-shot warning per unmapped code so they show up in bridge.log
	/// and can be /debug'd into the map. Never throws.
	/// </summary>
	public static string ToNodeType(int typeCode)
	{
		string? mapped = typeCode switch
		{
			FolderSubType => "folder",
			ProgramSubType => "program",
			FunctionSubType => "function",
			FunctionBlockSubType => "function_block",
			EnumSubType => "enumeration",
			StructSubType => "structure",
			ActionSubType => "action",
			MethodSubType or InterfaceMethodSubType => "method",
			PropertySubType or InterfacePropertySubType => "property",
			PropertyGetSubType or InterfacePropertyGetSubType => "getter",
			PropertySetSubType or InterfacePropertySetSubType => "setter",
			GvlSubType => "gvl",
			LibraryManagerSubType => "library_manager",
			InterfaceSubType => "interface",
			TaskSubType => "task",
			LibrarySubType => "library",
			// System-tree codes — discovered via /tree, not in volt-agent's
			// CRUD scope but named for inspection / log clarity.
			SystemRoot => "system_root",
			SubTaskSystem => "system_subtask",
			PlcRoot => "plc_root",
			TasksContainer => "tasks_container",
			DevicesContainer => "devices_container",
			MotionRoot => "motion_root",
			RoutesRoot => "routes_root",
			PlcProjectContainer => "plc_project_container",
			PlcProjectInstance => "plc_project_instance",
			CamRoot => "cam_root",
			SafetyRoot => "safety_root",
			// In-NestedProject support items (discovered via /tree).
			NestedProjectRoot => "nested_project_root",
			Visualization => "visualization",
			VisualizationManager => "visualization_manager",
			GlobalTextList => "global_text_list",
			ImagePool => "image_pool",
			ClassDiagram => "class_diagram",
			RecipeManager => "recipe_manager",
			RecipesContainer => "recipes_container",
			TaskCallReference => "task_call_reference",
			ExternalTypes => "external_types",
			TmcFile => "tmc_file",
			_ => null,
		};
		if (mapped != null) return mapped;
		WarnUnknownCode(typeCode);
		return "unknown";
	}

	/// <summary>
	/// Convert a TwinCAT subType to a CODESYS-style POU type string.
	/// </summary>
	public static string SubTypeToPouType(int subType)
	{
		return subType switch
		{
			ProgramSubType => "program",
			FunctionSubType => "function",
			FunctionBlockSubType => "function_block",
			_ => throw new ArgumentException($"Unknown POU subType: {subType}"),
		};
	}

	/// <summary>
	/// True when the type code identifies a top-level CRUD-addressable object
	/// (POU / GVL / DUT / Interface). Methods, actions, properties live
	/// inside their parent POU and ride inline via BuildResult.children.
	/// </summary>
	public static bool IsTopLevelCrud(int typeCode)
	{
		return typeCode is FunctionBlockSubType or FunctionSubType or ProgramSubType
			or GvlSubType or StructSubType or EnumSubType or InterfaceSubType;
	}

	private static readonly System.Collections.Concurrent.ConcurrentDictionary<int, byte> _warnedCodes = new();

	private static void WarnUnknownCode(int code)
	{
		if (_warnedCodes.TryAdd(code, 0))
			Log.Warn($"[BlockTypeMapper] Unmapped ItemType: {code}. Add to BlockTypeMapper after probing via /debug.");
	}
}
