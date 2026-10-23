using System;
using System.Collections;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using Volt.Contracts;
using Volt.Engine.Format.St;
using Volt.Engine.Format.Task;
using Volt.Engine.Item;
using Volt.Engine.Library;
using Volt.Engine.Seam;

namespace Volt.Engine.Ide;

/// <summary>
/// TRANSITIONAL — an OLD-contract host (<see cref="IIdeDriver"/>: the test double <c>FakeIde</c>) on the NEW contract
/// (openspec <c>volt-cli-rework</c>, design "The old contract on the new one"), so the Engine above it speaks only
/// <see cref="IVendorDriver"/>. Deleted in step 7 with the old interfaces, when the double implements the new contract.
///
/// <para>Nothing here decides anything: each member answers what the old one answered, in the new contract's words,
/// through the IEC tables' own conversions (<see cref="ItemKind.ClassOf"/>, <see cref="ItemKind.CreateCode"/>,
/// <see cref="FamilyContent"/>, <see cref="PushedNetworkBody.Of"/>) — the ones the two shipped hosts call.</para>
///
/// <para>The SESSION composition (degraded state, IDE-thread bracketing, the health response) is the old host's own
/// (<see cref="DriverBase"/>), so <see cref="ProbeProjects"/> and <see cref="HealthProbeFloorMs"/> are never asked of an
/// adapted host: the engine's <c>HostLink</c> asks the host itself.</para>
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
    public ProjectProbe ProbeProjects() => throw NotAsked(nameof(ProbeProjects));
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
        new($"{member} is not asked of an old-contract host: its own DriverBase composes the session");

    // ── tree ──

    /// <summary>The old walk with its kinds as strings. An unmapped code and a container manager (a library, recipe or
    /// visualization manager: a folder, never an item) become no <see cref="WalkedItem"/>.</summary>
    public HostWalk Walk(WalkObserver? observer = null)
    {
        var raw = _old.WalkItems(observer);
        var walk = raw.ToHostWalk();
        _walks.Add(walk, raw);
        return walk;
    }

    public ItemRef Root => _old.GetTreeRoot();

    public IReadOnlyList<ItemRef> Children(ItemRef node) =>
        new IndexedChildren(_old.ChildCount(node), i => _old.ChildAt(node, i));

    public ItemRef Parent(ItemRef node) => _old.Parent(node);
    public string Name(ItemRef node) => _old.Name(node);
    public NodeClass Classify(ItemRef node) => ItemKind.ClassOf(_old.KindCode(node));
    public bool HandlesSurviveStructureChange => _old.HandlesSurviveStructureChange;

    public ItemRef CreateFolder(ItemRef parent, string name) => _old.CreateChild(parent, name, ItemKind.PlcFolder, null, null);

    public ItemRef CreateChild(ItemRef parent, string name, string kind, CreateArgs args) =>
        _old.CreateChild(parent, name, ItemKind.CreateCode(kind), FamilyContent.SeedOf(args), FamilyContent.ClassOf(args.Class));

    public void Delete(ItemRef parent, string name) => _old.Delete(parent, name);
    public void Rename(ItemRef node, string newName) => _old.Rename(node, newName);
    public void Move(ItemRef node, ItemRef target) => _old.Move(node, target);

    // ── store ──
    public Content Read(ItemRef item) => FamilyContent.Folded(_old.ReadContent(item));

    public void Write(ItemRef item, Content content, IReadOnlyList<PushedBody> bodies) =>
        _old.WriteContent(item, FamilyContent.ToItemContent(content), PushedNetworkBody.Of(bodies));

    public string ReadManifest(ItemRef item, string kind) => _old.ReadManifest(item, kind);
    public void WriteTask(ItemRef task, TaskSettings settings) => _old.WriteTask(task, settings);

    // ── the pre-flight ──
    public override void ValidateTask(TaskSettings settings) => _old.ValidateTask(settings);

    /// <summary>The old host was asked about the NETWORK bodies of an item, and only when it carried one.</summary>
    public override void ValidateSource(ItemRef? existing, IReadOnlyList<PushedBody> bodies)
    {
        var network = PushedNetworkBody.Of(bodies);
        if (network.Count > 0) _old.ValidateSource(existing, network);
    }

    /// <summary>The old host was asked about a POU's name and a member's, the kinds its words were measured on.</summary>
    public override string? RefusedName(string kind, string name) =>
        kind is ItemKind.Kinds.Gvl or ItemKind.Kinds.Dut or ItemKind.Kinds.Interface ? null : _old.RefusedName(kind, name);
    public override string? RefusedMemberCreate(string memberKind, string name, CreateArgs args) =>
        _old.RefusedMemberCreate(memberKind, name, FamilyContent.SeedOf(args));

    /// <summary>The old host was asked about an INTERFACE property's accessors only.</summary>
    public override void ValidateAccessor(string memberKind, ContentAccessor pushed)
    {
        if (memberKind == ItemKind.Kinds.InterfaceProperty) _old.ValidateInterfaceAccessor(FamilyContent.ToAccessor(pushed)!);
    }

    public override void ValidateProperties(string what, PropertySet pushed, bool create) =>
        _old.ValidateProperties(what, FamilyContent.ToObjectProperties(pushed), create);

    public override string? RefusedLanguageChange(string site, string from, string to) => _old.RefusedLanguageChange(site, from, to);
}
