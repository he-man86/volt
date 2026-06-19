namespace Volt.Bridge.Core.Workspace;

using System;

/// <summary>
/// Single source of truth for item-type codes, their wire kind strings, and workspace file extensions —
/// shared by every bridge. Codes and constant names ARE TwinCAT's native <c>TREEITEMTYPE</c> enum (PLC range):
/// TwinCAT is the canonical basis, so each constant is the PascalCase of its official name (610 =
/// <c>PlcItfMeth</c> = <c>PLCITFMETH</c>). CODESYS has no numeric enum — it classifies its object model onto
/// these SAME codes (<c>CodesysTypeMap</c>), so both bridges emit identical wire kinds and a kind hashes
/// identically regardless of vendor.
///
/// Sections mark the vendor reuse split: <b>[both]</b> = TwinCAT-native AND produced by the CODESYS
/// classifier (the vast majority); <b>[TC-only]</b> = a TwinCAT code with no CODESYS equivalent; <b>[CDS-only]</b>
/// = CODESYS object-model containers with no TwinCAT code (recursed, never emitted).
///
/// Numbers are the LIVE build's, not the published doc: Beckhoff renumbered 622/624/625 into the 650s, and
/// 628/629/631/632/633/657 are observed live with no published name. Full coverage map + per-kind live status:
/// ITEM_KINDS.md.
/// </summary>
public static class ItemKind
{
    // ── [both] source POU / DUT kinds (full ST text); each named after its official TREEITEMTYPE ──
    public const int PlcFolder = 601;
    public const int PlcPouProg = 602;
    public const int PlcPouFunc = 603;
    public const int PlcPouFb = 604;
    public const int PlcDutEnum = 605;
    public const int PlcDutStruct = 606;
    public const int PlcDutUnion = 607;
    public const int PlcGvl = 615;
    public const int PlcItf = 618;
    public const int PlcDutAlias = 623;     // TwinCAT reports EVERY DUT as 623; struct/enum/union refined from the decl

    // ── [both] children inlined in a POU / interface ──
    public const int PlcAction = 608;
    public const int PlcMethod = 609;
    public const int PlcItfMeth = 610;
    public const int PlcProp = 611;
    public const int PlcItfProp = 612;
    public const int PlcPropGet = 613;      // CODESYS maps its interface accessors here too, so 654/655 are TC-only
    public const int PlcPropSet = 614;
    public const int PlcTrans = 616;
    public const int PlcProgRef = 650;      // published 622; Beckhoff renumbered to 650

    // ── [both] non-source (opaque passthrough) ──
    public const int PlcLibMan = 617;
    public const int PlcVisObj = 619;
    public const int PlcVisMan = 620;
    public const int PlcTask = 621;         // CODESYS: drilled out of the Task Configuration container
    public const int PlcTextList = 625;     // published 625 was TMCDESCRIPTION; current builds reuse 625 for text lists (tmc → 653)
    public const int PlcImagePool = 628;    // observed live; no published TREEITEMTYPE name
    public const int PlcRecipeMan = 632;    // observed live; no published name
    public const int PlcRecipes = 633;      // recipes container under the recipe manager (same wire kind as 632)
    public const int PlcLibRef = 657;       // individual library reference; CODESYS synthesizes these from ILibManObject

    // ── [TC-only] TwinCAT TREEITEMTYPEs with no CODESYS equivalent ──
    public const int PlcParamList = 629;    // ADS parameter list — CODESYS has no parameter-list object type (docs + Hauzer)
    public const int PlcClassDiagram = 631; // observed live; no published name
    public const int PlcExtDataTypeCont = 652; // published 624; renumbered to 652
    public const int PlcTmcDescription = 653;  // published 625; renumbered to 653 (the .tmc module description)
    public const int PlcItfPropGet = 654;   // CODESYS classifies interface accessors as PlcPropGet/Set instead
    public const int PlcItfPropSet = 655;

    // ── containers & sentinels — recursed or skipped, NEVER emitted (Map → null) ──
    public const int PlcSystemRoot = 0;     // TwinCAT solution/system root; the walk starts BELOW it (at the 600 PLC
                                            // project), so it is never reached. Kept so a read-failure can use -2
                                            // (Unknown) without colliding with this real code 0.
    public const int Application = 690;     // CODESYS object-model containers (synthetic numbers — CODESYS has no numeric
    public const int PlcLogic = 691;        // enum). Recursed into; their source children surface flat.
    public const int Device = 692;
    public const int TaskConfig = 693;      // its ITaskObject children surface as individual `task` items
    public const int Unknown = -2;          // classification failed / unrecognized
    public const int Skip = -1;             // transient / hidden

    /// <summary>Code → vendor-neutral wire kind string. null = not emitted as a tracked item: the containers
    /// &amp; sentinels (0, 690-693, -1, -2) and any code we don't classify all fall through to the default.</summary>
    public static string? Map(int code) => code switch
    {
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
