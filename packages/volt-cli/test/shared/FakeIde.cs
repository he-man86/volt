using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Volt.Wire;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;
using Volt.Engine.Host;
using Volt.Engine.Item;

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
        string? Declaration, string? Implementation, string? BodyLang, string? UnreadableReason,
        string[]? Children = null)
    {
        /// <summary>A plain textual (ST) POU — materializes via the declaration/implementation transports.</summary>
        public static Item TextualPou(string name, string decl, string impl, string folder = "") =>
            new Item(name, ItemKind.PlcPouProg, folder, true, decl, impl, null, null);

        /// <summary>An item the driver CANNOT read — the offline stand-in for the orphaned LD POU that bricked
        /// <c>/refs</c> for a whole project. What made it unreadable used to be a PLCopen export with no body
        /// element; now it is simply an item whose read throws, which is what any driver does when it cannot
        /// render a body. The POINT of the fixture is unchanged: one bad item must not take the call down.</summary>
        public static Item MalformedGraphical(string name, string folder = "") =>
            new Item(name, ItemKind.PlcPouProg, folder, true, null, null, "LD",
                "the graphical body cannot be read");

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

    /// <summary>Model the vendor whose DOCUMENT IMPORT invalidates every handle into the item it replaced —
    /// TwinCAT again, DIALECT D4d, and the more commonly hit of the two.
    /// <para>Split from <see cref="InvalidatesHandlesOnMove"/> because they are separate events on the real
    /// driver and a push does BOTH: `MoveItem` writes the content and then moves, through the same handle. With
    /// only the move flag, the write could never stale anything and a handle re-use bug after a write was
    /// unrepresentable — which is why one went unnoticed.</para></summary>
    public bool InvalidatesHandlesOnWrite { get; init; }

    private string NameOf(ItemRef r)
    {
        if (r.Native is not Handle h) return (string)r.Native;
        if ((InvalidatesHandlesOnMove || InvalidatesHandlesOnWrite) && h.Gen < _generation)
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

    /// <summary>Folders this fake pretends it could not enumerate — a driver's "COM faulted at this folder, skip
    /// the subtree" without needing a live IDE to fault.
    /// <para>Until this existed a partial walk could not be expressed at all, which is why every finding about
    /// one was untestable: `WalkItems()` returned a plain list and a fake has no COM to break. Items under these
    /// folders are still omitted from <c>Items</c>, exactly as a real skipped subtree would be, so a test can
    /// tell the difference between "omitted because gone" and "omitted because unseen".</para></summary>
    public IReadOnlyList<string> UnwalkableFolders { get; init; } = System.Array.Empty<string>();

    /// <summary>Tree nodes whose <see cref="ChildCount"/> FAULTS — a COM read failing mid-lookup, without a live
    /// IDE to fail. Distinct from <see cref="UnwalkableFolders"/>, which models a WALK skipping a subtree; this
    /// models a single-item lookup hitting a fault, where "I could not read" and "it is not there" are different
    /// answers that the code used to collapse into one.</summary>
    public IReadOnlyList<string> FaultingNodes { get; init; } = System.Array.Empty<string>();

    // ── IProjectTree (only the walk + accessors the services use are real) ──
    public WalkResult WalkItems()
    {
        var items = _items
            .Where(i => !UnwalkableFolders.Any(f => i.Folder == f || i.Folder.StartsWith(f + "/", StringComparison.Ordinal)))
            .Select(i => new ProjectItem(i.Name, Ref(i.Name), i.KindCode, i.Folder))
            .ToList();
        return new WalkResult(items, UnwalkableFolders);
    }
    public int KindCode(ItemRef item) => IsTreeNode(item) ? ItemKind.PlcFolder : Find(item).KindCode;
    public int ChildCount(ItemRef item)
    {
        if (FaultingNodes.Contains(NameOf(item)))
            throw new InvalidOperationException($"COM fault reading children of '{NameOf(item)}'");
        return ChildCountCore(item);
    }
    private int ChildCountCore(ItemRef item) =>
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
    /// <summary>Modelled the way CODESYS answers it — by looking at the accessor children the fake holds.
    /// The fake is a DRIVER stand-in, so it answers the question a driver answers, not the one the engine
    /// wishes it could ask.</summary>
    /// <summary>Defaults to FALSE — the stricter vendor (TwinCAT), where a create kills every handle — so a
    /// test that does not think about it exercises the re-find path rather than the shortcut. Settable, so the
    /// CODESYS shape can be asserted too.</summary>
    public bool HandlesSurviveStructureChange { get; set; }

    public (bool Get, bool Set) InterfacePropertyAccessors(ItemRef property)
    {
        bool get = false, set = false;
        int n = ChildCount(property);
        for (int i = 1; i <= n; i++)
        {
            var name = Name(ChildAt(property, i));
            if (string.Equals(name, "Get", StringComparison.OrdinalIgnoreCase)) get = true;
            else if (string.Equals(name, "Set", StringComparison.OrdinalIgnoreCase)) set = true;
        }
        return (get, set);
    }

    /// <summary>The seed each create was given — the body language, or an interface member's declared TYPE.
    /// Recorded because passing the wrong one is invisible until a live IDE rejects it.</summary>
    public Dictionary<string, string?> CreatedSeeds { get; } = new(StringComparer.OrdinalIgnoreCase);

    public ItemRef CreateChild(ItemRef parent, string name, int kindCode, string? seed = null)
    {
        Recorded.Add($"create:{name}");
        CreatedKinds[name] = kindCode;
        CreatedSeeds[name] = seed;
        // A real IDE's created object EXISTS the moment CreateChild returns: it is walkable, readable, and
        // EXPORTABLE — measured on CODESYS 3.5.21.40, where a just-created POU already carries an
        // <InterfaceAsPlainText> and a <body>. The fake used to record the call and nothing more, so a create
        // followed by a read threw "sequence contains no matching element" — which made the single-document
        // CREATE path (CreateChild, then splice the new item's own export) impossible to test here at all.
        // Only TOP-LEVEL items are registered: a created child/folder must not surface in the item walk.
        if (ItemKind.IsTopLevelCrud(kindCode) && !_items.Any(i => i.Name == name))
            _items.Add(new Item(name, kindCode, "", true, DefaultDeclaration(kindCode, name), "", null, null));
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
    /// <summary>Emit NO `interfaceasplaintext` addData block, as live TwinCAT now does. `ReadDeclaration`
    /// still answers, because the aspect is the object model rather than a serialisation — which is the whole
    /// reason the declaration must come from there.</summary>
    public bool OmitsPlaintextDeclaration { get; init; }

    public string ReadDeclaration(ItemRef item) => Find(item).Declaration ?? "";
    /// <summary>The declaration each WriteText carried. Recording only the call NAME cannot distinguish
    /// "the edit landed" from "a write happened" — the same reason <see cref="WrittenXml"/> exists.</summary>
    public Dictionary<string, string?> WrittenText { get; } = new();
    public void WriteText(ItemRef item, string? declaration, string? implementation)
    {
        // The recorded name says WHICH transport ran, because that is the whole subject of the transport matrix.
        // A declaration-only write (implementation: null) is the DECLARATION ASPECT — the one source that carries
        // an engineer's exact text. A write carrying an implementation is the old per-child text path, which is
        // the thing the matrix's negative half exists to keep out. Recording both as "write:" made the two
        // indistinguishable, and a guard that cannot tell them apart has to allow the one it means to forbid.
        Recorded.Add($"{(implementation is null ? "decl" : "write")}:{NameOf(item)}");
        WrittenText[NameOf(item)] = declaration;
        var it = FindOrNull(item);
        if (it is not null)
        {
            _items[_items.IndexOf(it)] = it with
            {
                Declaration = declaration ?? it.Declaration,
                Implementation = implementation ?? it.Implementation,
            };
        }
    }
    // ── the ItemContent facet ─────────────────────────────────────────────────────────────────────
    //
    // This replaced ~200 lines that BUILT PLCOPEN DOCUMENTS. The fake had to serve three document shapes -
    // one for a POU, one for a declaration-only kind, one for an interface - because a fake that answered a
    // single <pou> shape for every kind passed the whole write suite and failed live the moment a DUT took the
    // document path. None of that is a fact about an IDE; it was the cost of a contract that spoke XML.
    //
    // `BodyLanguage` is gone with it. It was RECORDED because it was not free - on CODESYS it was a full
    // PLCopen export, and the child body-format guard called it once per child, so a POU with 20 methods paid
    // 22 exports to write one body. There is nothing to count now: the language arrives with the content.

    /// <summary>The content the last <see cref="WriteContent"/> carried, by item name. On this path the write
    /// IS the content, so asserting on <c>Recorded</c> alone would miss everything a push actually did.</summary>
    public Dictionary<string, ItemContent> WrittenContent { get; } = new();

    /// <summary>Every piece of text a written <see cref="ItemContent"/> carries — declaration, body, and the
    /// same for each member and accessor. Assertions used to read <c>WrittenXml[name]</c> and search the
    /// document; the question they were asking ("did the write carry this text?") is unchanged, and this keeps
    /// it a one-liner without pretending there is a document.</summary>
    public static string AllText(ItemContent c) =>
        string.Join(Environment.NewLine, new[] { c.Declaration, c.Body }
            .Concat(c.Members.SelectMany(m => new[] { m.Declaration, m.Body, m.Getter?.Body, m.Setter?.Body }))
            .Where(t => t is not null));

    /// <summary>How many times the content was read. The push path reads to compute the current version;
    /// counting is how a regression in that count stays visible without making it a sequence assertion.</summary>
    public int ReadCount { get; private set; }

    public ItemContent ReadContent(ItemRef item)
    {
        // NOT recorded in `Recorded`, deliberately. That list is asserted as an exact SEQUENCE by the transport
        // matrix, whose subject is which WRITE interactions a push makes — the old fake did not record ReadXml
        // either. Reads are counted instead, so a caller that wants to know the read cost still can.
        ReadCount++;
        var it = Find(item);
        if (it.UnreadableReason is { } why)
            throw new InvalidOperationException($"'{it.Name}': {why}");
        return new ItemContent(
            KindOf(it),
            it.Declaration ?? "",
            BodyTextOf(it),
            MembersOf(it).ToList());
    }

    /// <summary>The item's kind, from its DECLARATION HEADER where it has one.
    /// <para>A real driver has an authoritative kind code from the IDE; a fixture does not, and most of them are
    /// built with the <c>TextualPou</c> helper, which stamps every item <c>program</c> regardless of what its
    /// declaration says. Reading the header keeps those fixtures meaning what they read as — a
    /// <c>FUNCTION_BLOCK FB_A</c> materializes as <c>FB_A.fb</c> — which is also what the document-based read
    /// did, since the document carried the real POU type.</para></summary>
    /// <summary>A member's kind, decided by its OWNER — the same rule `CodesysDriver.MemberKind` applies.</summary>
    private static string MemberKind(int code, bool ownerIsInterface) => code switch
    {
        ItemKind.PlcMethod or ItemKind.PlcItfMeth =>
            ownerIsInterface ? ItemKind.Kinds.InterfaceMethod : ItemKind.Kinds.Method,
        ItemKind.PlcProp or ItemKind.PlcItfProp =>
            ownerIsInterface ? ItemKind.Kinds.InterfaceProperty : ItemKind.Kinds.Property,
        _ => ItemKind.Map(code) ?? throw new System.InvalidOperationException($"FakeIde: unmapped member code {code}"),
    };

    private static string KindOf(Item it)
    {
        var header = Volt.Engine.Format.St.CodeHelper.ParseCodeHeader(it.Declaration ?? "").Type;
        return string.IsNullOrEmpty(header)
            ? ItemKind.Map(it.KindCode) ?? ItemKind.Kinds.FunctionBlock
            : header;
    }

    /// <summary>An item's body AS A DRIVER WOULD RETURN IT. A language Volt cannot author has no text form, so
    /// a real driver materializes it as the marker; a fake that returned the raw stored text instead would let a
    /// textual push sail past the body-format guard here and be refused only against a live IDE.
    /// <para><c>BodyLang</c> models what the IDE holds. It is deliberately NOT the same thing as the body text:
    /// that separation is exactly what the guard exists to check.</para></summary>
    private static string? BodyTextOf(Item it)
    {
        if (it.BodyLang is not { } lang) return it.Implementation;
        // A language Volt cannot author has no text form at all.
        if (!Volt.Engine.Format.Body.Languages.IsNetwork(lang))
            return Volt.Engine.Format.Body.BodyMarker.For(lang);
        // An FBD/LD body comes back as NETWORK TEXT. A fixture that sets BodyLang but stores plain text is
        // describing "the IDE holds a diagram", so render one — returning the raw text would make a graphical
        // body look textual to the format guard, and the guard would wave through the very overwrite it exists
        // to stop.
        var impl = it.Implementation ?? "";
        return Volt.Engine.Format.Network.NetworkText.Is(impl)
            ? impl
            : $"NETWORK 0 {lang}\n  {impl.Trim()}\nEND_NETWORK\n";
    }

    private IEnumerable<Member> MembersOf(Item owner)
    {
        // THE OWNER DECIDES THE MEMBER KIND, exactly as both real drivers do: an interface's children are
        // `interface_method`/`interface_property`, not `method`/`property`. The fake reported the POU spelling
        // for every owner, so it disagreed with the drivers it stands in for - and once PushService learned to
        // delete-and-recreate a member whose KIND changed, that disagreement showed up as a spurious
        // delete+create on every interface push. A fake that models the driver wrongly hides real bugs and
        // invents fake ones; this is the second kind.
        var ownerIsInterface = owner.KindCode == ItemKind.PlcItf;
        foreach (var name in owner.Children ?? System.Array.Empty<string>())
        {
            var child = FindOrNull(Ref(name));
            if (child is null || !ItemKind.IsMember(child.KindCode)) continue;   // a transition is not a member
            yield return new Member(
                MemberKind(child.KindCode, ownerIsInterface),
                child.Name,
                child.KindCode == ItemKind.PlcAction ? $"ACTION {child.Name}" : child.Declaration ?? "",
                BodyTextOf(child),
                string.IsNullOrEmpty(child.Folder) ? null : child.Folder);
        }
    }

    /// <summary>A write brings its members into existence, because that is what the real one does: afterwards a
    /// POU's methods and properties ARE children of it and can be read and written. The fake used to record the
    /// document and nothing else, so a member added by a push was invisible to any later tree walk — which made
    /// the member transport untestable offline, and would have let "the member cannot be found after its own
    /// write" pass here and fail live.</summary>
    public void WriteContent(ItemRef item, ItemContent content)
    {
        var name = NameOf(item);
        Recorded.Add($"writecontent:{name}");
        WrittenContent[name] = content;

        var owner = FindOrNull(item);
        if (owner is not null)
            _items[_items.IndexOf(owner)] = owner with
            {
                Declaration = content.Declaration,
                Implementation = content.Body ?? owner.Implementation,
                Children = content.Members.Select(m => m.Name).ToArray(),
            };

        foreach (var m in content.Members)
        {
            var existing = FindOrNull(Ref(m.Name));
            var member = new Item(m.Name, KindCodeOf(m.Kind), m.Folder ?? "", false,
                                  m.Declaration, m.Body, null, null);
            if (existing is null) _items.Add(member);
            else _items[_items.IndexOf(existing)] = member;
        }

        // Bumped LAST, so this call's own handle was still valid.
        if (InvalidatesHandlesOnWrite) _generation++;
    }

    private static int KindCodeOf(string kind) => kind switch
    {
        ItemKind.Kinds.Method => ItemKind.PlcMethod,
        ItemKind.Kinds.Action => ItemKind.PlcAction,
        ItemKind.Kinds.Property => ItemKind.PlcProp,
        ItemKind.Kinds.InterfaceMethod => ItemKind.PlcItfMeth,
        ItemKind.Kinds.InterfaceProperty => ItemKind.PlcItfProp,
        _ => ItemKind.PlcMethod,
    };


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
