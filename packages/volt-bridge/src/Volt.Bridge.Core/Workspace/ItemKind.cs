namespace Volt.Bridge.Core.Workspace;

/// <summary>
/// The single source of truth for item-type codes and their wire kind strings,
/// shared by every bridge. Numeric codes are TwinCAT's native tree-item codes; the
/// CODESYS adapter classifies its object-model objects and maps them onto the SAME
/// codes, so a given kind hashes and serializes identically regardless of vendor.
///
/// Coverage (confirmed live on both unless noted):
///   SHARED (both emit, same code):
///     folder, program, function*, function_block, interface*, enumeration,
///     structure, union, alias, gvl, library_manager, visualization,
///     visualization_manager, recipe_manager, image_pool, text_list
///     + inlined children: action, method, property(+get/set), transition*
///   TWINCAT-ONLY (no CODESYS object-model equivalent):
///     system_root, external_types, tmc_file, library (individual refs),
///     class_diagram, interface_method/property(+get/set)
///   CODESYS-ONLY containers (recursed into, never emitted):
///     application/plc_logic/device, task_config (Task Configuration — its
///     ITaskObject children surface as individual `task` items, like TwinCAT)
///   NOT EMITTED on CODESYS (no TwinCAT equivalent, no editable source → Unknown):
///     trace recordings, symbol config, project/workspace settings.
///   (*) implemented in both adapters but not yet exercised on a live project.
///   Library refs (657): both bridges emit each referenced library flat. CODESYS
///   refs aren't tree objects — the adapter enumerates ILibManObject.GetAllLibraries
///   and surfaces each as a synthetic `library` item with a name+version manifest.
/// </summary>
public static class ItemKind
{
    // ── shared source POU / DUT kinds (full ST text) ────────────────────
    public const int Folder = 601;
    public const int Program = 602;
    public const int Function = 603;
    public const int FunctionBlock = 604;
    public const int Enumeration = 605;
    public const int Structure = 606;
    public const int Union = 607;          // shared code → kind "union" (both bridges)
    public const int Gvl = 615;
    public const int Interface = 618;
    public const int Alias = 623;          // shared code → kind "alias" (both bridges)

    // ── shared "inlined in a POU" children ──────────────────────────────
    public const int Action = 608;
    public const int Method = 609;
    public const int InterfaceMethod = 610;
    public const int Property = 611;
    public const int InterfaceProperty = 612;
    public const int PropertyGet = 613;
    public const int PropertySet = 614;
    public const int Transition = 616;
    public const int TaskCallReference = 650;
    public const int InterfacePropertyGet = 654;
    public const int InterfacePropertySet = 655;

    // ── shared non-source (opaque passthrough) ──────────────────────────
    public const int LibraryManager = 617;
    public const int Visualization = 619;
    public const int VisualizationManager = 620;
    public const int Task = 621;          // CODESYS: drilled out of Task Configuration
    public const int TextList = 625;
    public const int ImagePool = 628;
    public const int RecipeManager = 632;
    public const int RecipesContainer = 633;

    // ── TwinCAT-only kinds (no CODESYS object-model equivalent) ─────────
    public const int SystemRoot = 0;
    public const int ClassDiagram = 631;
    public const int ExternalTypes = 652;
    public const int TmcFile = 653;
    public const int Library = 657;       // individual lib refs (CODESYS: drilled from LibManObject)

    // ── CODESYS-only tree containers (recursed into, never emitted) ─────
    public const int Application = 690;
    public const int PlcLogic = 691;
    public const int Device = 692;
    public const int TaskConfig = 693;     // Task Configuration → its tasks emit as `task`

    // ── sentinels ───────────────────────────────────────────────────────
    public const int Unknown = 0;
    public const int Skip = -1;            // transient/hidden/unrecognized → never emitted

    /// <summary>Code → vendor-neutral kind string (null = not a tracked wire item).</summary>
    public static string? Map(int code, bool isTopLevelCrud) => code switch
    {
        SystemRoot => "system_root",
        Folder => "folder",
        Program => "program",
        Function => "function",
        FunctionBlock => "function_block",
        Enumeration => "enumeration",
        Structure => "structure",
        Union => "union",
        Alias => "alias",
        Action => "action",
        Method => "method",
        InterfaceMethod => "interface_method",
        Property => "property",
        InterfaceProperty => "interface_property",
        PropertyGet => "property_get",
        PropertySet => "property_set",
        Gvl => "gvl",
        Transition => "transition",
        LibraryManager => "library_manager",
        Interface => "interface",
        Visualization => "visualization",
        VisualizationManager => "visualization_manager",
        Task => "task",
        TextList => "text_list",
        ImagePool => "image_pool",
        ClassDiagram => "class_diagram",
        RecipeManager or RecipesContainer => "recipe_manager",
        TaskCallReference => "task_call_reference",
        ExternalTypes => "external_types",
        TmcFile => "tmc_file",
        InterfacePropertyGet => "interface_property_get",
        InterfacePropertySet => "interface_property_set",
        Library => "library",
        Application or PlcLogic or Device or TaskConfig => null, // containers, never emitted
        _ => null,
    };

    /// <summary>Top-level source kinds (full ST text): FB, function, program, DUTs, GVL, interface.</summary>
    public static bool IsTopLevelCrud(int code) =>
        code is Program or Function or FunctionBlock or Enumeration or Structure
             or Union or Alias or Gvl or Interface;

    /// <summary>Items that live INSIDE a parent POU (collected by SourceAssembler, not top-level).</summary>
    public static bool IsInlinedInPou(int code) =>
        code is Action or Method or InterfaceMethod or Property or InterfaceProperty
             or PropertyGet or PropertySet or Transition or TaskCallReference
             or InterfacePropertyGet or InterfacePropertySet;
}
