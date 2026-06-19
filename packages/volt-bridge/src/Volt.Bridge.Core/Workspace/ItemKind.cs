namespace Volt.Bridge.Core.Workspace;

using System;

/// <summary>
/// The single source of truth for item-type codes, their wire kind strings, AND their workspace file
/// extensions — shared by every bridge. The numeric codes and constant names ARE TwinCAT's native
/// <c>TREEITEMTYPE</c> enum (PLC range, see ITEM_KINDS.md): TwinCAT is the canonical basis, so a constant is
/// named after its official <c>TREEITEMTYPE</c> (e.g. 610 = <c>PlcItfMeth</c> = <c>PLCITFMETH</c>). The CODESYS
/// adapter has no numeric enum — it classifies its object-model objects onto these SAME codes
/// (<c>CodesysTypeMap</c>), so both adapters emit identical wire kind strings and a kind hashes/serializes
/// identically regardless of vendor.
///
/// Reuse split (markers on each constant below):
///   [both]    TwinCAT-native AND produced by the CODESYS classifier — the vast majority.
///   [TC-only] a TwinCAT TREEITEMTYPE with no CODESYS classifier arm (system root, external types, tmc
///             description, class diagram, and the 654/655 interface-property accessors — CODESYS maps its
///             interface accessors onto the plain 613/614 instead).
///   [CDS-only] CODESYS object-model containers (690-693) with no TwinCAT TREEITEMTYPE — recursed, never emitted.
///   ✓live = confirmed via the read-only /debug sweep or e2e tests; ?? = mapped but not yet seen on a live project.
///
/// NOTE: Beckhoff RENUMBERED 622/624/625 (PLCPROGREF/EXTDATATYPECONT/TMCDESCRIPTION) up into the 650s in current
/// builds — the live IDE is authoritative, not the older published enum. Numbers here are the live values.
/// </summary>
public static class ItemKind
{
    // ── [both] source POU / DUT kinds (full ST text) ────────────────────
    public const int PlcFolder = 601;       // PLCFOLDER     ✓live
    public const int PlcPouProg = 602;      // PLCPOUPROG    ✓live
    public const int PlcPouFunc = 603;      // PLCPOUFUNC    ✓live
    public const int PlcPouFb = 604;        // PLCPOUFB      ✓live
    public const int PlcDutEnum = 605;      // PLCDUTENUM    ✓live
    public const int PlcDutStruct = 606;    // PLCDUTSTRUCT  ✓live
    public const int PlcDutUnion = 607;     // PLCDUTUNION   ✓live
    public const int PlcGvl = 615;          // PLCGVL        ✓live
    public const int PlcItf = 618;          // PLCITF        ✓live
    public const int PlcDutAlias = 623;     // PLCDUTALIAS   ✓live

    // ── [both] "inlined in a POU" children ──────────────────────────────
    public const int PlcAction = 608;       // PLCACTION     ✓live
    public const int PlcMethod = 609;       // PLCMETHOD     ✓live
    public const int PlcItfMeth = 610;      // PLCITFMETH    ✓live
    public const int PlcProp = 611;         // PLCPROP       ✓live
    public const int PlcItfProp = 612;      // PLCITFPROP    ✓live
    public const int PlcPropGet = 613;      // PLCPROPGET    ✓live (CODESYS also maps its iface accessors here)
    public const int PlcPropSet = 614;      // PLCPROPSET    ✓live
    public const int PlcTrans = 616;        // PLCTRANS      ✓live (transition under POU_1)
    public const int PlcProgRef = 650;      // PLCPROGREF (published 622; live → 650)  ✓live

    // ── [both] non-source (opaque passthrough) ──────────────────────────
    public const int PlcLibMan = 617;       // PLCLIBMAN     ✓live
    public const int PlcVisObj = 619;       // PLCVISOBJ     ✓live
    public const int PlcVisMan = 620;       // PLCVISMAN     ✓live
    public const int PlcTask = 621;         // PLCTASK       ✓live (CODESYS: drilled out of Task Configuration)
    public const int PlcTextList = 625;     // ✓live text_list on current builds (was PLCTMCDESCRIPTION in the old enum; tmc → 653)
    public const int PlcImagePool = 628;    // ✓live (RE'd name)
    public const int PlcRecipeMan = 632;    // ✓live (RE'd name)
    public const int PlcRecipes = 633;      // ✓live recipes container under the recipe manager (RE'd name)
    public const int PlcLibRef = 657;       // ✓live; individual lib ref (CODESYS: synthetic from LibManObject)

    // ── [TC-only] TwinCAT TREEITEMTYPEs the CODESYS classifier never produces ─────
    public const int PlcSystemRoot = 0;     // system/solution root sentinel (the PLC project root surfaces as 600 PLCAPP)
    public const int PlcClassDiagram = 631; // ✓live (RE'd name)
    public const int PlcParamList = 629;    // ✓live TwinCAT PLC parameter list (ADS); NO CODESYS object-model equivalent — confirmed via CODESYS docs + Hauzer sweep, so TC-only (not a parity gap)
    public const int PlcExtDataTypeCont = 652; // PLCEXTDATATYPECONT (published 624; live → 652)  ✓live
    public const int PlcTmcDescription = 653;  // PLCTMCDESCRIPTION (published 625; live → 653)   ✓live
    public const int PlcItfPropGet = 654;   // PLCITFPROPGET  ✓live (CODESYS iface accessors use PlcPropGet)
    public const int PlcItfPropSet = 655;   // PLCITFPROPSET  ✓live

    // ── [CDS-only] CODESYS object-model containers (no TwinCAT TREEITEMTYPE; recursed, never emitted) ─────
    public const int Application = 690;
    public const int PlcLogic = 691;
    public const int Device = 692;
    public const int TaskConfig = 693;     // Task Configuration → its tasks emit as `task`

    // ── sentinels ───────────────────────────────────────────────────────
    // Distinct from PlcSystemRoot (0, a real TwinCAT code): a node we couldn't classify must NOT collapse
    // onto system_root and get phantom-emitted — it maps to null (skip). See Map()'s default arm.
    public const int Unknown = -2;
    public const int Skip = -1;            // transient/hidden/unrecognized → never emitted

    /// <summary>Code → vendor-neutral kind string (null = not a tracked wire item).</summary>
    public static string? Map(int code) => code switch
    {
        PlcSystemRoot => "system_root",
        PlcFolder => "folder",
        PlcPouProg => "program",
        PlcPouFunc => "function",
        PlcPouFb => "function_block",
        PlcDutEnum => "enumeration",
        PlcDutStruct => "structure",
        PlcDutUnion => "union",
        PlcDutAlias => "alias",
        PlcAction => "action",
        PlcMethod => "method",
        PlcItfMeth => "interface_method",
        PlcProp => "property",
        PlcItfProp => "interface_property",
        PlcPropGet => "property_get",
        PlcPropSet => "property_set",
        PlcGvl => "gvl",
        PlcTrans => "transition",
        PlcLibMan => "library_manager",
        PlcItf => "interface",
        PlcVisObj => "visualization",
        PlcVisMan => "visualization_manager",
        PlcTask => "task",
        PlcTextList => "text_list",
        PlcImagePool => "image_pool",
        PlcParamList => "parameter_list",
        PlcClassDiagram => "class_diagram",
        PlcRecipeMan or PlcRecipes => "recipe_manager",
        PlcProgRef => "task_call_reference",
        PlcExtDataTypeCont => "external_types",
        PlcTmcDescription => "tmc_file",
        PlcItfPropGet => "interface_property_get",
        PlcItfPropSet => "interface_property_set",
        PlcLibRef => "library",
        Application or PlcLogic or Device or TaskConfig => null, // containers, never emitted
        _ => null,
    };

    /// <summary>Top-level source kinds (full ST text): FB, function, program, DUTs, GVL, interface.</summary>
    public static bool IsTopLevelCrud(int code) =>
        code is PlcPouProg or PlcPouFunc or PlcPouFb or PlcDutEnum or PlcDutStruct
             or PlcDutUnion or PlcDutAlias or PlcGvl or PlcItf;

    /// <summary>Whether a kind string is a source kind (assembled ST text, not a manifest).</summary>
    public static bool IsSourceKind(string kind) =>
        kind is "function_block" or "function" or "program" or "interface" or "gvl"
             or "structure" or "enumeration" or "union" or "alias";

    /// <summary>Items that live INSIDE a parent POU (collected by SourceAssembler, not top-level).</summary>
    public static bool IsInlinedInPou(int code) =>
        code is PlcAction or PlcMethod or PlcItfMeth or PlcProp or PlcItfProp
             or PlcPropGet or PlcPropSet or PlcTrans or PlcProgRef
             or PlcItfPropGet or PlcItfPropSet;

    /// <summary>Workspace file extension for a kind string (lowercase). Every file-producing kind
    /// in item-kinds.json must have an entry — no silent fallback. POU extensions come from the
    /// body language (ST→st, FBD→fbd, LD→ld, …), not from the kind, so this mapping skips POUs.</summary>
    public static string ExtFor(string kind) => kind switch
    {
        "interface" => "itf",
        "structure" => "struct",
        "enumeration" => "enum",
        "tmc_file" => "tmc",
        "gvl" => "gvl",
        "union" => "union",
        "alias" => "alias",
        "library" => "library",
        "task" => "task",
        "image_pool" => "image_pool",
        "parameter_list" => "parameter_list",
        "text_list" => "text_list",
        "recipe_manager" => "recipe_manager",
        "visualization_manager" => "visualization_manager",
        "visualization" => "visualization",
        "library_manager" => "library_manager",
        "class_diagram" => "class_diagram",
        "external_types" => "external_types",
        "folder" => "",
        _ => throw new ArgumentException($"No extension for kind '{kind}' — add it to ItemKind.ExtFor"),
    };
}
