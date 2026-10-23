using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;
using Volt.Engine.Seam;

namespace Volt.Engine.Format.St;

/// <summary>
/// The IEC layout's own record (<see cref="ItemContent"/>, what <see cref="StReader"/> and <see cref="StWriter"/> speak and
/// what an old-contract host reads and writes) as the new contract's <see cref="Content"/>, both directions, losing
/// nothing: <c>ToItemContent(ToContent(x))</c> is <c>x</c> (<c>FamilyContentTests</c>, over the whole corpus).
///
/// <para><b>A body</b>: its language is the <see cref="StatedLanguage"/> fact, its code the text under its line
/// (<see cref="ImplementationMarker.Split"/> / <see cref="ImplementationMarker.Join"/>, the layout's one rule: an ST body is
/// its code, an LD/FBD body opens with its line), a hidden body's reason its <see cref="BodyText.Why"/>. A body whose text
/// does not come back from its fact is not converted with a guess: it is refused as Volt's bug, naming it.</para>
///
/// <para><b>The object properties</b> are the <c>%</c>-lines' keys (<see cref="PropertyLines"/>), each value spelled as its
/// line spells it, in the lines' one order — except a <c>%NETVAR</c> value, carried raw after its <c>&lt;member&gt;: </c>, so
/// a value the line cannot spell (<see cref="PropertyLines.Unspellable"/>) still converts exactly and is refused where it
/// always was, by the writer.</para>
///
/// <para><b>A signature member's type</b> (<see cref="Member.ReturnType"/> of a method, <see cref="Member.DataType"/> of a
/// property) is <see cref="ContentMember.Signature"/>; which of the two it is follows from the member's kind.</para>
/// </summary>
public static class FamilyContent
{
    public static Content ToContent(ItemContent c)
    {
        if (c is null) throw new ArgumentNullException(nameof(c));
        return new Content(c.Kind, c.Declaration, NewBody(c.Body, c.Stated, c.Unsupported, $"the {c.Kind}'s body"),
            c.Members.Select(m => new ContentMember(m.Kind, m.Name, m.Declaration,
                NewBody(m.Body, m.Stated, m.Unsupported, $"{m.Kind} '{m.Name}'"),
                ToPropertySet(m.Properties), m.Folder,
                m.Getter is { } g ? new ContentAccessor(g.Declaration, AccessorBody(g, $"'{m.Name}' GET")) : null,
                m.Setter is { } s ? new ContentAccessor(s.Declaration, AccessorBody(s, $"'{m.Name}' SET")) : null,
                m.ReturnType ?? m.DataType)).ToList(),
            ToPropertySet(c.Properties));
    }

    public static ItemContent ToItemContent(Content c) => ToItemContent(c, ToObjectProperties);

    /// <summary>The bodies and declarations of <paramref name="c"/> as the old record, its object properties left out
    /// (<see cref="ObjectProperties.None"/>): for a rule that reads bodies alone (<c>BodyFormatGuard</c>), whatever keys
    /// the host declares.</summary>
    public static ItemContent BodiesOf(Content c) => ToItemContent(c, _ => ObjectProperties.None);

    private static ItemContent ToItemContent(Content c, Func<PropertySet, ObjectProperties> properties)
    {
        if (c is null) throw new ArgumentNullException(nameof(c));
        var (body, stated, why) = OldBody(c.Body);
        return new ItemContent(c.Kind, c.Declaration, body,
            c.Members.Select(m => ToMember(m, properties)).ToList(), properties(c.Properties), why, stated);
    }

    private static Member ToMember(ContentMember m, Func<PropertySet, ObjectProperties> properties)
    {
        var (body, stated, why) = OldBody(m.Body);
        var isProperty = m.Kind is ItemKind.Kinds.Property or ItemKind.Kinds.InterfaceProperty;
        return new Member(m.Kind, m.Name, m.Declaration, body, properties(m.Properties), m.Folder,
            ToAccessor(m.Get), ToAccessor(m.Set),
            ReturnType: isProperty ? null : m.Signature, DataType: isProperty ? m.Signature : null,
            Unsupported: why, Stated: stated);
    }

    public static Accessor? ToAccessor(ContentAccessor? a)
    {
        if (a is null) return null;
        var (body, stated, why) = OldBody(a.Body);
        return new Accessor(a.Declaration, body, why, stated);
    }

    /// <summary>An accessor's body. A SIGNATURE accessor (an interface property's, or a bare <c>GET</c> line) states no
    /// language and has no code — the IEC reader spells it <c>""</c>, a host's read <c>null</c> — and is a null body here,
    /// as it is back in the old record: no body to write (<c>Accessor.Code</c> reads both as one).</summary>
    private static BodyText? AccessorBody(Accessor a, string what) =>
        a.Stated is null && string.IsNullOrEmpty(a.Body) ? null : NewBody(a.Body, a.Stated, a.Unsupported, what);

    private static BodyText? NewBody(string? body, StatedLanguage? stated, string? why, string what)
    {
        if (body is null) return null;
        if (stated is null || (why is not null && !stated.Hidden))
            throw new BridgeException(BridgeErrorCodes.InternalError, stated is null
                ? $"{what} reached the new contract with no stated language: a body's language is a fact its reader states"
                : $"{what} is stated '{stated}' and carries the reason '{why}': only a hidden body has one");
        var text = stated.IsNone ? BodyText.Abstract
            : stated.Hidden ? new BodyText(stated.Language, "", BodyForm.Hidden, why)
            : BodyText.Shown(stated.Language, Languages.IsNetwork(stated.Language) ? ImplementationMarker.Split(body).Code : body);
        if (OldBody(text).Body != body)
            throw new BridgeException(BridgeErrorCodes.InternalError,
                $"{what} is '{Shorten(body)}', which its stated language ({stated}) does not spell back");
        return text;
    }

    private static (string? Body, StatedLanguage? Stated, string? Why) OldBody(BodyText? b) => b switch
    {
        null => (null, null, null),
        // A network body opens with its line in the old record; every other shown body is its code alone.
        { Form: BodyForm.Shown } => (Languages.IsNetwork(b.Language) ? ImplementationMarker.Join(ImplementationMarker.For(b.Language), b.Code) : b.Code,
                                     StatedLanguage.Shown(b.Language), null),
        { Form: BodyForm.Hidden } => (ImplementationMarker.Unsupported(b.Language), StatedLanguage.HiddenIn(b.Language), b.Why),
        _ => (ImplementationMarker.NoneLine, StatedLanguage.None, null),
    };

    private static string Shorten(string s) => s.Length <= 60 ? s : s.Substring(0, 60) + "…";

    // ── the object properties ──

    private static PropertySet ToPropertySet(ObjectProperties p)
    {
        if (p is null) throw new ArgumentNullException(nameof(p), "an object's properties are read, never defaulted");
        var items = new List<Property>();
        if (p.Class is { } cls) items.Add(new Property(PropertyLines.ClassKey, cls.ToString()));
        if (p.ExcludeFromBuild) items.Add(new Property(PropertyLines.ExcludeFromBuildKey, null));
        if (p.LinkAlways) items.Add(new Property(PropertyLines.LinkAlwaysKey, null));
        if (p.External) items.Add(new Property(PropertyLines.ExternalKey, null));
        if (p.EnableSystemCall) items.Add(new Property(PropertyLines.EnableSystemCallKey, null));
        if (p.OnlineChangeReserve != 0)
            items.Add(new Property(PropertyLines.OnlineChangeReserveKey, p.OnlineChangeReserve.ToString(CultureInfo.InvariantCulture)));
        if (!string.IsNullOrEmpty(p.CompilerDefines)) items.Add(new Property(PropertyLines.CompilerDefinesKey, PropertyLines.StString(p.CompilerDefines!)));
        foreach (var u in p.Undefines) items.Add(new Property(PropertyLines.UndefineKey, PropertyLines.StString(u)));
        if (!string.IsNullOrEmpty(p.Comment)) items.Add(new Property(PropertyLines.CommentKey, PropertyLines.StString(p.Comment!)));
        if (p.ParameterList) items.Add(new Property(PropertyLines.ParameterListKey, null));
        foreach (var nv in p.NetVar) items.Add(new Property(PropertyLines.NetVarKey, $"{nv.Key}: {nv.Value}"));
        if (p.FileLink is { } fl) items.Add(new Property(PropertyLines.FileLinkKey, $"{fl.LinkType} {PropertyLines.StString(fl.Path)}"));
        return items.Count == 0 ? PropertySet.Empty : new PropertySet(items);
    }

    public static ObjectProperties ToObjectProperties(PropertySet set)
    {
        if (set is null) throw new ArgumentNullException(nameof(set), "an object's properties are read, never defaulted");
        if (set.Items.Count == 0) return ObjectProperties.None;
        ObjectClass? cls = null;
        string? defines = null, comment = null;
        bool exclude = false, linkAlways = false, external = false, systemCall = false, parameterList = false;
        var reserve = 0;
        var undefines = new List<string>();
        var netVar = new List<NetVarSetting>();
        FileLink? fileLink = null;
        foreach (var p in set.Items)
        {
            var v = p.Value ?? "";
            switch (p.Key)
            {
                case PropertyLines.ClassKey:
                    var sp = v.IndexOf(' ');
                    cls = sp < 0 ? new ObjectClass(v, null) : new ObjectClass(v.Substring(0, sp), v.Substring(sp + 1));
                    break;
                case PropertyLines.ExcludeFromBuildKey: exclude = true; break;
                case PropertyLines.LinkAlwaysKey: linkAlways = true; break;
                case PropertyLines.ExternalKey: external = true; break;
                case PropertyLines.EnableSystemCallKey: systemCall = true; break;
                case PropertyLines.ParameterListKey: parameterList = true; break;
                case PropertyLines.OnlineChangeReserveKey: reserve = int.Parse(v, NumberStyles.None, CultureInfo.InvariantCulture); break;
                case PropertyLines.CompilerDefinesKey: defines = PropertyLines.ReadString(v); break;
                case PropertyLines.UndefineKey: undefines.Add(PropertyLines.ReadString(v)); break;
                case PropertyLines.CommentKey: comment = PropertyLines.ReadString(v); break;
                case PropertyLines.NetVarKey:
                    var sep = v.IndexOf(": ", StringComparison.Ordinal);
                    netVar.Add(new NetVarSetting(v.Substring(0, sep), v.Substring(sep + 2)));
                    break;
                case PropertyLines.FileLinkKey:
                    var at = v.IndexOf(' ');
                    fileLink = new FileLink(v.Substring(0, at), PropertyLines.ReadString(v.Substring(at + 1)));
                    break;
                default:
                    throw new BridgeException(BridgeErrorCodes.Unsupported,
                        $"{p} is no property of the IEC layout's object record (its keys: {string.Join(", ", PropertyLines.Keys.Where(k => k != PropertyLines.FolderKey).Select(k => "%" + k))})");
            }
        }
        return new ObjectProperties(cls, exclude, linkAlways, external, systemCall, reserve, defines, undefines, comment,
                                    parameterList, netVar, fileLink);
    }
}
