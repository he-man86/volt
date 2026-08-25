using System;
using System.Text.RegularExpressions;
using Volt.Engine.Vocabulary;

namespace Volt.Engine.Graph;

/// <summary>
/// The network text graphical-body contract. An EDITABLE graphical body (FBD/LD — a ROOT POU's own kind-named
/// file, or a CHILD action/method inline in it) leads with a network block <c>NETWORK &lt;index&gt;
/// &lt;LANG&gt; …</c>; the language rides on the marker (no separate header) and the body round-trips.
/// CFC/SFC are NOT network-text bodies — they have no text form and materialize as an informational marker comment
/// (see <c>Vocabulary.BodyMarker.For</c>); they are not editable, but that is enforced by live IDE
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

    /// <summary>Editable graphical languages: FBD and LD. (CFC/SFC have no text form — an informational
    /// marker is materialized for them instead of a network-text body.)</summary>
    public static bool IsEditable(string? language) => Languages.IsNetwork(language);
}
