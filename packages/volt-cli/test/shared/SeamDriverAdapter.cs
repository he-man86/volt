using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.St;
using Volt.Engine.Format.Task;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Library;
using Volt.Engine.Seam;

namespace Volt.Tests.Shared;

/// <summary>
/// TEST-ONLY: a new-contract host (<see cref="IVendorDriver"/>) seen through the OLD contract (<see cref="IIdeDriver"/>),
/// so the existing transport suite — <c>BridgePipeHost</c> and the old <c>Sync/</c> services — can drive a vendor that
/// speaks only the new one (openspec <c>volt-cli-rework</c> design step 4). The reverse of the step-5 adapter.
///
/// <para>It derives from <see cref="DriverBase"/> because the old engine composes health there; the host supplies only
/// the primitives (<see cref="IVendorSession.ProjectRows"/>, <see cref="IVendorSession.MarshalToIdeThread{T}"/>), which is
/// the new contract's split. The old numbers it must speak are confined to <see cref="KindCode"/> and
/// <see cref="CreateChild"/>: a folder is <c>PlcFolder</c>, a structural node an <c>Application</c> or a generic container,
/// and a declared kind its admitted synthetic code (<see cref="SeamAdmission"/>).</para>
/// </summary>
public sealed class SeamDriverAdapter : DriverBase, IIdeDriver
{
    private readonly IVendorDriver _host;
    private readonly Catalog _catalog;

    public SeamDriverAdapter(IVendorDriver host)
    {
        _host = host;
        _catalog = Catalog.Of(host.Declaration);
        SeamAdmission.Admit(_catalog, host.Vendor);
        RunOnStaThread(() => { SnapshotHealth(); return 0; });   // what a host's connect does: the rows show at once
    }

    // ── session: forwarded primitives; DriverBase composes the rest ──
    public override bool IsConnected => _host.IsConnected;
    public override string Vendor => _host.Vendor;
    public override string? ServedProjectName => _host.ServedProjectName;
    public override string? IdeVersion => _host.IdeVersion;
    public override string? ProductName => _host.ProductName;
    public override string? ProductVersion => _host.ProductVersion;
    public override string? ProductVendor => _host.ProductVendor;
    public override string? Unsupported => _host.Unsupported;
    public override string? NotServedBecause => _host.NotServedBecause;
    public override void Disconnect() => _host.Disconnect();
    public override bool ShouldMarkDegraded(Exception ex) => _host.ShouldMarkDegraded(ex);
    public override void Recover() => _host.Recover();
    protected override T MarshalToIdeThread<T>(Func<T> fn) => _host.MarshalToIdeThread(fn);
    protected override long ProbeThrottleMs => _host.HealthProbeFloorMs;
    protected override void SnapshotHealth() => PublishRows(_host.ProjectRows().ToList());
    public override void SelectProject(ConnectRequest sel) => _host.SelectProject(sel);
    public override bool Build(IReadOnlyCollection<string>? applications) => _host.Build(applications);
    public override IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics(Func<WalkResult> walk) =>
        _host.GetBuildDiagnostics(() => ToHostWalk(walk()));
    public override IReadOnlyList<LibSignature> ExtractLibrarySignatures() => _host.ExtractLibrarySignatures();
    public override string? RefusedLanguageChange(string site, string from, string to) => _host.RefusedLanguageChange(site, from, to);

    // ── tree ──
    public WalkResult WalkItems(WalkObserver? observer = null)
    {
        var w = _host.Walk(observer);
        return new WalkResult(w.Items.Select(i => new ProjectItem(i.Name, i.Item, SeamAdmission.CodeOf(i.Kind), i.Folder)).ToList(),
                              w.UnwalkedFolders, w.Unreadable, w.Applications);
    }

    private static HostWalk ToHostWalk(WalkResult w) =>
        new(w.Items.Select(i => new WalkedItem(i.Name, i.Item, ItemKind.Map(i.KindCode)!, i.Folder)).ToList(),
            w.UnwalkedFolders, w.UnreadableObjects, w.Applications);

    public ItemRef GetTreeRoot() => _host.Root;
    public int ChildCount(ItemRef item) => _host.Children(item).Count;
    public ItemRef ChildAt(ItemRef parent, int index1Based) => _host.Children(parent)[index1Based - 1];
    public ItemRef Parent(ItemRef item) => _host.Parent(item);
    public string Name(ItemRef item) => _host.Name(item);

    public int KindCode(ItemRef item)
    {
        var c = _host.Classify(item);
        return c.Role switch
        {
            NodeRole.Folder => ItemKind.PlcFolder,
            NodeRole.Container when c.Takes?.Contains(ItemKind.Kinds.Task) == true => ItemKind.TaskConfig,
            NodeRole.Container => c.HoldsItems ? ItemKind.Application : ItemKind.GenericContainer,
            NodeRole.Item or NodeRole.Member => SeamAdmission.CodeOf(c.Kind!),
            _ => ItemKind.Skip,
        };
    }

    public bool HandlesSurviveStructureChange => _host.HandlesSurviveStructureChange;

    public ItemRef CreateChild(ItemRef parent, string name, int kindCode, string? seed, ObjectClass? cls) =>
        kindCode == ItemKind.PlcFolder
            ? _host.CreateFolder(parent, name)
            : _host.CreateChild(parent, name, ItemKind.Map(kindCode)!, new CreateArgs(Language: seed, Class: cls?.ToString()));

    public (bool Get, bool Set) InterfacePropertyAccessors(ItemRef property) =>
        throw new NotSupportedException("the new contract has no such member: a property's accessors are its Children");

    public void Delete(ItemRef parent, string name) => _host.Delete(parent, name);
    public void Rename(ItemRef item, string newName) => _host.Rename(item, newName);
    public void Move(ItemRef item, ItemRef target) => _host.Move(item, target);

    // ── store ──
    public ItemContent ReadContent(ItemRef item) => AdmittedFormats.ToItemContent(_host.Read(item));

    /// <summary>Every SHOWN body read once by its language's registered reader — the new contract's push: bodies keyed by
    /// language, whatever the language. (The old engine hands a driver only its NETWORK bodies, already read.)</summary>
    public void WriteContent(ItemRef item, ItemContent content, IReadOnlyList<PushedNetworkBody> bodies)
    {
        var c = AdmittedFormats.ToContent(content);
        var pushed = new List<PushedBody>();
        if (c.Body is { Form: BodyForm.Shown } body)
            pushed.Add(new PushedBody(BodySite.Item, body.Language,
                _catalog.Languages.Reader(body.Language).Read(body.Code, BodyContext.Bare(c.Declaration))));
        _host.Write(item, c, pushed);
    }

    public string ReadManifest(ItemRef item, string kind) => _host.ReadManifest(item, kind);
    public void WriteTask(ItemRef task, TaskSettings settings) => _host.WriteTask(task, settings);
    public override void ValidateTask(TaskSettings settings) => _host.ValidateTask(settings);
    public override void ValidateSource(ItemRef? existing, IReadOnlyList<PushedNetworkBody> bodies) =>
        _host.ValidateSource(existing, Array.Empty<PushedBody>());
    public override string? RefusedName(string kind, string name) => _host.RefusedName(kind, name);
    public override string? RefusedMemberCreate(string memberKind, string name, string? seed) =>
        _host.RefusedMemberCreate(memberKind, name, new CreateArgs(Language: seed));
    public override void ValidateInterfaceAccessor(Accessor pushed) =>
        throw new NotSupportedException("an admitted vendor declares no interface member");
    public override void ValidateProperties(string what, ObjectProperties pushed, bool create) =>
        _host.ValidateProperties(what, pushed.Equals(ObjectProperties.None)
            ? PropertySet.Empty
            : throw new NotSupportedException($"{what}: the old closed property record reached an admitted vendor"), create);

    public NetworkScope NetworkScopeFor(string? declaration, PushedDeclarations pushedDeclarations) =>
        throw new InvalidOperationException("an admitted vendor reads no network text: its bodies go through its own language readers");
}
