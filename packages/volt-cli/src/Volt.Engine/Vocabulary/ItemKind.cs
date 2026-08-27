namespace Volt.Engine.Vocabulary;

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
    // A DUT is ONE wire kind (`dut`), ONE `.dut` extension. The struct/enum/union/alias distinction is NOT a Volt
    // concept at all — it lives solely in the declaration body, and BOTH the IDE's create and its read derive it
    // from that text. CODESYS classifies every IDUTObject as PlcDut and creates with one create_dut call.
    //
    // But it is FOUR tree codes on TwinCAT, not one, and that correction cost real data. This used to say
    // "605/606/607 = the old PLCDUTENUM/STRUCT/UNION codes — NEVER PRODUCED, never needed", and every walk that
    // met one logged "unmapped TREEITEMTYPE … dropped by Core as unmapped-kind" and moved on. Measured live, two
    // independent ways: a hand-authored enum in the committed `TwinCAT Project14` fixture (`E_PackML_Mode`) has
    // ALWAYS reported 605, and a DUT re-created from TwinCAT's own item archive comes back 606 (struct) or 607
    // (union) rather than the 623 it was created with. So a DUT authored in the TwinCAT IDE — the ordinary case —
    // was INVISIBLE to `refs` and `fetch`, and absent means DELETED to a pull.
    //
    // 623 is the generic code `CreateChild` accepts; 605/606/607 are the subtypes TwinCAT stores. All four are the
    // one wire kind, so the "one code" the design cares about is the WIRE one, and it is still one.
    public const int PlcDut = 623;
    public const int PlcDutEnum = 605;
    public const int PlcDutStruct = 606;
    public const int PlcDutUnion = 607;

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

    /// <summary>The vendor-neutral wire kind STRINGS, defined once. <see cref="Map"/>, the extension tables, and
    /// every consumer that compares a kind reference these — so a kind name is spelled in exactly ONE place. The
    /// VALUES are a cross-language wire contract (LSP / VS Code / control consume them, guarded by
    /// <c>scripts/check-wiring.ts</c>): name them freely, change them never.</summary>
    public static class Kinds
    {
        public const string Folder = "folder";
        public const string Program = "program";
        public const string Function = "function";
        public const string FunctionBlock = "function_block";
        public const string Dut = "dut";
        public const string Action = "action";
        public const string Method = "method";
        public const string InterfaceMethod = "interface_method";
        public const string Property = "property";
        public const string InterfaceProperty = "interface_property";
        public const string PropertyGet = "property_get";
        public const string PropertySet = "property_set";
        public const string Gvl = "gvl";
        public const string Transition = "transition";
        public const string LibraryManager = "library_manager";
        public const string Interface = "interface";
        public const string Visualization = "visualization";
        public const string VisualizationManager = "visualization_manager";
        public const string Task = "task";
        public const string TextList = "text_list";
        public const string ImagePool = "image_pool";
        public const string ParameterList = "parameter_list";
        public const string ClassDiagram = "class_diagram";
        public const string RecipeManager = "recipe_manager";
        public const string TaskCallReference = "task_call_reference";
        public const string ExternalTypes = "external_types";
        public const string TmcFile = "tmc_file";
        public const string InterfacePropertyGet = "interface_property_get";
        public const string InterfacePropertySet = "interface_property_set";
        public const string Library = "library";
        public const string Device = "device";
        public const string ProjectInfo = "project_info";
        public const string Trace = "trace";
        public const string Recipe = "recipe";
        public const string SymbolConfig = "symbol_config";
    }

    /// <summary>Code → vendor-neutral wire kind string. null = not emitted as a tracked item: the containers
    /// &amp; sentinels (0, 690-693, -1, -2) and any code we don't classify all fall through to the default.</summary>
    public static string? Map(int code) => code switch
    {
        PlcFolder => Kinds.Folder,
        PlcPouProg => Kinds.Program,
        PlcPouFunc => Kinds.Function,
        PlcPouFb => Kinds.FunctionBlock,
        PlcDut or PlcDutEnum or PlcDutStruct or PlcDutUnion => Kinds.Dut,
        PlcAction => Kinds.Action,
        PlcMethod => Kinds.Method,
        PlcItfMeth => Kinds.InterfaceMethod,
        PlcProp => Kinds.Property,
        PlcItfProp => Kinds.InterfaceProperty,
        PlcPropGet => Kinds.PropertyGet,
        PlcPropSet => Kinds.PropertySet,
        PlcGvl => Kinds.Gvl,
        PlcTrans => Kinds.Transition,
        PlcLibMan => Kinds.LibraryManager,
        PlcItf => Kinds.Interface,
        PlcVisObj => Kinds.Visualization,
        PlcVisMan => Kinds.VisualizationManager,
        PlcTask => Kinds.Task,
        PlcTextList => Kinds.TextList,
        PlcImagePool => Kinds.ImagePool,
        PlcParamList => Kinds.ParameterList,
        PlcClassDiagram => Kinds.ClassDiagram,
        PlcRecipeMan or PlcRecipes => Kinds.RecipeManager,
        PlcProgRef => Kinds.TaskCallReference,
        PlcExtDataTypeCont => Kinds.ExternalTypes,
        PlcTmcDescription => Kinds.TmcFile,
        PlcItfPropGet => Kinds.InterfacePropertyGet,
        PlcItfPropSet => Kinds.InterfacePropertySet,
        PlcLibRef => Kinds.Library,
        PlcDevice => Kinds.Device,
        PlcProjectInfo => Kinds.ProjectInfo,
        PlcTrace => Kinds.Trace,
        PlcRecipe => Kinds.Recipe,
        PlcSymbolConfig => Kinds.SymbolConfig,
        _ => null,
    };

    /// <summary>Top-level source kinds (full ST text): FB, function, program, DUTs, GVL, interface.</summary>
    public static bool IsTopLevelCrud(int code) =>
        code is PlcPouProg or PlcPouFunc or PlcPouFb or PlcGvl or PlcItf
              or PlcDut or PlcDutEnum or PlcDutStruct or PlcDutUnion;

    /// <summary>Whether a kind string is a source kind (assembled ST text, not a manifest).</summary>
    public static bool IsSourceKind(string kind) => SourceKinds.Contains(kind);

    /// <summary>Does this kind NEED a PLCopen document to be represented at all? A POU or an interface does —
    /// only a document can carry a body and children. A DUT or a GVL is DECLARATION-ONLY: its whole content is
    /// the declaration text.
    /// <para>It is NOT the write rule, and reading it as one cost a capability member: declaration-only kinds
    /// travel as a document too, on BOTH vendors (<c>DeclarationOnlyDocumentTests</c> pins all four root shapes).
    /// This says only that a POU cannot be represented any OTHER way. Its one consumer is the READ split in
    /// <c>Sync/Materializer</c>, which routes DUT/GVL through the declaration aspect — a COST decision (~1 ms
    /// against ~20 ms per item on the walk every <c>volt status</c> pays), not a capability one.</para></summary>
    public static bool TravelsAsDocument(string kind) =>
        kind is Kinds.Program or Kinds.FunctionBlock or Kinds.Function or Kinds.Interface;

    /// <summary>The canonical manifest body for a non-source item whose vendor exposes NO metadata for its kind:
    /// a kind-stamped line — never null, never empty, so the version basis stays stable. BOTH drivers call this
    /// (see <c>ICodeStore.ReadManifest</c>): the value is wire-observable twice over (<c>Materializer</c> writes it
    /// verbatim into the workspace, <c>Hasher</c> takes the content version from it), so it is PARITY-CRITICAL and
    /// must not be able to diverge per vendor — which a literal hand-written in each driver could.</summary>
    public static string EmptyManifest(string kind) => $"{kind}\n";

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
    // scripts/check-wiring.ts cross-checks the TS/JSON copies (LSP, VS Code, control)
    // against it. A POU's body LANGUAGE is never in the extension: an editable FBD/LD body is the same
    // .fb/.prg/.fun as a textual one (graphical detected by the NETWORK marker), a CFC/SFC body is that kind
    // extension too (materialized as an `(* @volt-graphical: LANG *)` comment). Kind is recovered from file
    // content on push, so the extension carries kind alone.

    /// <summary>Writable source kinds (assembled ST text), each with its file extension.</summary>
    public static readonly IReadOnlyList<(string Kind, string Ext)> SourceKindExtensions = new (string, string)[]
    {
        (Kinds.FunctionBlock, "fb"), (Kinds.Program, "prg"), (Kinds.Function, "fun"),
        (Kinds.Interface, "itf"), (Kinds.Dut, "dut"), (Kinds.Gvl, "gvl"),
    };

    /// <summary>Read-only reference kinds (opaque manifests / descriptors), each with its file extension.</summary>
    public static readonly IReadOnlyList<(string Kind, string Ext)> ReferenceKindExtensions = new (string, string)[]
    {
        (Kinds.Library, "library"), (Kinds.Device, "device"), (Kinds.ProjectInfo, "projectinfo"),
        (Kinds.Trace, "trace"), (Kinds.Recipe, "recipe"), (Kinds.SymbolConfig, "symbols"), (Kinds.Task, "task"),
        (Kinds.ImagePool, "image_pool"), (Kinds.ParameterList, "parameter_list"), (Kinds.TextList, "text_list"),
        (Kinds.RecipeManager, "recipe_manager"), (Kinds.VisualizationManager, "visualization_manager"),
        (Kinds.Visualization, "visualization"), (Kinds.LibraryManager, "library_manager"),
        (Kinds.ClassDiagram, "class_diagram"), (Kinds.ExternalTypes, "external_types"), (Kinds.TmcFile, "tmc"),
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

    /// <summary>Workspace file extension for a kind string (lowercase). No silent fallback — an unmapped kind
    /// throws so a new kind is caught, not dropped. That includes <see cref="Kinds.Folder"/>: a folder is a PATH
    /// SEGMENT, never a file, and both driver walks recurse it without emitting an item — the old <c>folder → ""</c>
    /// arm was left from the era when folders WERE emitted, and produced a bare-trailing-dot name ("POUs.").</summary>
    public static string ExtFor(string kind) =>
        ExtByKind.TryGetValue(kind, out var ext) ? ext
        : throw new ArgumentException(
            $"No extension for kind '{kind}' — add it to ItemKind.SourceKindExtensions/ReferenceKindExtensions");
}
