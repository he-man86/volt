using System;
using Volt.Contracts;
using Volt.Engine.Document;
using Volt.Engine.Graph;
using Volt.Engine.Ide;
using Volt.Engine.Model;
using Volt.Engine.Vocabulary;

namespace Volt.Engine.Sync;

/// <summary>The refusal policy for a body write: never overwrite a body whose LANGUAGE differs from the one the
/// push carries, and never write over a language Volt cannot produce (CFC, SFC, IL).
/// <para>It is a policy, not plumbing: it decides what a push is not allowed to do, and it was written twice
/// inside <c>PushService</c> — once for the root body and once per child — with the refusal MESSAGES hand-aligned
/// between the two arms after clients got a different sentence depending on which IDE was attached.</para></summary>
internal static class BodyFormatGuard
{
    /// <summary>The six-language body answer reduced to the GRAPHICAL ones — the same shape
    /// <see cref="ICodeStore.BodyLanguage"/> returns (null for a textual ST/IL body), so the two sources are
    /// interchangeable at every guard.</summary>
    /// <summary>The language when it is one a textual write must not touch — i.e. anything but ST. Asking the
    /// codec registry instead of listing names is what stops a new language (IL was one) being silently
    /// classified textual and overwritten.</summary>
    private static string? NonSt(string? language) =>
        language is { } l && !string.Equals(l, "ST", StringComparison.OrdinalIgnoreCase) ? l : null;

    /// <summary>Is this body language one Volt cannot write at all (CFC, SFC, IL)? Read off the codec, so the
    /// unsupported set has ONE definition shared by the splice and both live guards.</summary>
    private static bool IsUnsupportedLanguage(string? language) =>
        language is { } l && Document.BodyCodec.For(l).Unsupported;

    /// <summary>Body-format guard for ONE child of a POU — the child-level counterpart of the root POU guard, and it
    /// decides from the IDE's LIVE body language, never from the incoming text. <c>NetworkText</c>'s contract says it
    /// outright: CFC/SFC unsupportedness "is enforced by live IDE state on push, not by any content marker".
    /// <para>The old guard tried to do it from content — <c>NetworkText.Is(cimpl) &amp;&amp; !IsEditable(...)</c> — which could
    /// never work, because a CFC/SFC body has no text form and materializes as
    /// <see cref="Vocabulary.BodyMarker"/>, which <c>NetworkText.Is</c> (a <c>NETWORK n LANG</c> matcher)
    /// REJECTS. So the marker fell through to the textual path and <c>WriteText</c> replaced an engineer's graphical
    /// child body with a comment. Scoped to method/action children: an interface member has no body of its own
    /// (reading one crashes TwinCAT) and a PROPERTY node's body lives in its GET/SET accessors.</para></summary>
    internal static void RequireChildFormatWritable(IIdeDriver ide, ItemRef pou, Member child, int itemType,
                                                   PouReader.ParsedPou? parsed)
    {
        var cimpl = child.Body;
        var marker = Vocabulary.BodyMarker.Is(cimpl);

        // An INTERFACE member and a PROPERTY node carry no body of their own — a property's code lives in its
        // GET/SET accessors, which arrive as `child.Getter`/`child.Setter`, not as `child.Body`. So there is
        // nothing here to check, and evaluating `cimpl` for one would ask the wrong question.
        //
        // That was true before too, and it was NOT enough: nothing else checked the accessors either.
        // `PouSplice.SetAccessor` hardcoded <ST>, deleting an FBD/LD accessor's diagram and writing the raw
        // network text in its place, and `PouReader.Accessor` read that text straight back — a fixed point no
        // round-trip test could see. Both legs now dispatch through `BodyCodec`, so an accessor gets the same
        // unsupported-body and language-mismatch refusals as a root or a child, at the splice. This return is a
        // statement about where the check LIVES, not an exemption from it.
        if (itemType == ItemKind.PlcItf || child.Kind == ItemKind.Kinds.Property) return;

        string? lang;                        // null=textual; FBD/LD=editable; CFC/SFC=read-only
        if (parsed is not null)
        {
            // From the document already read for this write. Besides costing nothing, this is how the guard stops
            // MUTATING the project: the vendor path below resolves the child's folder to find it, and
            // `ResolveFolder` CREATES missing folders — so a guard advertised as "validate before writing
            // anything, so a refusal is atomic" could leave new empty folders behind and then refuse the push.
            var known = parsed.Children.FirstOrDefault(c => string.Equals(c.Name, child.Name, StringComparison.OrdinalIgnoreCase));
            if (known is null) return;       // not in the IDE yet — a create, nothing to overwrite
            lang = NonSt(known.BodyLanguage);
        }
        else
        {
            if (TreeNav.FindChild(ide, TreeNav.FindFolder(ide, pou, child.Folder) ?? pou, child.Name) is not { } live) return;
            lang = ide.BodyLanguage(live);
        }

        var childIsNetwork = NetworkText.Is(cimpl);

        // An unsupported body round-trips as the MARKER, and pushing the marker back is the ordinary no-op — the
        // splice leaves that member's body untouched. So the marker is only a refusal when it does NOT match a
        // unsupported body in the IDE: a stale or hand-written marker over something writable, which would
        // otherwise silently do nothing.
        if (marker)
        {
            if (IsUnsupportedLanguage(lang)) return;               // the normal round-trip — leave the body alone
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{child.Name}' carries an unsupported-body marker but its body in the IDE is " +
                $"{lang ?? "textual"} — remove the marker and push real source, or pull first.");
        }

        if (Languages.IsDiagram(lang))
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{child.Name}' has a {lang} body, which Volt does not support — edit it in the IDE, not via push.");
        if (lang is not null && !childIsNetwork)
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{child.Name}' is a graphical {lang} body in the IDE — a textual push would overwrite it. " +
                "Edit it in the IDE, or delete it first to replace it.");
        if (lang is null && childIsNetwork)
            throw new BridgeException(BridgeErrorCodes.Unsupported,
                $"'{child.Name}' is a textual body — graphical bodies are authored in the IDE, not created by push.");
    }
}
