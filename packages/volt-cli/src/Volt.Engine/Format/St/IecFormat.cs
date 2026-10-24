using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Seam;

namespace Volt.Engine.Format.St;

/// <summary>
/// THE IEC LAYOUT as a source kind's file format (design "New Ide/ contract": the layout is not the body language):
/// <c>PROGRAM … END_PROGRAM</c>, member blocks, the <c>%</c>-lines under each <c>IMPLEMENTATION</c> line — what
/// <see cref="StReader"/> reads and <see cref="StWriter"/> writes, over the layout's own record (<see cref="FamilyContent"/>).
/// The kinds of the CODESYS family name it in their rows (<c>pou</c>, <c>itf</c>, <c>gvl</c>, <c>dut</c>).
///
/// <para>A read is FOLDED (<see cref="AbstractMemberFold"/>), as a host's read is: an ABSTRACT member with no code is
/// <c>IMPLEMENTATION NONE</c>, whoever made it, so a file and the IDE agree on one text for one declaration.</para>
///
/// <para><see cref="Write"/> refuses what a pull must not write (openspec <c>push-without-header-check</c> 5.E.1, 5.Q.5,
/// <c>bridge-one-to-one</c> 3.5), naming the item: a member whose class and text disagree, a POU with no header, and a
/// file the push would not read back with the same members.</para>
/// </summary>
public sealed class IecFormat : IItemFormat
{
    public static readonly IecFormat Instance = new();
    private IecFormat() { }

    private static readonly KindShape NoShape = new(Members: false, Body: false, AccessorShape.None, Signature: false);

    /// <summary>The kind rows of a host whose tree answers <see cref="ItemKind"/>'s codes, read off its tables: the four
    /// source kinds in this layout, every descriptor (the task the one a push writes), and every member and accessor kind
    /// a tree node can be classified as. A host declares them (<c>VendorDeclaration</c>); the registry refuses two hosts
    /// spelling them apart.</summary>
    public static readonly IReadOnlyList<KindRow> KindRows =
        ItemKind.SourceKindExtensions.Select(x => KindRow.Source(x.Kind, x.Ext, ItemKind.ShapeOf(x.Kind), Instance))
            .Concat(ItemKind.ReferenceKindExtensions.Select(x =>
                KindRow.Descriptor(x.Kind, x.Ext, writable: !ItemKind.IsReadOnlyKind(x.Kind))))
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

    /// <summary>The <c>%</c>-lines' keys this layout writes, each with its value's grammar (<see cref="PropertyLines"/>).
    /// Whether a host HOLDS a key is its pre-flight's answer (<c>ValidateProperties</c>).</summary>
    public static readonly IReadOnlyList<PropertyKey> PropertyKeys = new[]
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

    public string Name => "iec";

    public Content Read(string text, string kind, string name, Catalog catalog, string vendor) =>
        FamilyContent.ToContent(AbstractMemberFold.Apply(StReader.Read(text, kind, name)));

    /// <summary>Through <see cref="StWriter.Lines"/> over the text read back, and only when that content writes this very
    /// text — anything else is no certain place.</summary>
    public int? LineOf(string text, string kind, string name, string? member, int objectLine)
    {
        ItemContent item;
        try { item = StReader.Read(text, kind, name); }
        catch (BridgeException) { return null; }
        if (!string.Equals(StWriter.Write(item), text, StringComparison.Ordinal)) return null;
        var found = StWriter.Lines(item).Where(o => member is null
            ? o.Member is null
            : string.Equals(o.Member, member, StringComparison.OrdinalIgnoreCase)).ToList();
        return found.Count == 1 ? found[0].LineOf(objectLine) : null;
    }

    public string Write(Content content, string name)
    {
        var item = FamilyContent.ToItemContent(content);
        RefuseMemberOfAnotherClass(name, item);
        RefuseHeaderless(name, item);
        var text = StWriter.Write(item);
        RefuseUnreadableBack(name, item, text);
        return text;
    }

    /// <summary>What a pull writes, a push reads back — WITH THE SAME MEMBERS. The IDE stores each member's text on its
    /// own; the push reads them back out of ONE file through the child splitter, which refuses a text it cannot split
    /// right (an END keyword after code on its line, text after an END keyword, a member keyword inside an open member).
    /// An IDE member whose stored text holds such a shape would be pulled into a file no push accepts, not even
    /// unchanged — and a comment one member leaves open and another closes reads as ONE comment in the file, swallowing
    /// the member between them, which the next push deletes. So the pull reads its own text back through the splitter
    /// (<see cref="StReader.SplitMembers"/> — the split alone, not what a body holds) and refuses the item unless it
    /// gets every member back as itself (kind and name): listed unreadable, the workspace file left alone (openspec
    /// <c>push-without-header-check</c> 5.E.1). 0 such items in the six corpora.</summary>
    private static void RefuseUnreadableBack(string name, ItemContent pulled, string text)
    {
        IReadOnlyList<Member> back;
        try { back = StReader.SplitMembers(text, pulled.Kind, name); }
        catch (BridgeException ex)
        {
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{name}': the file a pull would write does not read back on a push ({ex.Message}), so the item is not " +
                "pulled until its text is changed in the IDE.");
        }
        var got = back.Select(Label).ToList();
        foreach (var m in pulled.Members)
        {
            if (got.Remove(Label(m))) continue;
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{name}': its {Label(m)} does not read back from the file a pull would write (read back: " +
                $"{(back.Count == 0 ? "no members" : string.Join(", ", back.Select(Label)))}) — a comment " +
                "one member leaves open and another closes is one comment in the file. A push of it would delete that " +
                "member, so the item is not pulled until its text is changed in the IDE.");
        }
        if (got.Count > 0)
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{name}': the file a pull would write reads back with {string.Join(", ", got)}, which the IDE does not " +
                "hold, so the item is not pulled until its text is changed in the IDE.");

        static string Label(Member m) => $"{m.Kind.Replace('_', ' ')} '{m.Name}'";
    }

    /// <summary>A member's KIND is its CLASS — the driver reports it from the IDE object (a method, a property, an
    /// action), never from its text — and the file must say the same, because the push reads a member's kind from the
    /// keyword that opens its block (<see cref="StReader.MemberHeaderKeyword"/>). CODESYS stores whatever text a method
    /// is given and keeps it a method (DIALECT C2l): one holding <c>PROPERTY</c> text pulled verbatim would come back on
    /// the next push as a property — the method deleted and a property created, under a push that changed nothing. So
    /// the item is refused here, as <see cref="RefuseUnreadableBack"/> refuses a text no push can split back: listed
    /// unreadable, the workspace file left alone, the reason naming the member, its class and the keyword its text opens
    /// with (openspec <c>push-without-header-check</c> 5.Q.5, M-a). An action carries no declaration of its own (its
    /// <c>ACTION</c> line is written from its class), and a declaration with no code opens with no keyword to disagree.</summary>
    private static void RefuseMemberOfAnotherClass(string name, ItemContent content)
    {
        foreach (var m in content.Members)
        {
            var expected = StReader.MemberKeywordFor(m.Kind);
            if (expected is null || StReader.MemberHeaderKeyword(m.Declaration) is not { } opens || opens == expected) continue;
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{name}': its {m.Kind.Replace('_', ' ')} '{m.Name}' holds text that opens with '{opens}', not {expected}. " +
                $"A member's kind is its class in the IDE, and a file opening the member with '{opens}' would be read back " +
                $"by a push as another kind of member (the {m.Kind.Replace('_', ' ')} deleted and another created), so the " +
                $"item is not pulled until the member's text opens with {expected} in the IDE.");
        }
    }

    /// <summary>A POU whose declaration opens with no PROGRAM / FUNCTION_BLOCK / FUNCTION has no END line to mirror
    /// (<see cref="StWriter.NoHeader"/>) and is refused BY NAME, never closed with an invented
    /// <c>END_FUNCTION_BLOCK</c> (openspec <c>bridge-one-to-one</c> task 3.5).</summary>
    private static void RefuseHeaderless(string name, ItemContent content)
    {
        if (content.Kind == ItemKind.Kinds.Pou && StReader.PouHeaderKeyword(content.Declaration) is null)
            throw StWriter.NoHeader(name);
    }
}
