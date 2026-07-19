namespace Volt.Cli.Core.Workspace;

using System;
using System.Collections.Generic;
using System.Linq;

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
/// docs/ITEM_KINDS.md.
/// </summary>
public static class ItemKind
{
    // ── [both] source POU / DUT kinds (full ST text); each named after its official TREEITEMTYPE ──
    public const int PlcFolder = 601;
    public const int PlcPouProg = 602;
    public const int PlcPouFunc = 603;
    public const int PlcPouFb = 604;
    public const int PlcGvl = 615;
    public const int PlcItf = 618;
    // A DUT is ONE code, ONE wire kind (`dut`), ONE `.dut` extension. The struct/enum/union/alias distinction
    // is NOT a Volt concept at all — it lives solely in the declaration body, and BOTH the IDE's create and
    // its read derive it from that text. TwinCAT reports every DUT as 623 and creates every DUT with 623;
    // CODESYS classifies every IDUTObject here and creates with one create_dut call, re-deriving the subtype
    // from the written declaration. (605/606/607 = the old PLCDUTENUM/STRUCT/UNION codes — never produced,
    // never needed; deleted with the four-way split.)
    public const int PlcDut = 623;

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
    public const int PlcDevice = 695;       // an EMITTED device-tree instance (read-only descriptor). Distinct from
                                            // Device (692) = the recurse-only controller/spine. CODESYS-first; a
                                            // TwinCAT bridge would classify its I/O tree onto the same code.
    public const int PlcProjectInfo = 696;  // the project's "Project Information" metadata (title/author/version/
                                            // company) — read-only descriptor. IProjectInfoObject. CODESYS-first.
    public const int PlcTrace = 697;        // a trace/recording configuration (read-only `.trace`). ITraceObject.
    public const int PlcRecipe = 698;       // a recipe definition — its variable list (read-only `.recipe`).
                                            // IRecipeDefinitionObject, a child of the Recipe Manager.
    public const int PlcSymbolConfig = 699;  // the symbol-configuration flags (read-only `.symbols`). ISymbolConfigObject.
                                            // (695-699 are CODESYS-first read-only descriptors for non-source project objects.)

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
    public const int GenericContainer = 694; // a node with only the base object interfaces (no specific type) that
                                            // GROUPS children — e.g. SoftMotion "Kinematics". Recursed into so
                                            // nested source is never dropped; the node itself is never emitted.
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
        PlcDut => "dut",
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
        PlcDevice => "device",
        PlcProjectInfo => "project_info",
        PlcTrace => "trace",
        PlcRecipe => "recipe",
        PlcSymbolConfig => "symbol_config",
        _ => null,
    };

    /// <summary>Top-level source kinds (full ST text): FB, function, program, DUTs, GVL, interface.</summary>
    public static bool IsTopLevelCrud(int code) =>
        code is PlcPouProg or PlcPouFunc or PlcPouFb or PlcDut or PlcGvl or PlcItf;

    /// <summary>Whether a kind string is a source kind (assembled ST text, not a manifest).</summary>
    public static bool IsSourceKind(string kind) => SourceKinds.Contains(kind);

    /// <summary>A "manager" node that is a PURE CONTAINER — a library / recipe / visualization manager. It only
    /// GROUPS its children (library references, recipes, visualizations) and has no content of its own (a bare
    /// stub manifest), so it is represented by a FOLDER holding those children, NEVER a file. Both drivers treat
    /// it exactly like a plain <see cref="PlcFolder"/>: recurse into it, emit no item for the manager itself.
    /// This is why a library manager materializes as `…/Library Manager/&lt;lib&gt;/&lt;lib&gt;.library` with no
    /// `Library Manager.library_manager` stub beside the folder — a stub that also name-collided with a second
    /// same-named manager elsewhere in the tree.</summary>
    public static bool IsContainerManager(int code) =>
        code is PlcLibMan or PlcVisMan or PlcRecipeMan or PlcRecipes;

    /// <summary>Items that live INSIDE a parent POU (collected by SourceAssembler, not top-level).</summary>
    public static bool IsInlinedInPou(int code) =>
        code is PlcAction or PlcMethod or PlcItfMeth or PlcProp or PlcItfProp
             or PlcPropGet or PlcPropSet or PlcTrans or PlcProgRef
             or PlcItfPropGet or PlcItfPropSet;

    // ── The canonical workspace-file table ─────────────────────────────────────────────────────────────
    // Every kind that materializes as a file, in output order, paired with its extension. This is THE single
    // source of truth for extensions: ExtFor, IsSourceKind, and the CLI's extension registry
    // (Volt.Cli.Sync.Extensions) all derive from it — no second hand-kept list — and
    // volt-scripts/check-wiring.ts cross-checks the TS/JSON copies (LSP, VS Code, opencode-config, control)
    // against it. A POU's body LANGUAGE is never in the extension: an editable FBD/LD body is the same
    // .fb/.prg/.fun as a textual one (graphical detected by the NETWORK marker), a CFC/SFC body is that kind
    // extension too (materialized as an `(* @volt-graphical: LANG *)` comment). Kind is recovered from file
    // content on push, so the extension carries kind alone.

    /// <summary>Writable source kinds (assembled ST text), each with its file extension.</summary>
    public static readonly IReadOnlyList<(string Kind, string Ext)> SourceKindExtensions = new (string, string)[]
    {
        ("function_block", "fb"), ("program", "prg"), ("function", "fun"),
        ("interface", "itf"), ("dut", "dut"), ("gvl", "gvl"),
    };

    /// <summary>Read-only reference kinds (opaque manifests / descriptors), each with its file extension.</summary>
    public static readonly IReadOnlyList<(string Kind, string Ext)> ReferenceKindExtensions = new (string, string)[]
    {
        ("library", "library"), ("device", "device"), ("project_info", "projectinfo"),
        ("trace", "trace"), ("recipe", "recipe"), ("symbol_config", "symbols"), ("task", "task"),
        ("image_pool", "image_pool"), ("parameter_list", "parameter_list"), ("text_list", "text_list"),
        ("recipe_manager", "recipe_manager"), ("visualization_manager", "visualization_manager"),
        ("visualization", "visualization"), ("library_manager", "library_manager"),
        ("class_diagram", "class_diagram"), ("external_types", "external_types"), ("tmc_file", "tmc"),
    };

    private static readonly HashSet<string> SourceKinds =
        new(SourceKindExtensions.Select(x => x.Kind), StringComparer.Ordinal);

    private static readonly Dictionary<string, string> ExtByKind =
        SourceKindExtensions.Concat(ReferenceKindExtensions)
            .ToDictionary(x => x.Kind, x => x.Ext, StringComparer.Ordinal);

    /// <summary>Every workspace file extension paired with whether it is writable source (<c>true</c>) vs a
    /// read-only reference (<c>false</c>) — the CLI's <c>Volt.Cli.Sync.Extensions</c> registry is built from
    /// this, so access and the extension list live in ONE place.</summary>
    public static IEnumerable<(string Ext, bool IsSource)> FileExtensions =>
        SourceKindExtensions.Select(x => (x.Ext, true)).Concat(ReferenceKindExtensions.Select(x => (x.Ext, false)));

    /// <summary>Workspace file extension for a kind string (lowercase); a folder has no extension (""). No
    /// silent fallback — an unmapped kind throws so a new kind is caught, not dropped.</summary>
    public static string ExtFor(string kind) =>
        kind == "folder" ? ""
        : ExtByKind.TryGetValue(kind, out var ext) ? ext
        : throw new ArgumentException(
            $"No extension for kind '{kind}' — add it to ItemKind.SourceKindExtensions/ReferenceKindExtensions");
}
