using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Volt.Wire;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Model;
using Volt.Engine.Vocabulary;
using Volt.Engine.Host;

namespace Volt.Cli.Tests;

/// <summary>
/// The single in-memory <see cref="IIdeDriver"/> test double for the whole toolchain — the service tests
/// (RefsService / FetchService / PushService, in Volt.Engine.Tests), the pipe host + command tests (in
/// Volt.Cli.Tests), and the black-box CLI all drive this one fake. It is compiled into each test assembly via a
/// linked <c>&lt;Compile&gt;</c> to <c>test/shared/FakeIde.cs</c>, so there is exactly one definition to keep true.
///
/// Items are configured up front; <see cref="ItemRef.Native"/> is the item's bare name. Most of the surface is
/// no-op/throw; only the project-tree walk + the read transports the services actually exercise are real. Writes
/// are RECORDED, not applied — apply-dispatch tests assert on <see cref="Recorded"/>. To model an engineer editing
/// the IDE out from under the workspace (the push-conflict scenario), use <see cref="MutateImplementation"/> /
/// <see cref="AddItem"/> / <see cref="RemoveItem"/>, which change the walked state so the recomputed versions
/// (and thus the projectVersion lease) diverge from the workspace's baseline.
///
/// It derives from <see cref="DriverBase"/> — the same base both shipped drivers derive from — so the shared
/// machinery a fake used to hand-stub away (the degraded state machine, the IDE-thread liveness bracketing in
/// <c>RunOnStaThread</c>, and the single-flight ambient probe) actually RUNS under test. The vendor-shaped members
/// are supplied here: <see cref="MarshalToIdeThread{T}"/> is the fake's one work thread, and
/// <see cref="TriggerAsyncProbe"/> routes through <c>RunProbeOnce</c> so a probe that throws reaches
/// <c>OnProbeFailed</c> (log + MarkDegraded) exactly as it would on a real driver.
/// </summary>
public sealed class FakeIde : DriverBase, IIdeDriver
{
    public sealed record Item(
        string Name, int KindCode, string Folder, bool IsTopLevel,
        string? Declaration, string? Implementation, string? BodyLang, string? Xml,
        string[]? Children = null)
    {
        /// <summary>A plain textual (ST) POU — materializes via the declaration/implementation transports.</summary>
        public static Item TextualPou(string name, string decl, string impl, string folder = "") =>
            new Item(name, ItemKind.PlcPouProg, folder, true, decl, impl, null, null);

        /// <summary>A graphical POU whose export has NO FBD/LD body — <c>NetworkCodeIo.Read</c> throws on it, the
        /// same way the orphaned LD POU bricked <c>/refs</c>.</summary>
        public static Item MalformedGraphical(string name, string folder = "") =>
            new Item(name, ItemKind.PlcPouProg, folder, true, null, null, "LD",
                "<project xmlns=\"http://www.plcopen.org/xml/tc6_0200\"><types><pous /></types></project>");

        /// <summary>A referenced-library ref (`.library`). Its body IS its manifest (LIBRARY/NAMESPACE/RESOLUTION/…),
        /// carried here in <c>Declaration</c> and returned by <c>ReadManifest</c>; the default folder is the shared
        /// Library Manager, where CODESYS reports library refs.</summary>
        public static Item Library(string name, string manifest, string folder = "Library Manager") =>
            new Item(name, ItemKind.PlcLibRef, folder, true, manifest, null, null, null);
    }

    private readonly List<Item> _items;
    public FakeIde(params Item[] items) => _items = items.ToList();

    // Opt-in: serialize MarshalToIdeThread onto ONE background worker, modelling the real IDE's single primary/STA
    // thread (DriverBase.RunOnStaThread brackets every call to it, exactly as it does for a shipped driver).
    // With this on, a blocked op (ExtractBlock) HOLDS that thread — so a poll-path op that marshals onto it deadlocks,
    // while one served from cache answers. This is what makes the "poll ops answer while the IDE is busy" test real.
    public FakeIde(bool serializeSta, params Item[] items) : this(items)
    {
        if (!serializeSta) return;
        _sta = new System.Collections.Concurrent.BlockingCollection<Action>();
        new Thread(() => { foreach (var job in _sta.GetConsumingEnumerable()) job(); })
            { IsBackground = true, Name = "fake-sta" }.Start();
    }
    private readonly System.Collections.Concurrent.BlockingCollection<Action>? _sta;
    /// <summary>A handed-out handle, and the GENERATION it was handed out at.
    /// <para>The fake used to put the bare name in <see cref="ItemRef.Native"/>, so a handle could never go stale
    /// — and a whole class of real bridge bug is exactly that. TwinCAT invalidates every handle into a POU when
    /// its document is imported (DIALECT D4d) or its archive re-imported to place a member (D4j); a fake that
    /// resolves by name answers happily through a dead handle and asserts the bug away. With
    /// <see cref="InvalidatesHandlesOnMove"/> set, a handle older than the last move throws the way COM does.</para></summary>
    private sealed class Handle
    {
        public Handle(string name, int gen) { Name = name; Gen = gen; }
        public string Name { get; }
        public int Gen { get; }
        public override string ToString() => Name;
    }

    private int _generation;

    /// <summary>Model the vendor whose MOVE invalidates every handle into the moved object's owner — TwinCAT, whose
    /// member placement is a round trip through the enclosing POU's own archive. Off by default (CODESYS's move
    /// touches nothing but the moved object).</summary>
    public bool InvalidatesHandlesOnMove { get; init; }

    private string NameOf(ItemRef r)
    {
        if (r.Native is not Handle h) return (string)r.Native;
        if (InvalidatesHandlesOnMove && h.Gen < _generation)
            throw new System.InvalidOperationException(
                $"Item '{h.Name}' is deleted or invalidated by an ealier operation!");
        return h.Name;
    }

    private ItemRef Ref(string name) => new ItemRef(new Handle(name, _generation));

    private Item Find(ItemRef r) => _items.First(i => i.Name == NameOf(r));
    // Tolerant lookup: refs that never entered _items (a freshly CreateChild'd POU, a folder, "<root>") have
    // no children — return 0 rather than throw, matching the pre-children hard-coded ChildCount => 0.
    private Item? FindOrNull(ItemRef r) => _items.FirstOrDefault(i => i.Name == NameOf(r));

    /// <summary>Mutations recorded for apply-dispatch tests: create:/delete:/rename:/write: entries.</summary>
    public List<string> Recorded { get; } = new();

    /// <summary>The kindCode passed to each CreateChild, keyed by name — lets a test assert the IDE create
    /// code chosen (e.g. that every DUT variant creates with the single PlcDut code).</summary>
    public Dictionary<string, int> CreatedKinds { get; } = new();

    // ── test hooks: mutate the IDE OUT FROM UNDER a seeded workspace ─────────────────────────────────
    // These change the walked state (not Recorded) so a subsequent /refs or push-lease check sees a different
    // projectVersion — the "the IDE changed since your last sync" divergence the workspace never applied.

    /// <summary>Replace an item's implementation in place — models an engineer editing its body in the IDE.</summary>
    public void MutateImplementation(string name, string implementation)
    {
        var idx = _items.FindIndex(i => i.Name == name);
        if (idx < 0) throw new InvalidOperationException($"no item named '{name}' to mutate");
        _items[idx] = _items[idx] with { Implementation = implementation };
    }

    /// <summary>Add a brand-new item — models the engineer creating an object in the IDE.</summary>
    public void AddItem(Item item) => _items.Add(item);

    /// <summary>Remove an item — models the engineer deleting an object in the IDE.</summary>
    public void RemoveItem(string name) => _items.RemoveAll(i => i.Name == name);

    // ── health knob (drives IsConnected + BuildHealthResponse, as on a real driver) ──
    // Default connected: the common test bridge is up. Binding/disconnect tests flip these knobs.
    public bool HealthConnected { get; init; } = true;
    // Model a select that CANNOT attach the requested project (the multi-window trap): after it, the driver is not
    // connected, and the Core `select` handler must refuse loud. Default: select attaches fine.
    public bool SelectConnects { get; init; } = true;
    private bool _attached = true;
    public string HealthPlatform { get; init; } = "";
    // Default non-null so a bare `new FakeIde(...)` models a connected bridge WITH a project loaded (serving). A test
    // that wants "connected to the IDE but no project" sets this to null explicitly (then nothing serves).
    public string? HealthProjectName { get; init; } = "FakeProject";
    // The name on the CACHED health row, independent of the LIVE served name above. Defaults to HealthProjectName (the
    // two agree, as they normally do), and is settable APART so a test can model the snapshot naming a DIFFERENT
    // project than the one actually served — the mis-binding that was unrepresentable while one knob fed both.
    private string? _healthSnapshotProjectName;
    private bool _healthSnapshotProjectNameSet;
    public string? HealthSnapshotProjectName
    {
        get => _healthSnapshotProjectNameSet ? _healthSnapshotProjectName : HealthProjectName;
        init { _healthSnapshotProjectName = value; _healthSnapshotProjectNameSet = true; }
    }
    // Force the CACHED health snapshot to show NOTHING serving while the live signals still say connected — exactly
    // what TwinCAT's ~5s-throttled snapshot does for a moment after a reconnect. Default false: the two agree.
    public bool StaleHealthSnapshot { get; init; }

    // ── IProjectTree (only the walk + accessors the services use are real) ──
    public IReadOnlyList<ProjectItem> WalkItems() =>
        _items.Select(i => new ProjectItem(i.Name, Ref(i.Name), i.KindCode, i.Folder)).ToList();
    public int KindCode(ItemRef item) => IsTreeNode(item) ? ItemKind.PlcFolder : Find(item).KindCode;
    public int ChildCount(ItemRef item) =>
        IsTreeNode(item) ? TreeChildren(item).Count : FindOrNull(item)?.Children?.Length ?? 0;
    public string Name(ItemRef item) =>
        IsTreeNode(item) ? LastSegment(NameOf(item)) : Find(item).Name;
    public ItemRef ChildAt(ItemRef parent, int index1Based) =>
        IsTreeNode(parent) ? TreeChildren(parent)[index1Based - 1]
                           : Ref(Find(parent).Children![index1Based - 1]);

    // ── the tree ABOVE the items, so Engine's tree walks actually run here ────────────────────────────
    // Items carry a folder PATH string, and the fake used to stop there: the root had no children and only a
    // flat `Lookup` answered "is there an item called X". Nothing that WALKS could be exercised — which is
    // precisely what a driver does, and why moving a walk up into Engine would otherwise buy testability that
    // does not exist. The path strings are materialized into real folder nodes on demand.
    //
    // A tree node's Native is its full folder path (or a root name); an item's is its bare name. They cannot
    // collide, because an item is only ever addressed by the name it was registered under.
    private bool IsTreeNode(ItemRef r) =>
        NameOf(r) is { } s && (s == PlcRootName || s == TreeRootName || _folderPaths.Contains(s));

    private readonly HashSet<string> _folderPaths = new(StringComparer.Ordinal);

    private static string LastSegment(string path)
    {
        var i = path.LastIndexOf('/');
        return i < 0 ? path : path.Substring(i + 1);
    }

    /// <summary>The children of a root or folder node: the items sitting directly in it, plus one node per
    /// immediate sub-folder. Folder paths come from the items themselves, so the tree is exactly as deep as the
    /// items say it is — no folder is invented that holds nothing.</summary>
    private List<ItemRef> TreeChildren(ItemRef node)
    {
        var path = NameOf(node);
        var basePath = path == PlcRootName || path == TreeRootName ? "" : path;
        var kids = new List<ItemRef>();
        var subFolders = new List<string>();
        foreach (var it in _items)
        {
            var folder = it.Folder ?? "";
            if (folder == basePath) { kids.Add(Ref(it.Name)); continue; }
            if (basePath.Length > 0 && !folder.StartsWith(basePath + "/", StringComparison.Ordinal)) continue;
            var rest = basePath.Length == 0 ? folder : folder.Substring(basePath.Length + 1);
            if (rest.Length == 0) continue;
            var next = rest.Split('/')[0];
            var full = basePath.Length == 0 ? next : basePath + "/" + next;
            if (!subFolders.Contains(full)) subFolders.Add(full);
        }
        foreach (var f in subFolders) { _folderPaths.Add(f); kids.Add(Ref(f)); }
        return kids;
    }
    // Both default to the same synthetic root, so the whole tree is flat. A test that models a spine (the tree
    // root ABOVE the PLC-project root, e.g. CODESYS Device/Plc Logic/Application) sets these apart to prove push
    // descends the full path from the tree root instead of re-creating the spine under the PLC-project root.
    public string PlcRootName { get; init; } = "<root>";
    public string TreeRootName { get; init; } = "<root>";
    public ItemRef GetPlcProjectRoot() => Ref(PlcRootName);
    public ItemRef GetTreeRoot() => Ref(TreeRootName);
    public ItemRef Parent(ItemRef item) => Ref("<root>");
    public ItemRef CreateChild(ItemRef parent, string name, int kindCode, string? language = null)
    {
        Recorded.Add($"create:{name}");
        CreatedKinds[name] = kindCode;
        // A real IDE's created object EXISTS the moment CreateChild returns: it is walkable, readable, and
        // EXPORTABLE — measured on CODESYS 3.5.21.40, where a just-created POU already carries an
        // <InterfaceAsPlainText> and a <body>. The fake used to record the call and nothing more, so a create
        // followed by a read threw "sequence contains no matching element" — which made the single-document
        // CREATE path (CreateChild, then splice the new item's own export) impossible to test here at all.
        // Only TOP-LEVEL items are registered: a created child/folder must not surface in the item walk.
        if (ItemKind.IsTopLevelCrud(kindCode) && !_items.Any(i => i.Name == name))
            _items.Add(new Item(name, kindCode, "", true, DefaultDeclaration(kindCode, name), "", SeedLanguage(language), null));
        return Ref(name);
    }

    /// <summary>The declaration a fresh item comes into the world with — the IDE writes one, and the fake must
    /// too, because an item with NO declaration exports no <c>InterfaceAsPlainText</c> and the splice (rightly)
    /// refuses to write a declaration into a document that has nowhere to put one.</summary>
    private static string DefaultDeclaration(int kindCode, string name) => kindCode switch
    {
        ItemKind.PlcPouFb => $"FUNCTION_BLOCK {name}\nVAR\nEND_VAR\n",
        ItemKind.PlcPouFunc => $"FUNCTION {name} : INT\nVAR\nEND_VAR\n",
        ItemKind.PlcItf => $"INTERFACE {name}\n",
        ItemKind.PlcDut => $"TYPE {name} :\nSTRUCT\nEND_STRUCT\nEND_TYPE\n",
        ItemKind.PlcGvl => "VAR_GLOBAL\nEND_VAR\n",
        _ => $"PROGRAM {name}\nVAR\nEND_VAR\n",
    };
    public void Delete(ItemRef parent, string name) => Recorded.Add($"delete:{name}");
    // Recorded, not simulated: the fake tree is flat, so there is no placement to model — but WHICH child was
    // re-placed WHERE is exactly what the folder-preservation tests assert, and a fake that silently accepted the
    // call could assert the bug away.
    public void Move(ItemRef item, ItemRef target)
    {
        Recorded.Add($"move:{NameOf(item)}->{NameOf(target)}");
        // The vendor that places a member by re-importing its POU leaves every handle into that POU dead. Bumping
        // the generation LAST means this call's own arguments were still valid.
        if (InvalidatesHandlesOnMove) _generation++;
    }
    public void Rename(ItemRef item, string newName)
    {
        var old = NameOf(item);
        Recorded.Add($"rename:{old}->{newName}");
        var idx = _items.FindIndex(i => i.Name == old);
        if (idx >= 0) _items[idx] = _items[idx] with { Name = newName }; // so a follow-up Lookup(newName) resolves
    }

    // ── ICodeStore ──
    public string ReadDeclaration(ItemRef item) => Find(item).Declaration ?? "";
    public void WriteText(ItemRef item, string? declaration, string? implementation) => Recorded.Add($"write:{NameOf(item)}");
    // RECORDED, because it is not free: on CODESYS `BodyLanguage` is a full PLCopen export. The child
    // body-format guard used to call it once per child, so a POU with 20 methods paid 22 exports to write one
    // body. Counting the calls is how that stays fixed.
    public string? BodyLanguage(ItemRef item)
    {
        Recorded.Add($"bodylang:{NameOf(item)}");
        return Find(item).BodyLang;
    }
    public string ReadXml(ItemRef item)
    {
        var it = Find(item);
        if (it.Xml != null) return it.Xml;
        var ns = "http://www.plcopen.org/xml/tc6_0200";

        // THREE document shapes, one per kind, each mirroring a recorded CODESYS export. A fake that answered a
        // single <pou> shape for every kind would pass the whole write suite and fail live the moment a DUT or an
        // interface took the document path — the splice looks for <dataType>/<Interface> and would find neither.
        // Fixtures: fixtures/codesys-decl/{DUT,GVL}.plcopen.xml, fixtures/codesys-itf/ITF_FolderedMember.plcopen.xml.
        if (it.KindCode is ItemKind.PlcDut or ItemKind.PlcGvl)
            return DeclOnlyXml(it, ns);
        if (it.KindCode == ItemKind.PlcItf)
            return InterfaceXml(it, ns);

        var pouType = it.KindCode switch
        {
            ItemKind.PlcPouProg => "program",
            ItemKind.PlcPouFb => "functionBlock",
            ItemKind.PlcPouFunc => "function",
            _ => "functionBlock",
        };
        // The layout below MIRRORS a recorded CODESYS export (test/Volt.Engine.Tests/fixtures/codesys-pou/) —
        // <actions> before <body>, members in <addData>/<data name="…/method">, the POU's own declaration in the
        // trailing addData. It used to emit children as NESTED <pou pouType="method"> elements, a shape NEITHER
        // vendor produces: the reader tolerated it, so nothing failed, but it made the fake unusable for testing
        // the WRITE path (the splice looks for <Method>, finds nothing, and refuses). A fake that models the
        // document differently from both vendors can only ever test the reader's tolerance.
        var kids = (it.Children ?? System.Array.Empty<string>())
            .Select(n => _items.FirstOrDefault(i => i.Name == n)).Where(c => c != null).Select(c => c!).ToList();

        var xml = $"<pou name=\"{it.Name}\" pouType=\"{pouType}\" xmlns=\"{ns}\"><interface />";

        // A TRANSITION is its OWN TC6 container (<transitions><transition>), NOT an <action> — a shape no vendor
        // emits and this fake used to invent. It mattered: rendered as an action, PouReader read the transition
        // back as an action MEMBER, so it landed in the pushed member set and the orphan walk left it alone —
        // the fake was asserting away the very bug that walk has (deleting transitions no reader models).
        var actions = kids.Where(c => c.KindCode is ItemKind.PlcAction).ToList();
        if (actions.Count > 0)
            xml += "<actions>" + string.Join("", actions.Select(a =>
                $"<action name=\"{a.Name}\">{BodyXml(a)}</action>")) + "</actions>";

        var transitions = kids.Where(c => c.KindCode is ItemKind.PlcTrans).ToList();
        if (transitions.Count > 0)
            xml += "<transitions>" + string.Join("", transitions.Select(t =>
                $"<transition name=\"{t.Name}\">{BodyXml(t)}</transition>")) + "</transitions>";

        xml += BodyXml(it);

        xml += "<addData>";
        foreach (var m in kids.Where(c => c.KindCode is not (ItemKind.PlcAction or ItemKind.PlcTrans)))
        {
            var (element, data) = m.KindCode is ItemKind.PlcProp or ItemKind.PlcItfProp
                ? ("Property", "property") : ("Method", "method");
            xml += $"<data name=\"http://www.3s-software.com/plcopenxml/{data}\" handleUnknown=\"implementation\">"
                 + $"<{element} name=\"{m.Name}\"><interface />{BodyXml(m)}"
                 + $"<InterfaceAsPlainText><xhtml>{Escape(m.Declaration ?? "")}</xhtml></InterfaceAsPlainText>"
                 + $"</{element}></data>";
        }
        if (!string.IsNullOrEmpty(it.Declaration))
            xml += "<data name=\"http://www.3s-software.com/plcopenxml/interfaceasplaintext\" handleUnknown=\"implementation\">"
                 + $"<InterfaceAsPlainText><xhtml>{Escape(it.Declaration)}</xhtml></InterfaceAsPlainText></data>";
        xml += "</addData></pou>";
        return xml;
    }

    /// <summary>A DUT (<c>&lt;dataType&gt;</c> under <c>types/dataTypes</c>) or a GVL
    /// (<c>&lt;globalVars&gt;</c> under the project's own <c>addData</c>). Both are DECLARATION-ONLY: no
    /// <c>&lt;body&gt;</c> anywhere, no members. The <c>baseType</c> a real DUT also carries is omitted — it is
    /// the IDE's to regenerate from the plaintext on import, and inventing one here would model a shape the
    /// splice never writes.</summary>
    private static string DeclOnlyXml(Item it, string ns)
    {
        var iapt = "<data name=\"http://www.3s-software.com/plcopenxml/interfaceasplaintext\" handleUnknown=\"implementation\">"
                 + $"<InterfaceAsPlainText><xhtml>{Escape(it.Declaration ?? "")}</xhtml></InterfaceAsPlainText></data>";
        return it.KindCode == ItemKind.PlcDut
            ? $"<project xmlns=\"{ns}\"><types><dataTypes><dataType name=\"{it.Name}\"><addData>{iapt}</addData>"
              + "</dataType></dataTypes><pous /></types></project>"
            : $"<project xmlns=\"{ns}\"><types><dataTypes /><pous /></types><addData>"
              + "<data name=\"http://www.3s-software.com/plcopenxml/globalvars\" handleUnknown=\"implementation\">"
              + $"<globalVars name=\"{it.Name}\"><addData>{iapt}</addData></globalVars></data></addData></project>";
    }

    /// <summary>An INTERFACE: <c>&lt;Interface&gt;</c> under the project's own <c>addData</c>, with members in
    /// plain <c>&lt;Methods&gt;</c>/<c>&lt;Properties&gt;</c> containers — NOT in per-member <c>data</c> wrappers
    /// the way a POU's are, and with no <c>&lt;body&gt;</c> on the interface or on any member. That difference is
    /// the whole reason the document layer reads placement off the owner element.</summary>
    private string InterfaceXml(Item it, string ns)
    {
        var kids = (it.Children ?? System.Array.Empty<string>())
            .Select(n => _items.FirstOrDefault(i => i.Name == n)).Where(c => c != null).Select(c => c!).ToList();
        string Group(string tag, System.Collections.Generic.List<Item> ms) => ms.Count == 0 ? "" :
            $"<{tag}s>" + string.Join("", ms.Select(m =>
                $"<{tag} name=\"{m.Name}\"><interface />"
                + (tag == "Property"
                    ? "<SetAccessor><interface /></SetAccessor><GetAccessor><interface /></GetAccessor>" : "")
                + $"<InterfaceAsPlainText><xhtml>{Escape(m.Declaration ?? "")}</xhtml></InterfaceAsPlainText>"
                + $"</{tag}>")) + $"</{tag}s>";

        return $"<project xmlns=\"{ns}\"><types><dataTypes /><pous /></types><addData>"
             + "<data name=\"http://www.3s-software.com/plcopenxml/interface\" handleUnknown=\"implementation\">"
             + $"<Interface name=\"{it.Name}\">"
             + Group("Method", kids.Where(c => c.KindCode is not (ItemKind.PlcProp or ItemKind.PlcItfProp)).ToList())
             + Group("Property", kids.Where(c => c.KindCode is ItemKind.PlcProp or ItemKind.PlcItfProp).ToList())
             + $"<InterfaceAsPlainText><xhtml>{Escape(it.Declaration ?? "")}</xhtml></InterfaceAsPlainText>"
             + "</Interface></data></addData></project>";
    }

    /// <summary>A <c>&lt;body&gt;</c> in the vendors' shape: ST text in an inner <c>&lt;xhtml&gt;</c> (which is
    /// what the splice writes into), or a bare graphical element for a CFC/SFC marker.</summary>
    private static string BodyXml(Item it)
    {
        if (!string.IsNullOrEmpty(it.Implementation))
        {
            var lang = it.BodyLang ?? "ST";
            return $"<body><{lang}><xhtml>{Escape(it.Implementation)}</xhtml></{lang}></body>";
        }
        if (!string.IsNullOrEmpty(it.BodyLang)) return $"<body><{it.BodyLang}/></body>";
        return "<body><ST><xhtml></xhtml></ST></body>";
    }

    private static string Escape(string s) => System.Net.WebUtility.HtmlEncode(s);
    /// <summary>Model the vendor that STAMPS A BODY LANGUAGE at create time, the way TwinCAT does — and that
    /// cannot take "LD", so it creates FBD and carries the ladder view as archive metadata (DIALECT C6).
    /// <para>Off by default, which models CODESYS: there <c>CreateChild</c> ignores the language argument and the
    /// created POU carries a blank <c>&lt;ST&gt;</c>, so the body language is established later by the imported
    /// body element. The difference is not cosmetic — it is the whole reason a create must not be language-guarded
    /// (see <c>PouSplice.SetBody</c>'s <c>establishing</c>), and with this off no test could reach that case.</para></summary>
    public bool SeedsBodyLanguage { get; init; }

    private string? SeedLanguage(string? language) =>
        !SeedsBodyLanguage || language is null ? null : language == "LD" ? "FBD" : language;

    /// <summary>The document the last <see cref="WriteXml"/> carried, by item name. On the merge path this IS the
    /// write — asserting on <c>Recorded</c> alone would miss everything the push actually did.</summary>
    public Dictionary<string, string> WrittenXml { get; } = new();
    public void WriteXml(ItemRef item, string xml)
    {
        Recorded.Add($"writexml:{NameOf(item)}");
        WrittenXml[NameOf(item)] = xml;
    }
    public string ReadManifest(ItemRef item, string kind) => Find(item).Declaration ?? "";

    // ── IIdeSession (session boilerplate; no-op/sensible defaults) ──
    // The LIVE signals (IsConnected / ServedProjectName / Vendor) and the CACHED health snapshot are SEPARATE
    // sources here, because they are separate on a real driver: TwinCAT serves health from a ~5s-throttled snapshot
    // while IsConnected is a live state read, so the two CAN disagree. This double used to assert they were the same
    // signal, which made the divergence unrepresentable — and hid a real bug. `StaleHealthSnapshot` models it.
    public override bool IsConnected => HealthConnected && _attached;
    public override string Vendor => HealthPlatform;
    /// <summary>The LIVE served-project name — what the in-op guard reads. Independent of the health snapshot.</summary>
    public override string? ServedProjectName => IsConnected ? HealthProjectName : null;
    public override string? IdeVersion => "0";
    public override void Disconnect() { }
    // IsDegraded / MarkDegraded / ClearDegraded / Recover are NOT stubbed here any more: DriverBase's real ones run,
    // so the degraded state machine is under test. Nothing flips it by default, so today's answers are unchanged.
    /// <summary>The ambient probe, routed through <c>DriverBase.RunProbeOnce</c> like both shipped drivers — so the
    /// single-flight skip and the <c>OnProbeFailed</c> path (log + MarkDegraded) are reachable from a test for the
    /// first time. <see cref="ProbeAction"/> is the probe body; unset, it is an inert successful probe. Nothing calls
    /// this by default (the fake's <see cref="BuildHealthResponse"/> serves the configured rows directly), so it costs
    /// the existing suites nothing.</summary>
    public Action? ProbeAction { get; init; }
    public override void TriggerAsyncProbe() =>
        RunProbeOnce(() => RunOnStaThread(() => { ProbeAction?.Invoke(); return 0; }));

    /// <summary>Never reached in practice: the fake overrides <see cref="TriggerAsyncProbe"/> (it runs
    /// <see cref="ProbeAction"/>, not a snapshot) and <see cref="BuildHealthResponse"/> (it serves the live knobs),
    /// so nothing drives <c>DriverBase</c>'s row cache. Publishes the configured rows anyway, so the base cache is
    /// truthful the moment anything does.</summary>
    protected override void SnapshotHealth() => PublishRows(Projects.ToList());

    // This override STAYS after health-compose-in-core, deliberately. DriverBase now composes health from a cache
    // that only a SnapshotHealth publication fills — and nothing would ever fill the fake's: it has no Connect()
    // (BridgePipeHost never connects; the two production seeds are CodesysDriver.Connect / BeckhoffDriver.Connect),
    // and every health knob below is an `init` property assigned AFTER the ctor runs, so a ctor-time snapshot would
    // cache the defaults for the dozen call sites that set them. Serving the knobs directly keeps every existing
    // assertion meaning what it meant. The cost, stated rather than hidden: the fake does NOT exercise DriverBase's
    // composed body — the two shipped drivers do, and only the live e2e sees it.
    public override HealthResponse BuildHealthResponse()
    {
        // Each configured row only actually serves (non-idle status) while IsConnected — so a select that fails to
        // attach, or HealthConnected=false, forces every row to `idle`, like a real driver. When no rows are
        // configured, model the default connected bridge: while IsConnected, synthesize the one served row (name from
        // the knob, or a placeholder) so a bare `new FakeIde(...)` reports connected+serving exactly as before.
        // `StaleHealthSnapshot` = the cached list has no serving row even though the live signals say connected.
        var serving = IsConnected && !StaleHealthSnapshot;
        var rows = Projects.Select(p => p with { Status = serving ? p.Status : HealthStatus.Idle }).ToList();
        if (rows.Count == 0 && serving && !string.IsNullOrEmpty(HealthSnapshotProjectName))
            rows.Add(new ProjectEntry(HealthPlatform, "0", HealthSnapshotProjectName!, HealthStatus.Healthy, false));
        return new HealthResponse { Projects = rows };
    }
    /// <summary>Whether an op exception counts as a transient the host should self-heal — the filter on
    /// <c>BridgePipeHost.RunRead</c>'s mark-degraded → Recover → retry-once branch. Default false: today's answer, and
    /// CODESYS's in-proc answer. Settable so that branch stops being unreachable under test.</summary>
    public bool TransientErrorsAreDegraded { get; init; }
    public override bool ShouldMarkDegraded(Exception ex) => TransientErrorsAreDegraded;
    /// <summary>The fake's one IDE thread. <c>DriverBase.RunOnStaThread</c> wraps every call to this with the
    /// in-flight/freshness bracketing, so the fake gets the real liveness signals for free.</summary>
    protected override T MarshalToIdeThread<T>(Func<T> fn)
    {
        if (_sta == null) return fn();   // default: inline, no serialization
        T result = default!; Exception? error = null;
        using var done = new ManualResetEventSlim(false);
        _sta.Add(() => { try { result = fn(); } catch (Exception e) { error = e; } finally { done.Set(); } });
        done.Wait();
        if (error != null) throw error;
        return result;
    }

    // ── project rows / connect knobs — the flat connectable-projects list rides on the health response ──
    public List<ProjectEntry> Projects { get; set; } = new();
    public ConnectRequest? Selected { get; private set; }
    public override void SelectProject(ConnectRequest sel) { Selected = sel; if (!SelectConnects) _attached = false; }

    public override void FlushPendingWrites() { }

    // ── build knob: default to a clean build; a test sets BuildSucceeds=false + BuildDiagnostics to model errors ──
    public bool BuildSucceeds { get; init; } = true;
    public IReadOnlyList<BridgeDiagnostic> BuildDiagnostics { get; init; } = new List<BridgeDiagnostic>();
    public override bool Build() => BuildSucceeds;
    public override IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics() => BuildDiagnostics;

    /// <summary>Library element signatures the fetch's verbose fold will render + fold under each owning
    /// library's folder(s). Set per-test; empty by default.</summary>
    public IReadOnlyList<LibSignature> LibSignatures { get; init; } = new List<LibSignature>();
    // Optional test hooks to hold a mutation IN FLIGHT: extraction signals it has been entered, then blocks until
    // released — lets a test observe /health while the op runs (extraction is the FIRST thing a verbose /init does).
    public ManualResetEventSlim? ExtractEntered { get; init; }
    public ManualResetEventSlim? ExtractBlock { get; init; }
    /// <summary>How many times extraction (the precompile) ran — lets a test prove a directed fetch skips the build.</summary>
    public int ExtractCalls;
    public override IReadOnlyList<LibSignature> ExtractLibrarySignatures()
    {
        ExtractCalls++;
        ExtractEntered?.Set();
        ExtractBlock?.Wait();
        return LibSignatures;
    }
}
