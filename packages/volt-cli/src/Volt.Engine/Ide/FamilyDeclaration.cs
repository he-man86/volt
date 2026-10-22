using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Volt.Engine.Seam;

namespace Volt.Engine.Ide;

/// <summary>
/// TRANSITIONAL (openspec <c>volt-cli-rework</c> step 5; each host states its own in step 6): what an OLD-contract host —
/// CODESYS, TwinCAT, <c>FakeIde</c> — declares on the new contract, read off the old tables it was built against, so there
/// is one source for them until the hosts move: <see cref="ItemKind"/>'s file table and shapes, the <c>%</c>-lines'
/// keys (<see cref="PropertyLines"/>) and the six body languages.
/// </summary>
public static class FamilyDeclaration
{
    /// <summary>The declaration of an old-contract host serving <paramref name="vendor"/>; its LD and FBD bodies are read
    /// against the scopes it builds (<paramref name="scopeFor"/>, the old <c>NetworkScopeFor</c>).</summary>
    public static VendorDeclaration For(string vendor, Func<string?, PushedDeclarations, NetworkScope> scopeFor) => new(
        new VendorRow(vendor, Vendors.Display(vendor)),
        Kinds,
        new[]
        {
            LanguageRow.Shown(Languages.St, PlainTextReader.Instance),
            LanguageRow.Shown(Languages.Ld, new NetworkBodyReader(Languages.Ld, scopeFor)),
            LanguageRow.Shown(Languages.Fbd, new NetworkBodyReader(Languages.Fbd, scopeFor)),
            LanguageRow.Hidden(Languages.Cfc), LanguageRow.Hidden(Languages.Sfc), LanguageRow.Hidden(Languages.Il),
        },
        PropertyKeys);

    private static readonly KindShape NoShape = new(Composite: false, MembersInside: false, Body: false, AccessorShape.None, Signature: false);

    /// <summary>Every kind the old table names: the four source kinds in the IEC layout, every descriptor (the task the
    /// one a push writes), and every member and accessor kind a tree node can be classified as.</summary>
    private static readonly IReadOnlyList<KindRow> Kinds =
        ItemKind.SourceKindExtensions.Select(x => KindRow.Source(x.Kind, x.Ext, ItemKind.ShapeOf(x.Kind), IecFormat.Instance))
            .Concat(ItemKind.ReferenceKindExtensions.Select(x =>
                KindRow.Descriptor(x.Kind, x.Ext, writable: ItemKind.WritableReferenceKinds.Contains(x.Kind))))
            .Concat(new[]
            {
                ItemKind.Kinds.Method, ItemKind.Kinds.Action, ItemKind.Kinds.Property, ItemKind.Kinds.InterfaceMethod,
                ItemKind.Kinds.InterfaceProperty, ItemKind.Kinds.PropertyGet, ItemKind.Kinds.PropertySet,
            }.Select(k => KindRow.Member(k, ItemKind.ShapeOf(k))))
            .Concat(new[]
            {
                ItemKind.Kinds.InterfacePropertyGet, ItemKind.Kinds.InterfacePropertySet, ItemKind.Kinds.Transition,
                ItemKind.Kinds.TaskCallReference,
            }.Select(k => KindRow.Member(k, NoShape)))
            .ToList();

    /// <summary>The <c>%</c>-lines' keys, each with its value's grammar.</summary>
    private static readonly IReadOnlyList<PropertyKey> PropertyKeys = new[]
    {
        new PropertyKey(PropertyLines.ClassKey, PropertyGrammar.Words),
        new PropertyKey(PropertyLines.ExcludeFromBuildKey, PropertyGrammar.Flag),
        new PropertyKey(PropertyLines.LinkAlwaysKey, PropertyGrammar.Flag),
        new PropertyKey(PropertyLines.ExternalKey, PropertyGrammar.Flag),
        new PropertyKey(PropertyLines.EnableSystemCallKey, PropertyGrammar.Flag),
        new PropertyKey(PropertyLines.OnlineChangeReserveKey, PropertyGrammar.Integer),
        new PropertyKey(PropertyLines.CompilerDefinesKey, PropertyGrammar.Text),
        new PropertyKey(PropertyLines.UndefineKey, PropertyGrammar.Text, Repeats: true),
        new PropertyKey(PropertyLines.CommentKey, PropertyGrammar.Text),
        new PropertyKey(PropertyLines.ParameterListKey, PropertyGrammar.Flag),
        new PropertyKey(PropertyLines.NetVarKey, PropertyGrammar.Words, Repeats: true),
        new PropertyKey(PropertyLines.FileLinkKey, PropertyGrammar.Words),
    };
}
