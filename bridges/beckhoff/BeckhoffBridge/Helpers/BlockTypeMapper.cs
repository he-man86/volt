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
///   601 = Folder                          [verified — POUs/DUTs/GVLs/VISUs/folder1]
///   602 = Program (PRG)                   [verified — PLC_PRG]
///   603 = Function (FC)                   [inherited from old PLCAssist repo]
///   604 = Function Block (FB)             [verified — FB_RateLimiter]
///   605 = Enumeration (DUT)               [inherited]
///   606 = Struct (DUT)                    [inherited]
///   608 = Action                          [verified — action1]
///   609 = Method                          [verified — Reset, Update]
///   610 = Interface Method                [inherited]
///   611 = Property                        [verified — output]
///   612 = Interface Property              [inherited]
///   613 = Property Get                    [inherited]
///   614 = Property Set                    [inherited]
///   615 = Global Variable List (GVL)      [inherited]
///   617 = Library Manager                 [verified by name — "References" → 617]
///   618 = Interface                       [inherited]
///   621 = Task                            [verified by name — "PlcTask" → 621]
///   654 = Interface Property Get          [inherited]
///   655 = Interface Property Set          [inherited]
///   657 = Library                         [verified by name — "Tc2_Standard" → 657]
///
/// Known gaps: 607, 616, 619-620, 622-653, 656, 658+. Likely visualizations,
/// image pools, recipes, task calls, etc. <see cref="ToNodeType"/> warns once
/// per unmapped code so they surface in bridge.log — /debug them when they
/// appear, then add to this map.
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
