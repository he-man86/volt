using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Seam;

namespace Volt.Engine.Format.St;

/// <summary>
/// TRANSITIONAL (openspec <c>volt-cli-rework</c> step 4; deleted with <see cref="SeamAdmission"/> in step 5): the
/// file-format half of the door. The old engine reads and writes every source file through <see cref="StReader"/> /
/// <see cref="StWriter"/> — the IEC layout — so a kind a new-contract vendor declared is handed to the
/// <see cref="IItemFormat"/> its row names instead, and its <see cref="Content"/> is carried through the old
/// <see cref="ItemContent"/> record by <see cref="ToItemContent"/> / <see cref="ToContent"/> — the body half of the
/// content mapping the step-5 adapter needs (old host to new contract); that adapter adds the family's property keys.
/// </summary>
public static class AdmittedFormats
{
    /// <summary>The format and its declaring catalog for an admitted source kind, or null for every other kind.</summary>
    internal static (IItemFormat Format, Catalog Catalog, string Vendor)? For(string kind) =>
        ItemKind.IsSourceKind(kind) && SeamAdmission.DeclaredIn(kind) is { } d && d.Catalog.Kinds.Find(kind)?.Format is { } f
            ? (f, d.Catalog, d.Vendor)
            : null;

    internal static ItemContent Read((IItemFormat Format, Catalog Catalog, string Vendor) f, string text, string kind, string? name) =>
        ToItemContent(f.Format.Read(text, kind, name ?? kind, f.Catalog, f.Vendor));

    internal static string Write((IItemFormat Format, Catalog Catalog, string Vendor) f, ItemContent content) =>
        f.Format.Write(ToContent(content));

    /// <summary>A new-contract <see cref="Content"/> as the old record. The language travels as the FACT
    /// (<see cref="StatedLanguage"/>), the code as the body text with no line in front — the old record's convention for
    /// every body that is not network text; a hidden body is its UNSUPPORTED line. The old record has no place for a
    /// declared property key: a content carrying one is refused, by name, rather than dropped.</summary>
    public static ItemContent ToItemContent(Content c)
    {
        if (c is null) throw new ArgumentNullException(nameof(c));
        var (body, stated, why) = OldBody(c.Body);
        return new ItemContent(c.Kind, c.Declaration, body,
            c.Members.Select(m =>
            {
                var (mb, ms, mw) = OldBody(m.Body);
                return new Member(m.Kind, m.Name, m.Declaration, mb, OldProperties(m.Properties, $"{m.Kind} '{m.Name}'"),
                    m.Folder, OldAccessor(m.Get), OldAccessor(m.Set), Unsupported: mw, Stated: ms);
            }).ToList(),
            OldProperties(c.Properties, $"this {c.Kind}"), why, stated);
    }

    /// <summary>The old record as new-contract <see cref="Content"/> (the inverse of <see cref="ToItemContent"/>).</summary>
    public static Content ToContent(ItemContent c)
    {
        if (c is null) throw new ArgumentNullException(nameof(c));
        return new Content(c.Kind, c.Declaration, NewBody(c.Body, c.Stated, c.Unsupported),
            c.Members.Select(m => new ContentMember(m.Kind, m.Name, m.Declaration, NewBody(m.Body, m.Stated, m.Unsupported),
                NewProperties(m.Properties, $"{m.Kind} '{m.Name}'"), m.Folder,
                m.Getter is { } g ? new ContentAccessor(g.Declaration, NewBody(g.Body, g.Stated, g.Unsupported)) : null,
                m.Setter is { } s ? new ContentAccessor(s.Declaration, NewBody(s.Body, s.Stated, s.Unsupported)) : null)).ToList(),
            NewProperties(c.Properties, $"this {c.Kind}"));
    }

    private static (string? Body, StatedLanguage? Stated, string? Why) OldBody(BodyText? b) => b switch
    {
        null => (null, null, null),
        { Form: BodyForm.Shown } => (b.Code, StatedLanguage.Shown(b.Language), null),
        { Form: BodyForm.Hidden } => (ImplementationMarker.Unsupported(b.Language), StatedLanguage.HiddenIn(b.Language), b.Why),
        _ => (ImplementationMarker.NoneLine, StatedLanguage.None, null),
    };

    private static BodyText? NewBody(string? body, StatedLanguage? stated, string? why) =>
        body is null ? null
        : stated is null
            ? throw new BridgeException(BridgeErrorCodes.InternalError,
                "a body reached the new contract without its stated language — the old record left the language in the text")
        : stated.IsNone ? BodyText.Abstract
        : stated.Hidden ? BodyText.Hidden(stated.Language, why ?? "")
        : BodyText.Shown(stated.Language, body);

    private static Accessor? OldAccessor(ContentAccessor? a)
    {
        if (a is null) return null;
        var (body, stated, why) = OldBody(a.Body);
        return new Accessor(a.Declaration, body, why, stated);
    }

    private static ObjectProperties OldProperties(PropertySet set, string what) =>
        set.Items.Count == 0
            ? ObjectProperties.None
            : throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{what} carries {string.Join(", ", set.Items)}, which the old engine's closed property record cannot hold " +
                "(volt-cli-rework step 5 carries declared keys)");

    private static PropertySet NewProperties(ObjectProperties props, string what) =>
        props.Equals(ObjectProperties.None)
            ? PropertySet.Empty
            : throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"{what} carries object properties of the old closed record, which an admitted vendor never declared");
}
