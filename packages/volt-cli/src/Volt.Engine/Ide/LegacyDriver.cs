using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.St;
using Volt.Engine.Format.Task;
using Volt.Engine.Item;
using Volt.Engine.Library;
using Volt.Engine.Seam;

namespace Volt.Engine.Ide;

/// <summary>
/// TRANSITIONAL — an OLD-contract host (<see cref="IIdeDriver"/>: CODESYS, TwinCAT, <c>FakeIde</c>) on the NEW contract
/// (openspec <c>volt-cli-rework</c> step 5, design "The old contract on the new one"), so the Engine above it speaks only
/// <see cref="IVendorDriver"/> while the hosts are untouched. Deleted in step 6, when each host implements the new
/// contract itself.
///
/// <para>Nothing here decides anything: each member answers what the old one answered, in the new contract's words. The
/// numeric kind codes stop here — <see cref="Classify"/> maps every code the old engine's predicates read, so the
/// engine's rules over <see cref="NodeClass"/> decide what they decided over codes — and so do the old record
/// (<see cref="FamilyContent"/>) and the network model (a <see cref="NetworkRead"/> becomes the old
/// <see cref="PushedNetworkBody"/>).</para>
///
/// <para>The SESSION composition (degraded state, IDE-thread bracketing, the health response) is the old host's own
/// (<see cref="DriverBase"/>) until step 6, so <see cref="ProjectRows"/> and <see cref="HealthProbeFloorMs"/> are never
/// asked of an adapted host: the engine's <c>HostLink</c> asks the host itself.</para>
/// </summary>
public sealed class LegacyDriver : VendorDriverBase, IVendorDriver
{
    private readonly IIdeDriver _old;

    /// <summary>The walk each <see cref="HostWalk"/> was made from, for the build's one walk to reach the old driver
    /// (<see cref="GetBuildDiagnostics"/>) as the walk it is.</summary>
    private readonly ConditionalWeakTable<HostWalk, WalkResult> _walks = new();

    public LegacyDriver(IIdeDriver old)
    {
        _old = old ?? throw new ArgumentNullException(nameof(old));
        Declaration = FamilyDeclaration.For(old.Vendor, old.NetworkScopeFor);
    }

    // ── session ──
    public VendorDeclaration Declaration { get; }
    public bool IsConnected => _old.IsConnected;
    public string Vendor => _old.Vendor;
    public string? ServedProjectName => _old.ServedProjectName;
    public string? IdeVersion => _old.IdeVersion;
    public string? ProductName => _old.ProductName;
    public string? ProductVersion => _old.ProductVersion;
    public string? ProductVendor => _old.ProductVendor;
    public string? Unsupported => _old.Unsupported;
    public string? NotServedBecause => _old.NotServedBecause;
    public void Disconnect() => _old.Disconnect();
    public bool ShouldMarkDegraded(Exception ex) => _old.ShouldMarkDegraded(ex);
    public void Recover() => _old.Recover();
    public T MarshalToIdeThread<T>(Func<T> fn) => _old.RunOnStaThread(fn);
    public IReadOnlyList<ProjectEntry> ProjectRows() => throw NotAsked(nameof(ProjectRows));
    public long HealthProbeFloorMs => throw NotAsked(nameof(HealthProbeFloorMs));
    public void SelectProject(ConnectRequest sel) => _old.SelectProject(sel);
    public bool Build(IReadOnlyCollection<string>? applications) => _old.Build(applications);

    public IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics(Func<HostWalk> walk) =>
        _old.GetBuildDiagnostics(() =>
        {
            var w = walk();
            return _walks.TryGetValue(w, out var raw)
                ? raw
                : throw new InvalidOperationException("the build's walk was not made by this host's Walk");
        });

    public IReadOnlyList<LibSignature> ExtractLibrarySignatures() => _old.ExtractLibrarySignatures();

    private static InvalidOperationException NotAsked(string member) =>
        new($"{member} is not asked of an old-contract host: its own DriverBase composes the session until step 6");

    // ── tree ──

    /// <summary>The old walk with its kinds as strings. An unmapped code and a container manager (a library, recipe or
    /// visualization manager: a folder, never an item) become no <see cref="WalkedItem"/> — the engine's backstop for
    /// both moved here, where the code still exists.</summary>
    public HostWalk Walk(WalkObserver? observer = null)
    {
        var raw = _old.WalkItems(observer);
        var items = new List<WalkedItem>(raw.Items.Count);
        foreach (var it in raw.Items)
        {
            if (ItemKind.Map(it.KindCode) is not { } kind)
            {
                VoltLog.Debug($"walk skip: unmapped-kind '{it.Name}' (kindCode={it.KindCode})");
                continue;
            }
            if (ItemKind.IsContainerManager(it.KindCode)) continue;
            items.Add(new WalkedItem(it.Name, it.Item, kind, it.Folder));
        }
        var walk = new HostWalk(items, raw.UnwalkedFolders, raw.UnreadableObjects, raw.Applications);
        _walks.Add(walk, raw);
        return walk;
    }

    public ItemRef Root => _old.GetTreeRoot();

    /// <summary>The children, read one by one AS THE ENGINE INDEXES THEM (the count first), exactly as the old engine
    /// read <c>ChildCount</c> and then <c>ChildAt</c>: a child the host names but must not open throws its
    /// <see cref="UnreadableItemException"/> at its index, and a fault reading one child is that child's.</summary>
    public IReadOnlyList<ItemRef> Children(ItemRef node) => new ChildList(_old, node, _old.ChildCount(node));

    private sealed class ChildList : IReadOnlyList<ItemRef>
    {
        private readonly IIdeDriver _old;
        private readonly ItemRef _node;
        public ChildList(IIdeDriver old, ItemRef node, int count) { _old = old; _node = node; Count = count; }
        public int Count { get; }
        public ItemRef this[int index] => _old.ChildAt(_node, index + 1);
        public IEnumerator<ItemRef> GetEnumerator() { for (var i = 0; i < Count; i++) yield return this[i]; }
        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    }

    public ItemRef Parent(ItemRef node) => _old.Parent(node);
    public string Name(ItemRef node) => _old.Name(node);

    /// <summary>Every code the old predicates read, as its role: a user folder; an application (an item can be placed in
    /// it); the Task Configuration (it takes tasks); a source item; a member or accessor of one; a task or a descriptor;
    /// a transient node; and every other node a container the walk descends by name.</summary>
    public NodeClass Classify(ItemRef node)
    {
        var code = _old.KindCode(node);
        return code switch
        {
            ItemKind.PlcFolder => NodeClass.Folder,
            ItemKind.Application => NodeClass.Container(holdsItems: true) with { Noun = Noun(code) },
            ItemKind.TaskConfig => NodeClass.Container(false, ItemKind.Kinds.Task) with { Noun = Noun(code) },
            ItemKind.Skip or ItemKind.Unknown => NodeClass.Skip with { Noun = Noun(code) },
            _ when ItemKind.IsTopLevelCrud(code) => NodeClass.Item(ItemKind.Map(code)!) with { Noun = Noun(code) },
            _ when ItemKind.IsContainerManager(code) => NodeClass.Container(false) with { Noun = Noun(code) },
            _ when ItemKind.IsInlinedInPou(code) && ItemKind.Map(code) is { } member => NodeClass.Member(member) with { Noun = Noun(code) },
            _ when ItemKind.Map(code) is { } kind => NodeClass.Item(kind) with { Noun = Noun(code) },
            _ => NodeClass.Container(false) with { Noun = Noun(code) },
        };
    }

    /// <summary>What a refusal calls a node that is no folder — the words the old engine named it by.</summary>
    private static string Noun(int code) => code switch
    {
        ItemKind.Device => "device node",
        ItemKind.PlcLogic => "PLC logic node",
        ItemKind.TaskConfig => "task configuration node",
        ItemKind.GenericContainer => "container node",
        _ => ItemKind.Map(code) is { } wire ? $"{wire} node" : $"tree node of item type {code}",
    };

    public bool HandlesSurviveStructureChange => _old.HandlesSurviveStructureChange;

    public ItemRef CreateFolder(ItemRef parent, string name) => _old.CreateChild(parent, name, ItemKind.PlcFolder, null, null);

    public ItemRef CreateChild(ItemRef parent, string name, string kind, CreateArgs args) =>
        _old.CreateChild(parent, name, CodeOf(kind), Seed(args), ClassOf(args.Class));

    /// <summary>The one code each kind is created as (design 5.Qa, S1): every POU as a function block and every DUT as a
    /// struct — the vendor takes the kind the TEXT declares (DIALECT C2f/C2g, C2h), and a function block accepts every
    /// member kind until the declaration says otherwise (C2k).</summary>
    internal static int CodeOf(string kind) => kind switch
    {
        ItemKind.Kinds.Pou => ItemKind.PlcPou,
        ItemKind.Kinds.Dut => ItemKind.PlcDut,
        ItemKind.Kinds.Gvl => ItemKind.PlcGvl,
        ItemKind.Kinds.Interface => ItemKind.PlcItf,
        ItemKind.Kinds.Task => ItemKind.PlcTask,
        ItemKind.Kinds.PropertyGet => ItemKind.PlcPropGet,
        ItemKind.Kinds.PropertySet => ItemKind.PlcPropSet,
        ItemKind.Kinds.InterfacePropertyGet => ItemKind.PlcItfPropGet,
        ItemKind.Kinds.InterfacePropertySet => ItemKind.PlcItfPropSet,
        _ => ItemKind.MemberCode(kind),
    };

    /// <summary>The ONE value the old create takes: a signature member's declared type, else the body language — null
    /// for ST, which the old hosts create by default.</summary>
    private static string? Seed(CreateArgs args) =>
        args.Signature ?? (args.Language == Languages.St ? null : args.Language);

    private static ObjectClass? ClassOf(string? spelled)
    {
        if (spelled is null) return null;
        var sp = spelled.IndexOf(' ');
        return sp < 0 ? new ObjectClass(spelled, null) : new ObjectClass(spelled.Substring(0, sp), spelled.Substring(sp + 1));
    }

    public void Delete(ItemRef parent, string name) => _old.Delete(parent, name);
    public void Rename(ItemRef node, string newName) => _old.Rename(node, newName);
    public void Move(ItemRef node, ItemRef target) => _old.Move(node, target);

    // ── store ──

    /// <summary>The old read, FOLDED as every engine read of it was (<see cref="AbstractMemberFold"/>).</summary>
    public Content Read(ItemRef item) => FamilyContent.ToContent(AbstractMemberFold.Apply(_old.ReadContent(item)));

    public void Write(ItemRef item, Content content, IReadOnlyList<PushedBody> bodies) =>
        _old.WriteContent(item, FamilyContent.ToItemContent(content), Network(bodies));

    /// <summary>The network bodies among the pushed ones, as the old record: the model and the scope it was read against.</summary>
    private static IReadOnlyList<PushedNetworkBody> Network(IReadOnlyList<PushedBody> bodies) =>
        bodies.Where(b => b.Model is NetworkRead).Select(b => (b.Site, Read: (NetworkRead)b.Model))
              .Select(x => new PushedNetworkBody(x.Site, x.Read.Model, x.Read.Scope)).ToList();

    public string ReadManifest(ItemRef item, string kind) => _old.ReadManifest(item, kind);
    public void WriteTask(ItemRef task, TaskSettings settings) => _old.WriteTask(task, settings);

    // ── the pre-flight ──
    public override void ValidateTask(TaskSettings settings) => _old.ValidateTask(settings);
    /// <summary>The old host was asked about the NETWORK bodies of an item, and only when it carried one.</summary>
    public override void ValidateSource(ItemRef? existing, IReadOnlyList<PushedBody> bodies)
    {
        var network = Network(bodies);
        if (network.Count > 0) _old.ValidateSource(existing, network);
    }

    /// <summary>The old host was asked about a POU's name and a member's, the kinds its words were measured on.</summary>
    public override string? RefusedName(string kind, string name) =>
        kind is ItemKind.Kinds.Gvl or ItemKind.Kinds.Dut or ItemKind.Kinds.Interface ? null : _old.RefusedName(kind, name);
    public override string? RefusedMemberCreate(string memberKind, string name, CreateArgs args) =>
        _old.RefusedMemberCreate(memberKind, name, Seed(args));

    /// <summary>The old host was asked about an INTERFACE property's accessors only.</summary>
    public override void ValidateAccessor(string memberKind, ContentAccessor pushed)
    {
        if (memberKind == ItemKind.Kinds.InterfaceProperty) _old.ValidateInterfaceAccessor(FamilyContent.ToAccessor(pushed)!);
    }

    public override void ValidateProperties(string what, PropertySet pushed, bool create) =>
        _old.ValidateProperties(what, FamilyContent.ToObjectProperties(pushed), create);

    public override string? RefusedLanguageChange(string site, string from, string to) => _old.RefusedLanguageChange(site, from, to);
}
