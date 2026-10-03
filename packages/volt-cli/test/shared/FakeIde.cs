using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Volt.Wire;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Task;
using Volt.Engine.Host;
using Volt.Engine.Item;

namespace Volt.Tests.Shared;

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
        string[]? Children = null, string? Unsupported = null, string? Class = null)
    {
        // `Class`: a LABEL for the vendor class the wire does not name (a check function, a text-list enum, a persistent
        // list, an NVL, a GVL with network properties, an abstract method — DIALECT C2n). The double keeps it on every
        // in-place write, rename and move, and `CreateChild` makes the plain class (null), as both vendors do
        // (`scripts/merged-classes.log`), so a push that replaced an object instead of writing it shows as a lost label.

        // `Unsupported`: the IDE holds an LD/FBD body (`BodyLang`) that network text cannot represent, and this is the
        // fact the writer refuses — what a real driver catches as `UnrepresentableBodyException` and reads back as
        // `IMPLEMENTATION LD|FBD UNSUPPORTED`, with this as the reason the pull reports.

        /// <summary>A plain textual (ST) item — materializes via the declaration/implementation transports.
        ///
        /// <para>The TREE CODE — which CLASS of object the fixture describes — is derived from the declaration HERE,
        /// when the fixture is authored, which is legitimate: a fixture is describing a project that already exists.
        /// A POU is one class whatever its text (openspec <c>push-without-header-check</c> 5.Q), so PROGRAM,
        /// FUNCTION_BLOCK and FUNCTION text all describe the one POU code; an interface, a DUT and a GVL are other
        /// classes. The read path derives nothing (<c>KindOf</c>); that is the driver's job, and only the second is
        /// the driver's.</para></summary>
        public static Item TextualPou(string name, string decl, string impl, string folder = "") =>
            new Item(name, CodeForDeclaration(decl), folder, true, decl, impl, null, null);

        /// <summary>The CLASS a declaration describes, from its header's leading keyword — what the object a fixture
        /// describes was created as. (Fixture authoring only: a push never reads a header for this.)</summary>
        private static int CodeForDeclaration(string decl) =>
            FirstCodeLine(decl).Split(' ', '\t')[0].ToUpperInvariant() switch
            {
                "INTERFACE" => ItemKind.PlcItf,
                "TYPE" => ItemKind.PlcDut,
                "VAR_GLOBAL" or "VAR_CONFIG" => ItemKind.PlcGvl,
                _ => ItemKind.PlcPou,
            };

        /// <summary>The first line of <paramref name="decl"/> holding code, leading trivia skipped.</summary>
        private static string FirstCodeLine(string decl)
        {
            var inBlockComment = false;
            foreach (var line in decl.Replace("\r", "").Split('\n'))
                if (Volt.Engine.Format.St.CodeHelper.CodeOn(line, ref inBlockComment) is { Length: > 0 } code) return code;
            return "";
        }

        /// <summary>An item the driver CANNOT read — the offline stand-in for the orphaned LD POU that bricked
        /// <c>/refs</c> for a whole project. What made it unreadable used to be a PLCopen export with no body
        /// element; now it is simply an item whose read throws, which is what any driver does when it cannot
        /// render a body. The POINT of the fixture is unchanged: one bad item must not take the call down.</summary>
        public static Item MalformedGraphical(string name, string folder = "") =>
            new Item(name, ItemKind.PlcPou, folder, true, null, null, "LD",
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

    private Item Find(ItemRef r)
    {
        if (NameOf(r) is { } n && UnopenedItems.Contains(n)) OpenedUnopened.Add(n);
        return _items.First(i => i.Name == NameOf(r));
    }
    // Tolerant lookup: refs that never entered _items (a freshly CreateChild'd POU, a folder, "<root>") have
    // no children — return 0 rather than throw, matching the pre-children hard-coded ChildCount => 0.
    private Item? FindOrNull(ItemRef r) => _items.FirstOrDefault(i => i.Name == NameOf(r));

    /// <summary>Mutations recorded for apply-dispatch tests: create:/delete:/rename:/write: entries.</summary>
    public List<string> Recorded { get; } = new();

    /// <summary>The kindCode passed to each CreateChild, keyed by name — lets a test assert the IDE create
    /// code chosen (e.g. that every DUT variant creates with the single PlcDut code).</summary>
    public Dictionary<string, int> CreatedKinds { get; } = new();

    /// <summary>Every non-folder create, IN ORDER — for assertions about which item was created first, which a
    /// name-keyed map cannot answer when a folder and an item share a name.</summary>
    public List<string> CreatedItems { get; } = new();

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
    public string? HealthProjectName { get; set; } = "FakeProject";
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
    // SETTABLE, not init-only: a test that wants a folder to BECOME unreadable has to build the project
    // first and fail the walk afterwards — which is also the real sequence, since a folder does not
    // usually refuse to enumerate until something goes wrong.
    public IReadOnlyList<string> UnwalkableFolders { get; set; } = System.Array.Empty<string>();

    /// <summary>Items (by bare name) the walk SEES but cannot classify — a driver whose read of the object faults
    /// (the CODESYS walk reads every child's object to learn its kind). They are reported as
    /// <see cref="WalkResult.UnreadableObjects"/>, never in <c>Items</c>. Settable for the same reason as
    /// <see cref="UnwalkableFolders"/>: the object exists first and becomes unreadable afterwards.</summary>
    public IReadOnlyCollection<string> UnclassifiableItems { get; set; } = System.Array.Empty<string>();

    /// <summary>Items (by bare name) the driver NAMES but must not open — TwinCAT's POU whose tree item crashes XAE after a
    /// load (DIALECT C2i). <see cref="ChildAt"/> answers <see cref="UnreadableItemException"/> for them, as
    /// <c>TcObjectModel.ChildAt</c> does, and the walk names them with their kind family, keeping their folder walked.
    /// Deleting one through its parent is allowed (by name); once deleted, a recreated item of the name opens normally,
    /// as the real snapshot re-read after a structural write finds it parsed.</summary>
    public HashSet<string> UnopenedItems { get; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Every time code tried to OPEN an item in <see cref="UnopenedItems"/> by any other route (a read, a
    /// write, a kind) — on XAE that call would have been the crash. Must stay empty.</summary>
    public List<string> OpenedUnopened { get; } = new();

    /// <summary>Tree nodes whose <see cref="ChildCount"/> FAULTS — a COM read failing mid-lookup, without a live
    /// IDE to fail. Distinct from <see cref="UnwalkableFolders"/>, which models a WALK skipping a subtree; this
    /// models a single-item lookup hitting a fault, where "I could not read" and "it is not there" are different
    /// answers that the code used to collapse into one.</summary>
    public IReadOnlyList<string> FaultingNodes { get; init; } = System.Array.Empty<string>();

    // ── IProjectTree (only the walk + accessors the services use are real) ──

    /// <summary>How many times the tree was walked — lets a test prove an op that must NOT walk doesn't.</summary>
    public int WalkCalls;

    /// <summary>Fire before the walk to model a driver whose TREE READ faults — a COM error on `ChildCount`,
    /// which both shipped drivers guard for because it is an ordinary event on a live IDE. The fake synthesizes
    /// its tree from a list and so can never fault on its own, which is exactly why a caller that must survive
    /// one had no way to prove it here.</summary>
    public Action? OnWalkItems { get; set; }

    public WalkResult WalkItems()
    {
        WalkCalls++;
        OnWalkItems?.Invoke();
        // A real walk never ENTERS an object it could not classify — it cannot know the object is a container — so
        // nothing beneath one is seen: its subtree is `<folder>/<name>`.
        var unclassifiedSubtrees = _items.Where(i => UnclassifiableItems.Contains(i.Name))
            .Select(i => FolderPath.Append(i.Folder, i.Name)).ToList();
        // The ROOT ("") covers everything: a root whose children cannot be enumerated hides the whole project.
        static bool Under(string folder, string root) =>
            root.Length == 0 || folder == root || folder.StartsWith(root + "/", StringComparison.Ordinal);
        var walked = _items
            .Where(i => !UnwalkableFolders.Any(f => Under(i.Folder, f)) && !unclassifiedSubtrees.Any(s => Under(i.Folder, s)))
            .ToList();
        var items = walked.Where(i => !UnclassifiableItems.Contains(i.Name) && !UnopenedItems.Contains(i.Name))
            .Select(i => new ProjectItem(i.Name, Ref(i.Name), i.KindCode, i.Folder))
            .ToList();
        var unreadable = walked.Where(i => UnclassifiableItems.Contains(i.Name))
            .Select(i => new UnreadableObject(i.Name, i.Folder, "the fake refused to classify it"))
            .ToList();
        unreadable.AddRange(walked.Where(i => UnopenedItems.Contains(i.Name))
            .Select(i => new UnreadableObject(i.Name, i.Folder, UnopenedReason, UnopenedKinds)));
        return new WalkResult(items, UnwalkableFolders, unreadable);
    }
    /// <summary>Folder paths that are the vendor's TASK CONTAINER rather than a plain user folder. A real tree
    /// has typed containers; this fake synthesizes its folders from item paths, so every one of them read as
    /// <see cref="ItemKind.PlcFolder"/> and no test could tell the two apart — which is exactly the distinction
    /// a task's create has to make, because the container's NAME is localized and its KIND is not.</summary>
    public readonly HashSet<string> TaskConfigFolders = new(StringComparer.Ordinal);

    public int KindCode(ItemRef item) =>
        IsTreeNode(item)
            ? (TaskConfigFolders.Contains(NameOf(item)) ? ItemKind.TaskConfig : ItemKind.PlcFolder)
            : Find(item).KindCode;
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
    public ItemRef ChildAt(ItemRef parent, int index1Based)
    {
        var child = IsTreeNode(parent) ? TreeChildren(parent)[index1Based - 1]
                                       : Ref(Find(parent).Children![index1Based - 1]);
        if (NameOf(child) is { } n && UnopenedItems.Contains(n))
            throw new UnreadableItemException(n, UnopenedReason, UnopenedKinds);
        return child;
    }

    public const string UnopenedReason = "the fake must not open it (DIALECT C2i)";
    public static readonly IReadOnlyList<string> UnopenedKinds = new[] { ItemKind.Kinds.Pou };

    // ── the tree ABOVE the items, so Engine's tree walks actually run here ────────────────────────────
    // Items carry a folder PATH string, and the fake used to stop there: the root had no children and only a
    // flat `Lookup` answered "is there an item called X". Nothing that WALKS could be exercised — which is
    // precisely what a driver does, and why moving a walk up into Engine would otherwise buy testability that
    // does not exist. The path strings are materialized into real folder nodes on demand.
    //
    // A tree node's Native is its full folder path (or a root name); an item's is its bare name. They cannot
    // collide, because an item is only ever addressed by the name it was registered under.
    private bool IsTreeNode(ItemRef r) =>
        NameOf(r) is { } s && (s == PlcRootName || s == TreeRootName || _folderPaths.Contains(s) || _explicitFolders.Contains(s));

    private readonly HashSet<string> _folderPaths = new(StringComparer.Ordinal);

    /// <summary>Folders CREATED as folders, which therefore outlive the items that were in them — the state a
    /// real IDE holds and this fake could not express. Distinct from <see cref="_folderPaths"/>, which is just
    /// a note of every folder the walk has ever synthesised from an item's path.</summary>
    private readonly HashSet<string> _explicitFolders = new(StringComparer.Ordinal);

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
            if (HiddenItems.Contains(it.Name)) continue;
            var folder = it.Folder ?? "";
            if (folder == basePath) { kids.Add(Ref(it.Name)); continue; }
            if (basePath.Length > 0 && !folder.StartsWith(basePath + "/", StringComparison.Ordinal)) continue;
            var rest = basePath.Length == 0 ? folder : folder.Substring(basePath.Length + 1);
            if (rest.Length == 0) continue;
            var next = rest.Split('/')[0];
            var full = basePath.Length == 0 ? next : basePath + "/" + next;
            if (!subFolders.Contains(full)) subFolders.Add(full);
        }
        // …plus any folder created AS a folder directly under this node, whether or not anything is in it.
        foreach (var f in _explicitFolders)
        {
            if (basePath.Length > 0 && !f.StartsWith(basePath + "/", StringComparison.Ordinal)) continue;
            var rest = basePath.Length == 0 ? f : f.Substring(basePath.Length + 1);
            if (rest.Length == 0 || rest.Contains('/')) continue;   // not an IMMEDIATE child
            if (!subFolders.Contains(f)) subFolders.Add(f);
        }
        foreach (var f in subFolders) { _folderPaths.Add(f); kids.Add(Ref(f)); }
        return kids;
    }
    /// <summary>Items that EXIST (readable, deletable by name) but that no tree scan returns — the stale tree a TwinCAT
    /// lookup can hit right after a mutation: an item renamed or created a moment ago that a re-find under its parent
    /// does not see. Lets a test reach the engine's "it cannot be found after …" refusals offline.</summary>
    public HashSet<string> HiddenItems { get; } = new(StringComparer.OrdinalIgnoreCase);

    // Both default to the same synthetic root, so the whole tree is flat. A test that models a spine (the tree
    // root ABOVE the PLC-project root, e.g. CODESYS Device/Plc Logic/Application) sets these apart to prove push
    // descends the full path from the tree root instead of re-creating the spine under the PLC-project root.
    public string PlcRootName { get; init; } = "<root>";
    public string TreeRootName { get; init; } = "<root>";
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

    /// <summary>Which node each create was given as its PARENT. `Recorded` only carries the name, so a create
    /// that lands in the wrong container looks identical to one that lands in the right one — which is how an
    /// empty `toFolder` resolving to the Application instead of the tree root stayed invisible offline.</summary>
    public Dictionary<string, string> CreatedParents { get; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Task settings pushed, by item name. Recorded rather than applied, like every other mutation
    /// here - the point is which call the engine made, and with what.</summary>
    public Dictionary<string, TaskSettings> WrittenTasks { get; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Make the next task-settings write FAIL, the way a vendor's own refusal does — TwinCAT has no
    /// spelling for a CODESYS TIME literal, so `Interval: t#4ms` is rejected rather than rounded. The engine
    /// owns what happens NEXT (the create must roll back), and that is only testable offline if the write can
    /// be made to refuse. Twin of <see cref="RefuseContentWrite"/>.</summary>
    public Func<ItemRef, Exception?>? RefuseTaskWrite { get; init; }

    /// <summary>Add a task to the project, for tests about what happens to one that ALREADY exists.</summary>
    public void AddTask(string bareName) =>
        _items.Add(new Item(bareName, ItemKind.PlcTask, "", true,
                            "Type:     Cyclic\nInterval: 10ms\nPriority: 1\n", null, null, null));

    /// <summary>A task write that is NOT atomic, as neither vendor's is: given the task's descriptor and the pushed
    /// settings, the descriptor the task holds when <see cref="RefuseTaskWrite"/>'s refusal comes (TwinCAT lands the
    /// schedule and empties the call list before refusing the calls; CODESYS sets <c>kind_of_task</c> before a later
    /// member refuses). Null: a refusal lands nothing.</summary>
    public Func<string, TaskSettings, string>? TaskWriteLandsBeforeRefusal { get; init; }

    public void WriteTask(ItemRef task, TaskSettings settings)
    {
        if (RefuseTaskWrite?.Invoke(task) is { } refusal)
        {
            if (TaskWriteLandsBeforeRefusal is { } lands && FindOrNull(task) is { } t)
                _items[_items.IndexOf(t)] = t with { Declaration = lands(t.Declaration ?? "", settings) };
            throw refusal;
        }

        Recorded.Add($"writetask:{NameOf(task)}");
        WrittenTasks[NameOf(task)] = settings;
    }

    /// <summary>Model CODESYS judging a member create against its POU's CURRENT TEXT (DIALECT C2k, measured
    /// 2026-10-02): a POU whose declaration opens with FUNCTION takes no method, property, action or transition, and
    /// one whose text declares nothing (no PROGRAM / FUNCTION_BLOCK / FUNCTION) takes no method and no property —
    /// refused with the IDE's own message. Opt-in, because TwinCAT's answer is the vendor's own (DIALECT C2k) and the
    /// default fake derives nothing from text.</summary>
    public bool RefusesMembersByText { get; init; }

    /// <summary>Make a create FAIL for a reason that is NOT the IDE refusing the child — a stale handle, a transport
    /// fault — given the name and kind code. The engine must not word such a failure as a refusal of the text.</summary>
    public Func<string, int, Exception?>? FailCreate { get; init; }

    /// <summary>The driver's measured NAME refusals (<c>ICodeStore.RefusedName</c>), given the kind created and the name:
    /// the reason for a refused name, null for one it does not refuse. Unset, the fake refuses no name — as
    /// <c>DriverBase</c>.</summary>
    public Func<string, string, string?>? RefusesName { get; init; }

    public override string? RefusedName(string kind, string name) => RefusesName?.Invoke(kind, name);

    /// <summary>The driver's language-change answer (<c>ICodeStore.RefusedLanguageChange</c>), given the site, the live
    /// language and the pushed one: the vendor's reason, or null where it writes the change (CODESYS for a POU's own
    /// body, DIALECT N24). Unset, the fake has no in-place route at any site — TwinCAT's answer — so a test that wants
    /// a written change states it.</summary>
    public Func<string, string, string, string?>? RefusesLanguageChange { get; init; }

    public override string? RefusedLanguageChange(string site, string from, string to) =>
        RefusesLanguageChange is { } answer
            ? answer(site, from, to)
            : $"FakeIde: no route to change an existing body's language in place (from {from} to {to}).";

    /// <summary>The driver's create-argument refusals (<c>ICodeStore.RefusedMemberCreate</c>), given the member kind, name
    /// and seed. <see cref="CreateChild"/> refuses the same creates with a <c>NotSupportedException</c>, as TwinCAT's
    /// driver does. Unset, the fake refuses none — as <c>DriverBase</c>.</summary>
    public Func<string, string, string?, string?>? RefusesMemberCreate { get; init; }

    public override string? RefusedMemberCreate(string memberKind, string name, string? seed) =>
        RefusesMemberCreate?.Invoke(memberKind, name, seed);

    /// <summary>The driver's interface-accessor refusal (<c>ICodeStore.ValidateInterfaceAccessor</c>), handed each pushed
    /// accessor of an interface property. Every call is recorded; unset, the fake refuses none — as <c>DriverBase</c>.</summary>
    public Action<Accessor>? ValidatesInterfaceAccessor { get; init; }

    /// <summary>Every <c>ValidateInterfaceAccessor</c> call, in order.</summary>
    public List<Accessor> InterfaceAccessorsValidated { get; } = new();

    public override void ValidateInterfaceAccessor(Accessor pushed)
    {
        InterfaceAccessorsValidated.Add(pushed);
        ValidatesInterfaceAccessor?.Invoke(pushed);
    }

    /// <summary>The driver's own pre-flight (<c>ICodeStore.ValidateSource</c>), handed the bodies the engine validated.
    /// Every call is recorded; unset, the fake refuses nothing — as <c>DriverBase</c>.</summary>
    public Action<IReadOnlyList<Volt.Engine.Ide.PushedNetworkBody>>? ValidatesSource { get; init; }

    /// <summary>Every <c>ValidateSource</c> call, in order: what the engine handed the driver's pre-flight.</summary>
    public List<IReadOnlyList<Volt.Engine.Ide.PushedNetworkBody>> SourcesValidated { get; } = new();

    /// <summary>The item each <c>ValidateSource</c> call was handed (null for a create), index-aligned with
    /// <see cref="SourcesValidated"/>.</summary>
    public List<ItemRef?> ExistingValidated { get; } = new();

    public override void ValidateSource(ItemRef? existing, IReadOnlyList<Volt.Engine.Ide.PushedNetworkBody> bodies)
    {
        SourcesValidated.Add(bodies);
        ExistingValidated.Add(existing);
        ValidatesSource?.Invoke(bodies);
    }

    /// <summary>The driver's task pre-flight (<c>ICodeStore.ValidateTask</c>), handed the settings the engine's gate read.
    /// Every call is recorded; unset, the fake refuses nothing — as <c>DriverBase</c>.</summary>
    public Action<TaskSettings>? ValidatesTask { get; init; }

    /// <summary>Every <c>ValidateTask</c> call, in order.</summary>
    public List<TaskSettings> TasksValidated { get; } = new();

    public override void ValidateTask(TaskSettings settings)
    {
        TasksValidated.Add(settings);
        ValidatesTask?.Invoke(settings);
    }

    public ItemRef CreateChild(ItemRef parent, string name, int kindCode, string? seed = null)
    {
        if (FailCreate?.Invoke(name, kindCode) is { } failure) throw failure;
        if (ItemKind.Map(kindCode) is { } memberKind && RefusesMemberCreate?.Invoke(memberKind, name, seed) is { } why)
            throw new NotSupportedException(why);
        if (RefusesMembersByText && ItemKind.IsInlinedInPou(kindCode) && FindOrNull(parent) is { KindCode: ItemKind.PlcPou } pouOwner)
        {
            var header = Volt.Engine.Format.St.StReader.PouHeaderKeyword(pouOwner.Declaration ?? "");
            var refused = header == "FUNCTION"
                || (header is null && kindCode is ItemKind.PlcMethod or ItemKind.PlcProp);
            if (refused)
            {
                var what = kindCode switch
                {
                    ItemKind.PlcMethod => "Method", ItemKind.PlcProp => "Property",
                    ItemKind.PlcAction => "Action", _ => "Transition",
                };
                Recorded.Add($"refused:{name}");
                // As the drivers word it: the vendor's own "not accepted", recognised and thrown as a child refusal.
                throw new Volt.Engine.Ide.ChildRefusedException(
                    $"Object '{what}' is not accepted by parent object, or invalid (e. g. missing plugin or device description).",
                    Volt.Engine.Ide.ChildRefusalCause.Kind);
            }
        }
        Recorded.Add($"create:{name}");
        // A LIST, not a dictionary, and not derivable from `CreatedKinds`. A folder and an item may share a
        // NAME — `lenze-mid` has a folder `UDT_CamControlLS/` beside a DUT of that name — so a name-keyed map
        // collapses the two and cannot say which was created when. That collapse is the same one the wire
        // itself was bitten by (`SameBareNameVersionTests`), and it silently turned a PASSING create-order
        // assertion into a failing one.
        if (kindCode != ItemKind.PlcFolder) CreatedItems.Add(name);
        // A CREATED FOLDER EXISTS EVEN HOLDING NOTHING, and until this line the fake could not say so.
        //
        // `TreeChildren` derives folders from the items IN them ("no folder is invented that holds nothing"),
        // which is faithful for a walk and useless for a lifecycle: the moment the last item leaves, the fake
        // forgets the folder ever existed. Both vendors keep it (measured — `probe-empty-folder-lifecycle.py` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/probe-empty-folder-lifecycle.py`)
        // and a COM tree walk), so a fake that cannot represent an empty folder makes `PruneEmptied` untestable
        // by construction: every assertion passes whether the prune runs or not.
        // The parent's own path, which is "" at either root. Folder refs in this fake are NAMED by their full
        // path, so this is the whole of it.
        var parentPath = NameOf(parent) is { } pp && pp != PlcRootName && pp != TreeRootName ? pp : "";
        if (kindCode == ItemKind.PlcFolder)
            _explicitFolders.Add(parentPath.Length == 0 ? name : parentPath + "/" + name);
        CreatedParents[name] = NameOf(parent);
        CreatedKinds[name] = kindCode;
        CreatedSeeds[name] = seed;
        // A real IDE's created object EXISTS the moment CreateChild returns: it is walkable, readable, and
        // EXPORTABLE — measured on CODESYS 3.5.21.40, where a just-created POU already carries an
        // <InterfaceAsPlainText> and a <body>. The fake used to record the call and nothing more, so a create
        // followed by a read threw "sequence contains no matching element" — which made the single-document
        // CREATE path (CreateChild, then splice the new item's own export) impossible to test here at all.
        if (ItemKind.IsAddressableItem(kindCode) && !_items.Any(i => i.Name == name))
            // WITH ITS FOLDER. This passed "" for every create, so the fake said every item sat at the root —
            // and `PushService`'s pre-apply cache reads exactly this field to know which folder an item is
            // LEAVING. With "" there, `PruneEmptied` had no candidate to consider and could not be tested.
            _items.Add(new Item(name, kindCode, parentPath, true, DefaultDeclaration(kindCode, name), "", null, null));

        // A CREATED MEMBER IS FINDABLE UNDER ITS PARENT, and a created FOLDER is not an item. Both halves
        // matter, and only the second used to hold: the fake registered top-level kinds and nothing else, so a
        // member the engine had just created could not be found by the engine's very next call.
        //
        // That is not a small infidelity. `PushService.ReconcileMembers` CREATES a member the pushed source
        // declares and the project lacks — creating members is its job — and `ReconcileAccessor` then looks the
        // property up to reconcile its GET and SET. Against this fake the lookup failed and the push threw
        // "the property is in the pushed source but cannot be found in the project", a refusal a real IDE never
        // produces. So the whole member-create path read as broken here while being correct, which is the shape
        // that teaches you to distrust the test rather than the code.
        //
        // Folders stay unregistered deliberately — `PlcFolder` is not an item and must not surface in the walk.
        else if (kindCode != ItemKind.PlcFolder && !ItemKind.IsTopLevelCrud(kindCode)
                 && !_items.Any(i => string.Equals(i.Name, name, StringComparison.OrdinalIgnoreCase)))
        {
            _items.Add(new Item(name, kindCode, "", false, null, null, null, null));
            if (FindOrNull(parent) is { } owner)
                _items[_items.IndexOf(owner)] = owner with
                {
                    Children = (owner.Children ?? System.Array.Empty<string>()).Append(name).ToArray(),
                };
        }
        // A FOLDER REF IS NAMED BY ITS FULL PATH here, the way `TreeChildren` names the ones it
        // synthesises — so returning the bare leaf made the NEXT level compute its parent as `Mid`
        // rather than `Chain/Mid`, and a folder three deep was registered under a path nothing could
        // find. Harmless while no test looked below two levels.
        return kindCode == ItemKind.PlcFolder
            ? Ref(parentPath.Length == 0 ? name : parentPath + "/" + name)
            : Ref(name);
    }

    /// <summary>The declaration a fresh item comes into the world with — the IDE writes one, and the fake must
    /// too, because an item with NO declaration exports no <c>InterfaceAsPlainText</c> and the splice (rightly)
    /// refuses to write a declaration into a document that has nowhere to put one.</summary>
    private static string DefaultDeclaration(int kindCode, string name) => kindCode switch
    {
        // Every POU is created as a function block (the one seed, design 5.Qa S1).
        ItemKind.PlcPou => $"FUNCTION_BLOCK {name}\nVAR\nEND_VAR\n",
        ItemKind.PlcItf => $"INTERFACE {name}\n",
        ItemKind.PlcDut => $"TYPE {name} :\nSTRUCT\nEND_STRUCT\nEND_TYPE\n",
        ItemKind.PlcGvl => "VAR_GLOBAL\nEND_VAR\n",
        _ => $"PROGRAM {name}\nVAR\nEND_VAR\n",
    };
    /// <summary>Make a delete FAIL, given the bare name — the case a push's rollback of a refused create must report
    /// (openspec <c>push-keeps-what-landed</c>: "a refused create leaves nothing behind, or says it did"). The item
    /// stays in the project, as it does on the live IDE when its removal faults.</summary>
    public Func<string, Exception?>? FailDelete { get; init; }

    /// <summary>Records AND removes. It only recorded, so nothing could observe that a delete actually
    /// happened: a test could not tell "deleted" from "reported deleted", and a push that removed a member and
    /// then read the POU back still saw it. An audit found a foldered member that could never be deleted at all,
    /// and the offline suite was structurally incapable of noticing.</summary>
    public void Delete(ItemRef parent, string name)
    {
        if (FailDelete?.Invoke(name) is { } failure) throw failure;
        Recorded.Add($"delete:{name}");
        UnopenedItems.Remove(name);
        // A FOLDER IS NOT AN ITEM, so it is not in `_items` and the item path below would silently no-op on
        // one. Deleting a folder is what `PruneEmptied` does, so the fake has to honour it — including the
        // descendants, which a real IDE removes with it.
        var parentPath = NameOf(parent) is { } pn && pn != PlcRootName && pn != TreeRootName ? pn + "/" : "";
        var folderPath = parentPath + name;
        if (_explicitFolders.Remove(folderPath))
            _explicitFolders.RemoveWhere(f => f.StartsWith(folderPath + "/", StringComparison.Ordinal));

        var victim = FindOrNull(Ref(name));
        if (victim is null) return;
        _items.Remove(victim);
        var owner = FindOrNull(parent);
        if (owner?.Children is { } kids)
            _items[_items.IndexOf(owner)] = owner with
            {
                Children = kids.Where(k => !string.Equals(k, name, StringComparison.OrdinalIgnoreCase)).ToArray(),
            };
    }
    // Recorded, not simulated: the fake tree is flat, so there is no placement to model — but WHICH child was
    // re-placed WHERE is exactly what the folder-preservation tests assert, and a fake that silently accepted the
    // call could assert the bug away.
    /// <summary>Make a move FAIL, given the moved item's name — the step of a move+edit that runs AFTER its content
    /// write landed (openspec <c>push-keeps-what-landed</c> gate step 2: the conflict must say the text stays).</summary>
    public Func<string, Exception?>? FailMove { get; init; }

    public void Move(ItemRef item, ItemRef target)
    {
        if (FailMove?.Invoke(NameOf(item)) is { } failure) throw failure;
        Recorded.Add($"move:{NameOf(item)}->{NameOf(target)}");

        // …AND THE ITEM IS ACTUALLY SOMEWHERE ELSE AFTERWARDS. This recorded the call and changed nothing, so
        // the fake still reported the item in the folder it had LEFT — which reads as a move that worked, and
        // makes anything downstream of a move untestable. `PruneEmptied` is the case that found it: the origin
        // never looked empty, so it was never a candidate.
        var targetPath = NameOf(target) is { } tp && tp != PlcRootName && tp != TreeRootName ? tp : "";
        // TOP-LEVEL ITEMS ONLY. A POU MEMBER's placement is not a tree folder at all — it is a `FolderPath`
        // attribute INSIDE the enclosing POU (D4j), reached through `MoveMember`, and rewriting `Folder` on
        // one makes the member unfindable under its parent.
        if (FindOrNull(item) is { IsTopLevel: true } moving)
            _items[_items.IndexOf(moving)] = moving with { Folder = targetPath };

        // The vendor that places a member by re-importing its POU leaves every handle into that POU dead. Bumping
        // the generation LAST means this call's own arguments were still valid.
        if (InvalidatesHandlesOnMove) _generation++;
    }
    /// <summary>Accept the rename call and DO NOTHING — an IDE that no-ops a rename it cannot perform.
    ///
    /// <para>Neither shipping vendor behaves this way for a case-only rename (both were measured performing
    /// one), but the apply path cannot VERIFY that by finding the item: the re-find is case-insensitive, so it
    /// resolves the old spelling either way. This models the state that check exists to catch.</para></summary>
    public bool IgnoreRenames { get; init; }

    public void Rename(ItemRef item, string newName)
    {
        var old = NameOf(item);
        Recorded.Add($"rename:{old}->{newName}");
        if (IgnoreRenames) return;
        var idx = _items.FindIndex(i => i.Name == old);
        var escaped = System.Text.RegularExpressions.Regex.Escape(old);
        var word = new System.Text.RegularExpressions.Regex($@"\b{escaped}\b");
        // So a follow-up Lookup(newName) resolves — and the item's OWN HEADER names it anew, and nothing else of its text
        // does. Measured live 2026-10-04 (CODESYS SP21, openspec `push-partially-applied-flag` 3.1 and gate 3,
        // `push-partially-applied.test.ts` "a native rename's rewrite of the item's own text"): the header line is
        // rewritten (`FUNCTION F_Old` -> `FUNCTION F_New`), so the item's version changes with it — a fake that kept the
        // old header hid that every rename+edit was refused STALE_ITEM_VERSION after the rename had run. A leading comment
        // naming the item, a comment in the body, a FUNCTION's return assignment (`F_Old := …`) and a self-reference in
        // the declaration (`POINTER TO FB_Old`) all KEEP the old name. (The first version of this rewrote the first
        // whole-word match, unmeasured — a leading comment in place of the header.)
        var header = new System.Text.RegularExpressions.Regex(
            $@"^(\s*(?:FUNCTION_BLOCK|FUNCTION|PROGRAM|INTERFACE|TYPE)\b(?:\s+(?:PUBLIC|PRIVATE|PROTECTED|INTERNAL|ABSTRACT|FINAL))*\s+){escaped}\b",
            System.Text.RegularExpressions.RegexOptions.Multiline);
        if (idx >= 0)
            _items[idx] = _items[idx] with
            {
                Name = newName,
                Declaration = _items[idx].Declaration is { } d ? header.Replace(d, m => m.Groups[1].Value + newName, 1) : null,
            };
        // TwinCAT measured otherwise for the rest of the item (DIALECT C2o): it ALSO rewrites the item's own code
        // references — the return assignment, the self-pointer — and still no comment.
        if (idx >= 0 && RewritesOwnReferencesOnRename)
            _items[idx] = _items[idx] with
            {
                Declaration = _items[idx].Declaration is { } d2 ? OutsideLineComments(d2, s => word.Replace(s, newName)) : null,
                Implementation = _items[idx].Implementation is { } b ? OutsideLineComments(b, s => word.Replace(s, newName)) : null,
            };
        if (!RewritesReferencesOnRename) return;
        for (var k = 0; k < _items.Count; k++)
            if (k != idx && _items[k] is { } other)
                _items[k] = other with
                {
                    Declaration = other.Declaration is null ? null : word.Replace(other.Declaration, newName),
                    Implementation = other.Implementation is null ? null : word.Replace(other.Implementation, newName),
                };
    }

    /// <summary>Model the IDE's NATIVE rename rewriting every reference to the renamed item in OTHER items (both
    /// vendors do, which is why a push renames natively and why its receipt is a fresh walk: the referencing items'
    /// versions change outside the op set). Opt-in; whole-word, in declarations and bodies.</summary>
    public bool RewritesReferencesOnRename { get; init; }

    /// <summary>The TwinCAT shape of a native rename's effect on the renamed item ITSELF (DIALECT C2o, measured live
    /// 2026-10-04): beyond the header, every code reference to the item in its own text is rewritten — a FUNCTION's
    /// return assignment, a <c>POINTER TO</c> itself — and no comment is. Unset is the CODESYS shape: the header only.</summary>
    public bool RewritesOwnReferencesOnRename { get; init; }

    /// <summary>Apply <paramref name="rewrite"/> to each line's code, leaving a trailing <c>//</c> comment as it is.</summary>
    private static string OutsideLineComments(string text, Func<string, string> rewrite) =>
        string.Join("\n", text.Split('\n').Select(line =>
            line.IndexOf("//", StringComparison.Ordinal) is var at and >= 0 ? rewrite(line[..at]) + line[at..] : rewrite(line)));

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

    /// <summary>The push's own declarations each <see cref="NetworkScopeFor"/> call was handed, in order — one call per
    /// network body the push reads (openspec <c>bridge-refusal-review</c> D8: the pre-flight builds each body's scope once,
    /// and the scope travels to the write with its model, so this is where a push's sibling declarations reach a body).</summary>
    public List<Volt.Engine.Ide.PushedDeclarations> ScopesPushed { get; } = new();

    /// <summary>The network bodies each <see cref="WriteContent"/> was handed, by item name.</summary>
    public Dictionary<string, IReadOnlyList<Volt.Engine.Ide.PushedNetworkBody>> WrittenBodies { get; } = new();

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

    /// <summary>Called at the top of every <see cref="ReadContent"/>, so a test can mutate the project
    /// mid-push and exercise the last-moment guards. See the comment inside.</summary>
    public Action<FakeIde, ItemRef>? OnReadContent { get; set; }

    /// <summary>Replace one item's implementation text, in place — the engineer's edit, expressed. `Item` is
    /// an immutable record, so this swaps the record rather than mutating it, which is also what keeps every
    /// handle (`ItemRef` resolves by NAME here) pointing at the new one.</summary>
    public void EditImplementation(string bareName, string impl)
    {
        var i = _items.FindIndex(x => x.Name == bareName);
        if (i < 0) throw new InvalidOperationException($"FakeIde has no item '{bareName}'");
        _items[i] = _items[i] with { Implementation = impl };
    }

    public ItemContent ReadContent(ItemRef item)
    {
        // NOT recorded in `Recorded`, deliberately. That list is asserted as an exact SEQUENCE by the transport
        // matrix, whose subject is which WRITE interactions a push makes — the old fake did not record ReadXml
        // either. Reads are counted instead, so a caller that wants to know the read cost still can.
        ReadCount++;
        // THE SEAM A RACE NEEDS. A push hashes the project, resolves conflicts and applies every earlier op
        // before it writes — on a real vendor the IDE stays interactive throughout, so an engineer can edit the
        // item being written inside that window. Nothing offline can express that without a hook, and the
        // guards that exist to catch it are therefore untestable without one. Fires on every read; a test that
        // wants the Nth counts with `ReadCount`.
        OnReadContent?.Invoke(this, item);
        var it = Find(item);
        if (it.UnreadableReason is { } why)
            throw new InvalidOperationException($"'{it.Name}': {why}");
        return new ItemContent(
            KindOf(it),
            it.Declaration ?? "",
            BodyTextOf(it),
            MembersOf(it).ToList(),
            UnsupportedOf(it),
            StatedOf(it));
    }

    /// <summary>The item's kind, from its DECLARATION HEADER where it has one.
    /// <para>A real driver has an authoritative kind code from the IDE; a fixture does not, and most of them are
    /// built with the <c>TextualPou</c> helper, which stamps every item <c>program</c> regardless of what its
    /// declaration says. Reading the header keeps those fixtures meaning what they read as — a
    /// <c>FUNCTION_BLOCK FB_A</c> materializes as <c>FB_A.pou</c> — which is also what the document-based read
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

    /// <summary>An item's KIND, from its TREE CODE — never from its declaration text.
    ///
    /// <para>This used to parse the declaration's header and fall back to the code, which made the fake perform
    /// a transformation NEITHER driver performs: both take the kind from the tree
    /// (<c>ItemKind.Map(KindCode(item))</c>) and refuse when it does not map. A fake that re-types an item from
    /// the text it was just handed reports whatever a push asserted — so a push rewriting `FUNCTION_BLOCK X`
    /// as `PROGRAM X` reads back as a program and every offline test agrees with it, while a real IDE still
    /// holds a function block. A fake must store raw and derive nothing its driver does not; deriving MORE is
    /// how it invents agreement.</para></summary>
    private static string KindOf(Item it) =>
        ItemKind.Map(it.KindCode)
        ?? throw new System.InvalidOperationException($"FakeIde: unmapped item code {it.KindCode} for '{it.Name}'");

    /// <summary>An item's body AS A DRIVER WOULD RETURN IT. A language Volt cannot author has no text form, so
    /// a real driver materializes it as its UNSUPPORTED line (<c>IMPLEMENTATION CFC UNSUPPORTED</c>, and <c>IMPLEMENTATION LD
    /// UNSUPPORTED</c> for a network body the text cannot represent); a fake that returned the raw stored text instead
    /// would let a textual push sail past the body-format guard here and be refused only against a live IDE.
    /// <para><c>BodyLang</c> models what the IDE holds. It is deliberately NOT the same thing as the body text:
    /// that separation is exactly what the guard exists to check.</para></summary>
    private static string? BodyTextOf(Item it) => BodyOf(it).Body;

    /// <summary>Why a body the fake returns as <c>IMPLEMENTATION LD|FBD UNSUPPORTED</c> is hidden — what a driver
    /// hands up with it — and null for every other body.</summary>
    private static string? UnsupportedOf(Item it) => BodyOf(it).Unsupported;

    /// <summary>The language the body's line states, as the drivers hand it up beside the text (openspec
    /// <c>bridge-refusal-review</c> D6) — null exactly where there is no body text.</summary>
    private static StatedLanguage? StatedOf(Item it) => BodyOf(it).Stated;

    /// <summary>The body and, for a hidden LD or FBD body, why — read as both drivers read one: every LD and FBD body
    /// through <see cref="Volt.Engine.Format.Network.NetworkText.Pulled"/>, so the production switch and a refusal
    /// (<c>Unsupported</c>, what a driver's reader or writer raises as <c>UnrepresentableBodyException</c>) reach the
    /// fake exactly as they reach a vendor.</summary>
    private static (string? Body, string? Unsupported, StatedLanguage? Stated) BodyOf(Item it)
    {
        // No `BodyLang` is ST — or a network body this fake stored from a push, which it keeps as its network text
        // (`WriteContent` records no language). ST goes up the drivers' ST arm: a keyword-shaped line in it is refused.
        if (it.BodyLang is not { } lang)
        {
            if (it.Implementation is not { } text) return (null, null, null);
            if (Volt.Engine.Format.Network.NetworkText.LanguageOf(text) is { } stored)
                return Pulled(stored, () => text);
            return (Volt.Engine.Format.St.ImplementationMarker.RequireStBody(text), null, StatedLanguage.St);
        }
        // A language Volt cannot author has no text form at all.
        if (!Volt.Engine.Format.Body.Languages.IsNetwork(lang))
            return (Volt.Engine.Format.St.ImplementationMarker.Unsupported(lang), null, StatedLanguage.HiddenIn(lang));
        // An FBD/LD body comes back as NETWORK TEXT. A fixture that sets BodyLang but stores plain text is
        // describing "the IDE holds a diagram", so render one — returning the raw text would make a graphical
        // body look textual to the format guard, and the guard would wave through the very overwrite it exists
        // to stop.
        return Pulled(lang, () =>
        {
            if (it.Unsupported is { } why) throw new Volt.Engine.Format.Body.UnrepresentableBodyException(why, why);
            var impl = it.Implementation ?? "";
            return Volt.Engine.Format.Network.NetworkText.Is(impl)
                ? impl
                : $"{Volt.Engine.Format.St.ImplementationMarker.For(lang)}\nNETWORK\n  {impl.Trim()}\nEND_NETWORK\n";
        });
    }

    private static (string? Body, string? Unsupported, StatedLanguage? Stated) Pulled(string lang, Func<string> read) =>
        Volt.Engine.Format.Network.NetworkText.Pulled(
            Volt.Engine.Format.Network.NetworkText.LanguageNamed(lang)
                ?? throw new InvalidOperationException($"FakeIde: '{lang}' is no network-text language"),
            read);

    /// <summary>The scope a graphical body resolves against, built as both drivers build it
    /// (<see cref="Volt.Engine.Ide.ProjectDeclarations"/>) — fresh on every call, because a test edits the fake's
    /// items between calls and a driver-lifetime cache would answer for the item before the edit.</summary>
    public Volt.Engine.Format.Network.NetworkScope NetworkScopeFor(string? declaration,
                                                                   Volt.Engine.Ide.PushedDeclarations pushedDeclarations)
    {
        ScopesPushed.Add(pushedDeclarations);
        return new Volt.Engine.Ide.ProjectDeclarations(this, r => DeclarationsRead?.Invoke(r) ?? Find(r).Declaration,
                n => RefusedName(ItemKind.Kinds.Pou, n) is not null).ScopeFor(declaration, pushedDeclarations);
    }

    /// <summary>Stands in for the vendor's read of another item's declaration while a scope is built — set it to throw,
    /// and a write that still builds a scope of its own (a second reading of the body, D8) fails loud.</summary>
    public Func<ItemRef, string?>? DeclarationsRead { get; set; }

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
                string.IsNullOrEmpty(child.Folder) ? null : child.Folder,
                AccessorOf(child, ItemKind.PlcPropGet, ItemKind.PlcItfPropGet),
                AccessorOf(child, ItemKind.PlcPropSet, ItemKind.PlcItfPropSet),
                Unsupported: UnsupportedOf(child),
                Stated: StatedOf(child));
        }
    }

    /// <summary>A property's GET or SET, from the property's own children — or null when it has none.
    ///
    /// <para><b>The fake modelled no accessors at all</b>, so every property came back with null Getter and
    /// Setter however its children were declared. That is not a small omission: it made the whole accessor READ
    /// path untestable offline, and it is why `AccessorDeclaration.Keep` could silently drop the empty
    /// `VAR`/`END_VAR` block CODESYS really holds (~320 getters in one corpus) with 600 tests green. A fake that
    /// cannot express a field cannot fail on it.</para>
    ///
    /// <para>Goes through the same <see cref="AccessorDeclaration.Keep"/> the drivers use, so the fake agrees
    /// with them about when a declaration EXISTS rather than having a second opinion.</para>
    ///
    /// <para>Both codes of the role: CODESYS classifies an interface accessor as the POU code (613/614), TwinCAT as
    /// 654/655 — and <c>BeckhoffDriver</c> reads 654/655 as the accessor. The fake knew only 613/614, so a TwinCAT-shaped
    /// interface accessor vanished from the read here while the real driver renders it (openspec
    /// <c>directed-library-signatures</c> gate step 2).</para></summary>
    private Accessor? AccessorOf(Item property, int pouAccessorKind, int interfaceAccessorKind)
    {
        foreach (var name in property.Children ?? System.Array.Empty<string>())
        {
            var acc = FindOrNull(Ref(name));
            if (acc is null || (acc.KindCode != pouAccessorKind && acc.KindCode != interfaceAccessorKind)) continue;
            return new Accessor(AccessorDeclaration.Keep(acc.Declaration), BodyTextOf(acc), UnsupportedOf(acc), StatedOf(acc));
        }
        return null;
    }

    /// <summary>A write brings its members into existence, because that is what the real one does: afterwards a
    /// POU's methods and properties ARE children of it and can be read and written. The fake used to record the
    /// document and nothing else, so a member added by a push was invisible to any later tree walk — which made
    /// the member transport untestable offline, and would have let "the member cannot be found after its own
    /// write" pass here and fail live.</summary>
    /// <summary>Make the next content write FAIL, the way a vendor's own import can.
    ///
    /// <para>A refusal that only a live IDE can produce still has consequences the engine owns — a create that
    /// is refused mid-write must roll back, and that rule is testable offline only if the write can be made to
    /// refuse. Set to the exception to throw; left null, this fake behaves exactly as before.</para>
    ///
    /// <para>An explicit hook rather than a subclass: <c>FakeIde</c> is sealed on purpose, so that every test
    /// shares ONE model of the drivers and cannot quietly grow a second by overriding a member.</para></summary>
    public Func<ItemRef, Exception?>? RefuseContentWrite { get; init; }

    /// <summary>Model CODESYS taking a POU's kind from the TEXT written to it (DIALECT C2f, measured 2026-09-30): the
    /// declaration written decides the item's new tree code, or null to keep it. Opt-in, because TwinCAT does not do
    /// it (it keeps the tree kind) and the default fake is the one that derives nothing (<see cref="KindOf"/>).</summary>
    public Func<string, int?>? RetypesFromDeclaration { get; init; }

    /// <summary>Is this item in the project? For assertions about what a failed push LEFT BEHIND, which is not
    /// visible through any transport the fake records.</summary>
    public bool Exists(string bareName) => _items.Any(i => i.Name == bareName);

    /// <summary>The class label (<see cref="Item.Class"/>) of the item called <paramref name="bareName"/> — null for the
    /// plain class, and for an item that is not there.</summary>
    public string? ClassOf(string bareName) => _items.SingleOrDefault(i => i.Name == bareName)?.Class;

    /// <summary>The body the IDE STORES for an item — its own bytes, not what a read materializes from them. A body Volt
    /// does not show reads back as its UNSUPPORTED line whatever the fake stores, so "the push never wrote it" is only
    /// visible here.</summary>
    public string? StoredImplementation(string bareName) => _items.Single(i => i.Name == bareName).Implementation;

    public void WriteContent(ItemRef item, ItemContent content,
                             IReadOnlyList<Volt.Engine.Ide.PushedNetworkBody> bodies)
    {
        if (RefuseContentWrite?.Invoke(item) is { } refusal) throw refusal;

        var name = NameOf(item);
        Recorded.Add($"writecontent:{name}");
        WrittenContent[name] = content;
        // RECORDED: the models this write is handed, each with the scope the pre-flight read it against (D8). A write
        // takes a network body from here and from nowhere else — exactly as both drivers do.
        WrittenBodies[name] = bodies;

        var owner = FindOrNull(item);
        if (owner is not null)
            _items[_items.IndexOf(owner)] = owner with
            {
                KindCode = RetypesFromDeclaration?.Invoke(content.Declaration) ?? owner.KindCode,
                Declaration = content.Declaration,
                Implementation = Held(Volt.Engine.Format.St.ImplementationMarker.Written(content.Body), bodies,
                                      Volt.Engine.Ide.BodySite.Item) ?? owner.Implementation,
                // A WRITTEN body is held as written, in the language written (a POU's body may change language where
                // the driver writes it: `RefusesLanguageChange`, openspec bridge-refusal-review D7). A body not written
                // (none, or its UNSUPPORTED line) keeps the IDE's language and why it is hidden.
                BodyLang = Volt.Engine.Format.St.ImplementationMarker.Written(content.Body) is null ? owner.BodyLang : null,
                Unsupported = Volt.Engine.Format.St.ImplementationMarker.Written(content.Body) is null ? owner.Unsupported : null,
                // The member SET is not this call's to change: `CreateChild` adds a member and `Delete` removes one,
                // as on both drivers, and a member absent from `content` is one the push LEFT ALONE (PushService's
                // `OnlyChanged` drops the unchanged). Replacing the list with the written members made every
                // untouched member vanish from the fake after an ordinary push.
                Children = (owner.Children ?? System.Array.Empty<string>())
                    .Concat(content.Members.Select(m => m.Name)
                        .Where(n => owner.Children?.Contains(n, StringComparer.OrdinalIgnoreCase) != true))
                    .ToArray(),
            };

        foreach (var m in content.Members)
        {
            var existing = FindOrNull(Ref(m.Name));

            // THE FOLDER COMES FROM THE PROJECT, NEVER FROM THE PUSHED CONTENT. Taking it from `m.Folder` made
            // the fake PERFORM the relocation a driver does not do — so a member's folder change looked applied
            // when nothing had applied it, and an audit finding ("a member moved between folders is accepted and
            // never re-placed") passed green against a fake that asserted the bug away. Placement changes only
            // through `Move`, which is what the real IDEs require too.
            var folder = existing?.Folder ?? m.Folder ?? "";
            // An UNSUPPORTED body is never written — both drivers skip it and write the declaration alone — so the
            // member keeps the body the IDE holds (its language, and what made it UNSUPPORTED).
            var member = existing is not null && Volt.Engine.Format.St.ImplementationMarker.IsUnsupportedBody(m.Body)
                ? existing with { KindCode = KindCodeOf(m.Kind), Folder = folder, Declaration = m.Declaration }
                : new Item(m.Name, KindCodeOf(m.Kind), folder, false, m.Declaration,
                           Held(m.Body, bodies, new Volt.Engine.Ide.BodySite(m.Name, m.Kind, null)),
                           null, null) { Class = existing?.Class };   // written in place: the class is kept (C2l)
            if (existing is null) _items.Add(member);
            else _items[_items.IndexOf(existing)] = member;
        }

        // Bumped LAST, so this call's own handle was still valid.
        if (InvalidatesHandlesOnWrite) _generation++;
    }

    /// <summary>A written body AS THE IDE HOLDS IT. A real IDE stores a graphical body as its MODEL — the drivers read
    /// the pushed network text into one and build the vendor's objects from it — so what a read gives back is the
    /// model materialized, in the canonical layout, whatever layout was pushed (network text compares TOKENS, so a
    /// hand-wrapped call is accepted). Storing the pushed bytes instead would make this fake hold a text no IDE
    /// holds, and hide the one case the CLI's post-push adoption exists for. Any other body is stored as sent.</summary>
    private string? Held(string? body, IReadOnlyList<Volt.Engine.Ide.PushedNetworkBody> bodies, Volt.Engine.Ide.BodySite site)
    {
        // The MODEL the pre-flight validated, never the text read again (D8) — a network body with none is Volt's bug,
        // and the lookup refuses it naming the site, as both drivers' writes do.
        if (Volt.Engine.Ide.PushedNetworkBody.At(bodies, site, body) is not { } graph) return body;
        var held = Volt.Engine.Format.Network.NetworkTextWriter.Write(graph.Model, graph.Scope).TrimEnd('\n');
        return RematerializeAs is null ? held : RematerializeAs(held);
    }

    /// <summary>Model a driver whose IDE holds a written graphical body as OTHER TOKENS than were pushed — a pin the
    /// build dropped, an ENO the vendor added. Null (the default) is an IDE that holds exactly the pushed model.</summary>
    public Func<string, string>? RematerializeAs { get; init; }

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
    public override string? IdeVersion => Version;
    /// <summary>The IDE version this double reports. "0" unless a test names one.</summary>
    public string? Version { get; init; } = "0";
    /// <summary>The product identity this double's IDE states (<c>health.productName/productVersion/productVendor</c>)
    /// — null (the default) is an IDE that states none.</summary>
    public string? IdeProductName { get; init; }
    public string? IdeProductVersion { get; init; }
    public string? IdeProductVendor { get; init; }
    public override string? ProductName => IdeProductName;
    public override string? ProductVersion => IdeProductVersion;
    public override string? ProductVendor => IdeProductVendor;
    /// <summary>What this double's IDE lacks, as the driver's fixed refusal text — null (the default) when it has
    /// everything the bridge needs. See <c>IIdeSession.Unsupported</c>.</summary>
    public string? UnsupportedReason { get; init; }
    public override string? Unsupported => UnsupportedReason;
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
        return new HealthResponse { Projects = rows, NetworkText = Volt.Engine.Format.Network.NetworkTextSwitch.Enabled };
    }
    /// <summary>Whether an op exception counts as a transient the host should self-heal — the filter on
    /// <c>BridgePipeHost.RunRead</c>'s mark-degraded → Recover → retry-once branch. Default false: today's answer, and
    /// CODESYS's in-proc answer. Settable so that branch stops being unreachable under test.</summary>
    public bool TransientErrorsAreDegraded { get; init; }
    public override bool ShouldMarkDegraded(Exception ex) => TransientErrorsAreDegraded;
    /// <summary>Every call marshalled to the IDE thread throws this instead of running — the shape of a member that
    /// fails to bind at call time (the 3.5.17 <c>MissingMethodException</c>), which surfaces on the call, uncoded
    /// (openspec ide-identity-report 3.1).</summary>
    public Func<Exception>? CallFault { get; set; }
    /// <summary>The fake's one IDE thread. <c>DriverBase.RunOnStaThread</c> wraps every call to this with the
    /// in-flight/freshness bracketing, so the fake gets the real liveness signals for free.</summary>
    protected override T MarshalToIdeThread<T>(Func<T> fn)
    {
        if (CallFault is { } fault) throw fault();
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

    /// <summary>The build-side call SEQUENCE, in its own list rather than <see cref="Recorded"/> so the tests
    /// that assert over that list are unaffected. It exists because ORDER is the contract here: a build reads
    /// what is on disk, so `FlushPendingWrites` has to run BEFORE it or the compile misses the writes the same
    /// push just made — and a no-op flush made that unobservable.</summary>
    public List<string> BuildSequence { get; } = new();

    public override void FlushPendingWrites() => BuildSequence.Add("flush");

    // ── build knob: default to a clean build; a test sets BuildSucceeds=false + BuildDiagnostics to model errors ──
    public bool BuildSucceeds { get; init; } = true;
    public IReadOnlyList<BridgeDiagnostic> BuildDiagnostics { get; init; } = new List<BridgeDiagnostic>();

    /// <summary>Make the IDE's build THROW rather than return false. The two are different worlds and the
    /// service treats them differently: a false build is a compile failure carrying diagnostics, a throw is the
    /// IDE itself faulting — and the second must not be reported as the first without saying so.</summary>
    public bool BuildThrows { get; init; }

    public override bool Build()
    {
        BuildSequence.Add("build");
        if (BuildThrows) throw new InvalidOperationException("the IDE's compiler faulted");
        return BuildSucceeds;
    }
    /// <summary>A COPY per call, because that is the contract (see <c>IIdeSession.GetBuildDiagnostics</c>): the
    /// caller rewrites <c>Name</c> in place, and handing out the test's own list would let one build's promotion
    /// leak into the next — a fake that hid the very aliasing the contract exists to prevent.</summary>
    public override IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics() =>
        BuildDiagnostics.Select(d => new BridgeDiagnostic
        {
            Name = d.Name, Member = d.Member, Code = d.Code, Severity = d.Severity, Message = d.Message, Line = d.Line,
            Column = d.Column,
        }).ToList();

    /// <summary>Library element signatures the fetch's verbose fold will render + fold under each owning
    /// library's folder(s). Set per-test; empty by default. Settable after construction, so a test can model the
    /// IDE dropping a library reference between two pulls.</summary>
    public IReadOnlyList<LibSignature> LibSignatures { get; set; } = new List<LibSignature>();
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
