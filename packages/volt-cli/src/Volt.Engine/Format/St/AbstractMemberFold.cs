using System.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;

namespace Volt.Engine.Format.St;

/// <summary>
/// ONE RULE FOR AN ABSTRACT MEMBER'S TEXT, decided by its declaration and never by the IDE's storage (openspec
/// <c>abstract-member-parity</c>, DIALECT C2n): an <c>ABSTRACT</c> member with no code reads <c>IMPLEMENTATION NONE</c>
/// on both vendors, whoever made the object.
///
/// <para><b>Why a fold, here, and not in a driver.</b> The vendors STORE the same declaration differently: a CODESYS
/// slotless object (<c>AbstractPOUMethodObject</c>, <c>InterfacePropertyAccessorObject</c>) reads as
/// <c>IMPLEMENTATION NONE</c>, a CODESYS slotted one (<c>POUMethodObject</c>, <c>PropertyAccessorObject</c> — script-made,
/// or IDE-made like pro2193's <c>Cyclic</c>) and every TwinCAT abstract member as <c>IMPLEMENTATION ST</c> with an empty
/// body. So the drivers keep their storage facts (CODESYS's declared-and-null <c>Implementation</c> stays NONE) and the
/// engine folds the rest, at every place content enters it: the two reads of driver content
/// (<c>Materializer.Materialize</c>, <c>PushService.ReadLive</c>), the pushed source after
/// <c>StReader.Read</c>, and both reads of the CLI's post-push check (<c>PushedText.SameExceptLayout</c>).
/// <c>StReader</c> itself keeps reading what is written: the LSP parses the text, and a reader that rewrote ST into NONE
/// would make the file and its parse disagree.</para>
///
/// <para><b>Member sites only.</b> A METHOD's body, and a PROPERTY's GET/SET, where the PROPERTY's declaration decides
/// ABSTRACT. Never a POU's own body or an action's: <c>FUNCTION_BLOCK ABSTRACT</c> with an empty body stays
/// <c>IMPLEMENTATION ST</c> (<see cref="StReader.MemberHeaderIsAbstract"/> answers true for an FB header too, so the site
/// is picked by kind before the declaration is asked).</para>
///
/// <para><b>No code</b> is a body that is null or EMPTY, stating no language or ST — NARROWED by openspec
/// <c>bridge-one-to-one</c> (§1.1 classes, gate 1; task 3.5): a whitespace body stored in a slotted object (<c>\n\n</c>
/// in a <c>POUMethodObject</c>) is stored characters, not NONE. The fold is a MEASURED equivalence (<c>abstract-member-equivalence</c>: an abstract method created with no body text), so
/// it covers exactly that — and a whitespace-only body is spelled verbatim under <c>IMPLEMENTATION ST</c>. A comment-only body is
/// kept (measured, gate 2: a comment is not a statement on either compiler, and both fetch it as <c>IMPLEMENTATION ST</c>
/// with the comment); a graphical or hidden body names a language and is kept; a body with statements keeps its code,
/// which both compilers refuse (C0433, "must not contain any statements") — the push refuses it by name
/// (<see cref="BodyFormatGuard"/>).</para>
/// </summary>
public static class AbstractMemberFold
{
    /// <summary><paramref name="content"/> with every ABSTRACT member body that holds no code stated
    /// <c>IMPLEMENTATION NONE</c>; the same record when nothing folds.</summary>
    public static ItemContent Apply(ItemContent content)
    {
        if (content.Members.Count == 0) return content;
        var folded = content.Members.Select(Fold).ToList();
        return folded.SequenceEqual(content.Members) ? content : content with { Members = folded };
    }

    /// <summary>Is <paramref name="site"/> a member body site — the only place <c>IMPLEMENTATION NONE</c> can stand: a
    /// METHOD's body, or a property's GET/SET (the guard's site names, <c>ItemKind.Kinds</c>).</summary>
    public static bool IsMemberSite(string site) =>
        site is ItemKind.Kinds.Method or ItemKind.Kinds.PropertyGet or ItemKind.Kinds.PropertySet;

    /// <summary>Does this body hold no code — null or empty, stating no language or ST?</summary>
    private static bool HoldsNoCode(string? body, StatedLanguage? stated) =>
        string.IsNullOrEmpty(body) && (stated is null || stated == StatedLanguage.St);

    private static Member Fold(Member m)
    {
        if (m.Kind == ItemKind.Kinds.Method)
            return IsAbstract(m.Declaration) && HoldsNoCode(m.Body, m.Stated)
                ? m with { Body = ImplementationMarker.NoneLine, Stated = StatedLanguage.None }
                : m;
        if (ItemKind.ShapeOf(m.Kind).Accessors != AccessorShape.WithBodies || !IsAbstract(m.Declaration)) return m;
        var getter = Fold(m.Getter);
        var setter = Fold(m.Setter);
        return ReferenceEquals(getter, m.Getter) && ReferenceEquals(setter, m.Setter) ? m : m with { Getter = getter, Setter = setter };
    }

    private static Accessor? Fold(Accessor? a) =>
        a is not null && HoldsNoCode(a.Body, a.Stated)
            ? a with { Body = ImplementationMarker.NoneLine, Stated = StatedLanguage.None }
            : a;

    private static bool IsAbstract(string? declaration) =>
        declaration is not null && StReader.MemberHeaderIsAbstract(declaration);
}
