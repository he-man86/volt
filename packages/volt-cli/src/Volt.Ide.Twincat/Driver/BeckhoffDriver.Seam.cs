using System.Collections.Generic;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.St;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Seam;

namespace Volt.Ide.Twincat;

/// <summary>Beckhoff driver — the contract's tree and store words (<see cref="IVendorTree"/>, <see cref="IVendorStore"/>)
/// over this host's own IEC tree and record: its codes answer through the IEC tables' own conversions
/// (<see cref="ItemKind.ClassOf"/>, <see cref="ItemKind.CreateCode"/>), its record through <see cref="FamilyContent"/>.</summary>
public sealed partial class BeckhoffDriver
{
    /// <summary>This host's vendor as the wire names it — the id its pipe and the binding carry
    /// (<c>volt.bridge.twincat.&lt;pid&gt;</c>) and the name a person reads. The host's own fact: nothing above it names
    /// a vendor.</summary>
    public static readonly VendorRow Row = new("twincat", "TwinCAT");

    /// <summary>What TwinCAT states about itself: the IEC format's kinds and keys, the six body languages — LD and FBD
    /// read against the scopes this host builds (<see cref="NetworkScopeFor"/>).</summary>
    public VendorDeclaration Declaration => _declaration ??= new VendorDeclaration(
        Row,
        IecFormat.KindRows,
        new[]
        {
            LanguageRow.Shown(Languages.St, PlainTextReader.Instance),
            LanguageRow.Shown(Languages.Ld, new NetworkBodyReader(Languages.Ld, NetworkScopeFor)),
            LanguageRow.Shown(Languages.Fbd, new NetworkBodyReader(Languages.Fbd, NetworkScopeFor)),
            LanguageRow.Hidden(Languages.Cfc), LanguageRow.Hidden(Languages.Sfc), LanguageRow.Hidden(Languages.Il),
        },
        IecFormat.PropertyKeys);

    private VendorDeclaration? _declaration;

    /// <summary>This host's own catalog: its declaration alone, as the engine holds it (<c>HostLink.Catalog</c>).</summary>
    private Catalog Catalog => _catalog ??= Catalog.Of(Declaration);
    private Catalog? _catalog;

    // ── tree ──
    public HostWalk Walk(WalkObserver? observer = null) => WalkItems(observer).ToHostWalk();
    public ItemRef Root => GetTreeRoot();
    public IReadOnlyList<ItemRef> Children(ItemRef node) => new IndexedChildren(ChildCount(node), i => ChildAt(node, i));
    public NodeClass Classify(ItemRef node) => ItemKind.ClassOf(KindCode(node));
    public ItemRef CreateFolder(ItemRef parent, string name) => CreateChild(parent, name, ItemKind.PlcFolder, null, null);

    public ItemRef CreateChild(ItemRef parent, string name, string kind, CreateArgs args) =>
        CreateChild(parent, name, ItemKind.CreateCode(kind), FamilyContent.SeedOf(args), FamilyContent.ClassOf(args.Class));

    // ── store ──
    public Content Read(ItemRef item) => FamilyContent.Folded(ReadContent(item));

    public void Write(ItemRef item, Content content, IReadOnlyList<PushedBody> bodies) =>
        WriteContent(item, FamilyContent.ToItemContent(content), PushedNetworkBody.Of(bodies));

    // ── the pre-flight ──

    /// <summary>The graphical-create writer's refusals (<see cref="ValidateSource(ItemRef?, IReadOnlyList{PushedNetworkBody})"/>)
    /// are asked of an item's NETWORK bodies, and only when it carries one.</summary>
    public override void ValidateSource(ItemRef? existing, IReadOnlyList<PushedBody> bodies)
    {
        var network = PushedNetworkBody.Of(bodies);
        if (network.Count > 0) ValidateSource(existing, network);
    }

    public override string? RefusedMemberCreate(string memberKind, string name, CreateArgs args) =>
        RefusedMemberCreate(memberKind, name, FamilyContent.SeedOf(args));

    /// <summary>An INTERFACE property's accessors are refused by their text (<see cref="ValidateInterfaceAccessor"/>);
    /// no other accessor is.</summary>
    public override void ValidateAccessor(string memberKind, ContentAccessor pushed)
    {
        if (memberKind == ItemKind.Kinds.InterfaceProperty) ValidateInterfaceAccessor(FamilyContent.ToAccessor(pushed)!);
    }

    public override void ValidateProperties(string what, PropertySet pushed, bool create) =>
        ValidateProperties(what, FamilyContent.ToObjectProperties(pushed), create);
}
