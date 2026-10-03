using Volt.Contracts;

namespace Volt.Engine.Item;

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
/// docs/items.html.
/// </summary>
public static class ItemKind
{
    // ── [both] source POU / DUT kinds (full ST text); each named after its official TREEITEMTYPE ──
    public const int PlcFolder = 601;
    // A POU is ONE internal kind (`Kinds.Pou`) under ONE extension: `X.pou` (openspec `push-without-header-check` 5.Q,
    // owner 2026-10-02: "a wire extension carries only what the IDE stores PER OBJECT"). Whether a POU is a PROGRAM, a
    // FUNCTION_BLOCK or a FUNCTION is decided by its TEXT on both vendors — CODESYS has ONE `POUObject` class whose
    // kind follows the declaration (DIALECT C2f/C2g), and TwinCAT's three tree codes lag an in-place write and are
    // re-derived from the text on a reload (C2h) — so nothing in Volt reads it: the IDE and its build own it, and the
    // LSP reads it from the text as analysis. (Until 5.Q the wire gave each of the three its own extension, which cost
    // a header read per POU per walk on CODESYS and a re-type guard for every kind change.)
    //
    // 604 is the one POU code a driver hands up for a POU it classifies by CLASS (CODESYS) and the one a push creates
    // with (the seed on both vendors, as `PlcDut` is the DUT's); 602/603 are TwinCAT tree codes for the same kind.
    public const int PlcPou = 604;
    public const int PlcPouProg = 602;
    public const int PlcPouFunc = 603;
    public const int PlcGvl = 615;
    public const int PlcItf = 618;
    // A DUT is ONE internal kind (`Kinds.Dut`) under ONE extension: `X.dut`, which is also its file name (openspec
    // `push-without-header-check` 5.P, owner 2026-10-02: "keep it simple"). Its subtype (struct / enum / union /
    // alias) is not part of its name: nothing in Volt reads, carries or spells it — the IDE and its build own it, and
    // the LSP reads the shape from the text as analysis. So a struct rewritten as an enum is an ordinary content
    // update of `X.dut`. (Until 5.P the wire named a DUT by the subtype its vendor stated, one extension per subtype,
    // which cost a parse per vendor, a fallback name beside them, and rename handling for every subtype change.)
    //
    // But it is FOUR tree codes on TwinCAT, not one, and that correction cost real data. This used to say
    // "605/606/607 = the old PLCDUTENUM/STRUCT/UNION codes — NEVER PRODUCED, never needed", and every walk that
    // met one logged "unmapped TREEITEMTYPE … dropped by Core as unmapped-kind" and moved on. Measured live, two
    // independent ways: a hand-authored enum in the committed `TwinCAT Project14` fixture (`E_PackML_Mode`) has
    // ALWAYS reported 605, and a DUT re-created from TwinCAT's own item archive comes back 606 (struct) or 607
    // (union) rather than the 623 it was created with. So a DUT authored in the TwinCAT IDE — the ordinary case —
    // was INVISIBLE to `refs` and `fetch`, and absent means DELETED to a pull.
    //
    // 623 is TREEITEMTYPE_PLCDUTALIAS, not a generic DUT (DIALECT C2b): a push-create seeds 606 whatever the body
    // (`TcObjectModel.CreateChild`), and an in-place write of another shape keeps the OLD code live until a reload
    // (C2e). All four map to the one internal kind, named `X.dut`.
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
    public const int PlcProjectSettings = 700;  // the project's compiler settings (read-only `.projectsettings`):
                                            // which compiler warnings are off / raised to errors, plus the compile
                                            // options. IWorkspaceObject. This was a deliberate known-skip while the
                                            // only way in was the SCRIPTING api, which exposes nothing readable for
                                            // it; the object model does (see the descriptor). TwinCAT has no
                                            // tree node for it: its walk SYNTHESIZES the item at the root
                                            // (TcProjectSettings, DIALECT D37-D39).
                                            // (695-700 are CODESYS-first read-only descriptors for non-source project objects.)

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
        public const string Pou = "pou";
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
        public const string ProjectSettings = "project_settings";
    }

    /// <summary>Code → vendor-neutral wire kind string. null = not emitted as a tracked item: the containers
    /// &amp; sentinels (0, 690-693, -1, -2) and any code we don't classify all fall through to the default.</summary>
    public static string? Map(int code) => code switch
    {
        PlcFolder => Kinds.Folder,
        PlcPou or PlcPouProg or PlcPouFunc => Kinds.Pou,
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
        PlcProjectSettings => Kinds.ProjectSettings,
        _ => null,
    };

    /// <summary>Top-level source kinds (full ST text): POU, DUT, GVL, interface.</summary>
    public static bool IsTopLevelCrud(int code) =>
        code is PlcPou or PlcPouProg or PlcPouFunc or PlcGvl or PlcItf
              or PlcDut or PlcDutEnum or PlcDutStruct or PlcDutUnion;

    /// <summary>An item the WIRE ADDRESSES BY NAME at top level: every top-level source kind, plus the
    /// writable reference kinds. This is what a lookup and the push's item cache want.
    ///
    /// <para><b>Deliberately NOT the same predicate as <see cref="IsTopLevelCrud"/></b>, which now means only
    /// "is assembled ST". The two questions were the same until a descriptor became writable, and they read
    /// alike — but <c>IsTopLevelCrud</c> also decides TwinCAT's hybrid-node detection and whether a tree walk
    /// may descend past a name. Those are separate questions and are answered separately: see
    /// <see cref="InlinesItsChildren"/>.</para></summary>
    public static bool IsAddressableItem(int code) =>
        IsTopLevelCrud(code) || (Map(code) is { } kind && WritableReferenceSet.Contains(kind));

    /// <summary>A node whose children are ALL folded into its own body, so it is a FILE and never a folder.
    ///
    /// <para>Only a TwinCAT task, and only because that vendor models a task's POU calls as child items
    /// (<see cref="PlcProgRef"/>, 650) where CODESYS keeps them as a property. Both are rendered into the
    /// `Calls:` line of the one `.task` file, and the walk already skips the children themselves
    /// (<see cref="IsInlinedInPou"/>) — but the HYBRID test looks at the raw child COUNT, so a task still
    /// opened a folder named after itself for children nobody emits. Measured: `PlcTask.task` landed at
    /// `PlcTask/PlcTask.task` on TwinCAT against `Task Configuration/MainTask.task` on CODESYS, a workspace
    /// layout that differed per vendor for a file whose CONTENT is now identical in shape.</para></summary>
    public static bool InlinesItsChildren(int code) => code is PlcTask;

    /// <summary>Whether a kind string is a source kind (assembled ST text, not a manifest).</summary>
    public static bool IsSourceKind(string kind) => SourceKinds.Contains(kind);

    /// <summary>Whether a kind is a READ-ONLY descriptor: a reference kind (<see cref="ReferenceKindExtensions"/>) that
    /// is not one of the <see cref="WritableReferenceKinds"/>. The IDE renders it; a push never writes it.</summary>
    public static bool IsReadOnlyKind(string kind) =>
        ReferenceKindExtensions.Any(r => r.Kind == kind) && !WritableReferenceSet.Contains(kind);

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
    /// <summary>Does this kind materialize as a MEMBER of its POU's file — a <c>METHOD</c>, <c>ACTION</c> or
    /// <c>PROPERTY</c> block the ST layer can render and parse back?
    /// <para>Narrower than <see cref="IsInlinedInPou"/>, and the difference is load-bearing. A TRANSITION is
    /// inlined in a POU and is NOT a member: no reader models one, so it never reaches the item's file and can
    /// never be in a pushed member set. Reconciling members against the wider set is exactly how a push once
    /// deleted every transition of an SFC POU on the first write, silently. Accessors are excluded for a
    /// different reason — a property's GET/SET are read WITH the property, not beside it.</para></summary>
    /// <summary>The IDE kind code for a member kind — the inverse of <see cref="Map"/> over
    /// <see cref="IsMember"/>'s set, for creating a member the pushed source declares but the project does not
    /// have yet.</summary>
    public static int MemberCode(string kind) => kind switch
    {
        Kinds.Method => PlcMethod,
        Kinds.Action => PlcAction,
        Kinds.Property => PlcProp,
        Kinds.InterfaceMethod => PlcItfMeth,
        Kinds.InterfaceProperty => PlcItfProp,
        // No fallback. This value decides WHAT OBJECT gets created in the user's live project
        // (`PushService.ReconcileMembers` -> `CreateChild`), so an unrecognized kind used to create a METHOD
        // named after the member and report the push accepted. Its structural twin `PushService.PouKindToCode`
        // - the same map for the other half of this table - throws, and so do `ExtFor` and
        // `StWriter.EndKeyword`. This arm was the one that disagreed with the policy stated 60 lines below it.
        // Coded as Volt's bug (openspec bridge-refusal-review 2.18): the splitter emits no other member kind.
        _ => throw new BridgeException(BridgeErrorCodes.InternalError, $"no create code for the member kind '{kind}'"),
    };

    public static bool IsMember(int code) =>
        code is PlcAction or PlcMethod or PlcItfMeth or PlcProp or PlcItfProp;

    /// <summary>The item kinds whose tree node holds member objects (methods, properties, actions, transitions) - the
    /// items a CODESYS build diagnostic on a CHILD object is placed under (<c>CodesysDriver.NamesFor</c>), and the only
    /// items a diagnostic that carries a member can be named for (<c>BuildService.PromoteNames</c>).</summary>
    public static bool HoldsMembers(int code) => code is PlcPou or PlcPouProg or PlcPouFunc or PlcItf;

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
    // .pou as a textual one (graphical by its stated IMPLEMENTATION LD|FBD line), a CFC/SFC body is `.pou` too (its
    // `IMPLEMENTATION CFC|SFC UNSUPPORTED` line). The extension carries only what the IDE stores per object — a POU is
    // `pou` whether its text says PROGRAM, FUNCTION_BLOCK or FUNCTION, a DUT is `dut` whatever its shape; a push never
    // reads a top-level item's text for it.

    /// <summary>Writable source kinds (assembled ST text), each with its file extension.</summary>
    public static readonly IReadOnlyList<(string Kind, string Ext)> SourceKindExtensions = new (string, string)[]
    {
        (Kinds.Pou, "pou"),
        (Kinds.Interface, "itf"), (Kinds.Gvl, "gvl"),
        (Kinds.Dut, "dut"),
    };

    /// <summary>Read-only reference kinds (opaque manifests / descriptors), each with its file extension.</summary>
    public static readonly IReadOnlyList<(string Kind, string Ext)> ReferenceKindExtensions = new (string, string)[]
    {
        (Kinds.Library, "library"), (Kinds.Device, "device"), (Kinds.ProjectInfo, "projectinfo"),
        (Kinds.Trace, "trace"), (Kinds.Recipe, "recipe"), (Kinds.SymbolConfig, "symbols"), (Kinds.Task, "task"),
        (Kinds.ProjectSettings, "projectsettings"),
        (Kinds.ImagePool, "image_pool"), (Kinds.ParameterList, "parameter_list"), (Kinds.TextList, "text_list"),
        (Kinds.RecipeManager, "recipe_manager"), (Kinds.VisualizationManager, "visualization_manager"),
        (Kinds.Visualization, "visualization"), (Kinds.LibraryManager, "library_manager"),
        (Kinds.ClassDiagram, "class_diagram"), (Kinds.ExternalTypes, "external_types"), (Kinds.TmcFile, "tmc"),
    };

    /// <summary>Reference kinds that are nonetheless WRITABLE — a descriptor Volt can push back, not just
    /// render.
    ///
    /// <para><b>Writable is not the same as SOURCE, and conflating the two is what kept this list from
    /// existing.</b> Access used to be derived straight from "did this kind come from the source list", which
    /// is right for everything that is assembled ST and wrong for a descriptor: a `.task` is not structured
    /// text, the LSP must not parse it as such, and `volt init` must not colour it as ST — yet its fields are
    /// perfectly writable on the vendor (interval, priority, watchdog and the call list, every one a setter
    /// measured live: `scripts/probe-task-writable.py`). Keeping it OUT of the source list is also what leaves
    /// the four SOURCE_EXTENSIONS manifests (`scripts/check-wiring.ts`) untouched.</para>
    ///
    /// <para>BOTH VENDORS, by routes that share nothing below this format. TwinCAT assembles the same six
    /// fields from two tree items — the PLC task's `LinkedTask` names the SYSTEM task carrying priority and
    /// cycle time, while the ordered calls are the PLC item's own children — and reads every write back,
    /// because it accepts a schedule it has no intention of applying (DIALECT C19b). Which vendors implement
    /// which writable kind is gated: `test/Volt.Repo.Gates/VendorCapabilityParityTests.cs`.</para></summary>
    public static readonly IReadOnlyList<string> WritableReferenceKinds = new[] { Kinds.Task };

    private static readonly HashSet<string> WritableReferenceSet =
        new(WritableReferenceKinds, StringComparer.Ordinal);

    // ORDINAL: the extension is part of the wire name, and the wire name is compared Ordinal everywhere a client
    // keys it (baseline, version guard, removal sweep). Read case-blind, `X.Dut` passed as a DUT and was applied
    // to the IDE's `X`, while refs went on publishing `X.dut` — two spellings of one item that no later comparison
    // joined (a delete under the odd spelling destroyed it; a client's file of it never matched its own item).
    // There is one spelling per kind; any other names no kind and is refused by name (`RequireWireNames`).
    private static readonly Dictionary<string, string> KindByFileExt =
        SourceKindExtensions.Concat(ReferenceKindExtensions)
            .ToDictionary(x => x.Ext, x => x.Kind, StringComparer.Ordinal);

    /// <summary>The kind a WIRE NAME denotes, read off its extension (`MainTask.task` — `task`).
    ///
    /// <para>The wire is keyed by the FULL name and the extension IS the kind on it, so this is a lookup
    /// rather than an inference. It exists because a push has to route BEFORE it has an item: a create has no
    /// existing handle to ask, and the pre-flight runs before anything is resolved — and routing a `.task`
    /// through the ST reader would refuse every one of them as a malformed document.</para></summary>
    public static string? KindForWireName(string wireName)
    {
        var dot = (wireName ?? "").LastIndexOf('.');
        return dot < 0 ? null
             : KindByFileExt.TryGetValue(wireName!.Substring(dot + 1), out var kind) ? kind : null;
    }

    /// <summary>Is this wire name a TASK — a descriptor, the one non-source kind a push writes, routed by its own
    /// format before anything is resolved? The one copy: the push's gate and write and the post-push comparison
    /// (<c>PushedText</c>) all ask it, so none can send a `.task` to the ST reader.</summary>
    public static bool IsTaskWireName(string wireName) => KindForWireName(wireName) == Kinds.Task;

    /// <summary>Is this wire name a referenced LIBRARY's stub (`Standard.library`)? The CLI asks it to find a library's
    /// root folder (the stub's folder) by the file name, which IS the wire name — so the library extension is spelt
    /// only in the table above, and the CLI keeps no copy of it that would silently stop matching.</summary>
    public static bool IsLibraryWireName(string wireName) => KindForWireName(wireName) == Kinds.Library;

    private static readonly HashSet<string> SourceKinds =
        new(SourceKindExtensions.Select(x => x.Kind), StringComparer.Ordinal);

    // Every kind has exactly ONE extension (ToDictionary throws at load if a second row for a kind is added).
    private static readonly Dictionary<string, string> ExtByKind =
        SourceKindExtensions.Concat(ReferenceKindExtensions)
            .ToDictionary(x => x.Kind, x => x.Ext, StringComparer.Ordinal);

    /// <summary>Every workspace file extension with TWO flags: whether it is ST SOURCE (the LSP parses it,
    /// `volt init` colours it) and whether a push may WRITE it. Those are different questions — see
    /// <see cref="WritableReferenceKinds"/> — and the CLI's <c>Volt.Cli.Sync.Extensions</c> registry is built
    /// from this, so access and the extension list live in ONE place. File extension == wire extension for every
    /// kind, so this is the table, entry for entry.</summary>
    public static IEnumerable<(string Ext, bool IsSource, bool IsWritable)> FileExtensions =>
        SourceKindExtensions.Select(x => (Ext: x.Ext, IsSource: true, IsWritable: true))
            .Concat(ReferenceKindExtensions.Select(
                x => (Ext: x.Ext, IsSource: false, IsWritable: WritableReferenceSet.Contains(x.Kind))));

    /// <summary>Workspace file extension for a kind string (lowercase). No silent fallback — an unmapped kind
    /// throws so a new kind is caught, not dropped. That includes <see cref="Kinds.Folder"/>: a folder is a PATH
    /// SEGMENT, never a file, and both driver walks recurse it without emitting an item — the old <c>folder → ""</c>
    /// arm was left from the era when folders WERE emitted, and produced a bare-trailing-dot name ("POUs.").</summary>
    public static string ExtFor(string kind) =>
        ExtByKind.TryGetValue(kind, out var ext) ? ext
            : throw new ArgumentException(
                $"No extension for kind '{kind}' — add it to ItemKind.SourceKindExtensions/ReferenceKindExtensions");
}
