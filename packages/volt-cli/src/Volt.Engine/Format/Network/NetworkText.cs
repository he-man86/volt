using System;
using System.Text.RegularExpressions;
using Volt.Engine.Format.Body;

namespace Volt.Engine.Format.Network;

/// <summary>
/// The network text graphical-body contract. An EDITABLE graphical body (FBD/LD — a ROOT POU's own kind-named
/// file, or a CHILD action/method inline in it) leads with a network block <c>NETWORK &lt;index&gt;
/// &lt;LANG&gt; …</c>; the language rides on the marker (no separate header) and the body round-trips.
/// CFC/SFC are NOT network-text bodies — they have no text form and materialize as an informational marker comment
/// (see <c>BodyMarker.For</c>); they are not editable, but that is enforced by live IDE
/// state on push, not by any content marker.
/// </summary>
public static class NetworkText
{
    // NETWORK <index> <LANG> … — the editable marker (the digit after NETWORK rules out ST text).
    private static readonly Regex NetworkHeader = new(@"^NETWORK\s+\d+\s+([A-Za-z]\w*)", RegexOptions.Compiled);

    /// <summary>The text is an editable graphical network-text body — it opens with a <c>NETWORK n …</c> block (FBD/LD).</summary>
    public static bool Is(string? impl) => LanguageOf(impl) != null;

    /// <summary>The body's language ("FBD"/"LD" from the NETWORK marker), or null if not a network-text body.</summary>
    public static string? LanguageOf(string? impl)
    {
        if (impl == null) return null;
        var m = NetworkHeader.Match(impl.TrimStart());
        return m.Success ? m.Groups[1].Value : null;
    }

    /// <summary>Refuse a push that changes the body's VIEW between FBD and LD.
    ///
    /// <para>The view is a property of the whole implementation object (the vendors' <c>DefaultViewMode</c>),
    /// not of a network — but network text prints it on EVERY network header, which is the only textual
    /// difference between an FBD body and an LD one. So the header invites an edit that nothing then applies:
    /// neither driver writes the member on an update, and both change gates compare the two sides with the
    /// language NEUTRALISED, so a header-only edit wrote nothing at all, the push was reported applied,
    /// `volt status` read clean, and the next pull reverted the engineer's file.</para>
    ///
    /// <para>Refusing rather than writing, for now, because whether the member is settable on a live CODESYS
    /// aspect is NOT measured — TwinCAT has <c>TcArchive.WithViewMode</c> and uses it on the create route only.
    /// A field that is rendered, accepted and ignored is the worst of the three; say so instead. Measure the
    /// setter and this can become a write.</para></summary>
    public static void RefuseViewModeChange(BodyLanguage? live, BodyLanguage pushed)
    {
        if (live is not { } was || was == pushed) return;

        var name = (BodyLanguage l) => l == BodyLanguage.Ld ? "LD" : "FBD";
        throw new NotSupportedException(
            $"the graphical body's view is {name(was)} and the pushed text says {name(pushed)}. Volt cannot " +
            "change a body's view — it is one property of the whole body, and nothing here writes it — so the " +
            "push is refused rather than silently applying every other edit and reverting this one on the next " +
            "pull. Switch the view in the IDE and pull.");
    }

    /// <summary>Editable graphical languages: FBD and LD. (CFC/SFC have no text form — an informational
    /// marker is materialized for them instead of a network-text body.)</summary>
    public static bool IsEditable(string? language) => Languages.IsNetwork(language);
}
