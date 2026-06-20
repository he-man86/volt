using System;
using System.Text.RegularExpressions;

namespace Volt.Bridge.Core.Graphical;

/// <summary>
/// The VG graphical-body contract. An EDITABLE graphical body (FBD/LD — a ROOT POU's own .fbd/.ld file,
/// or a CHILD action/method inline in a .st) leads with a network block <c>NETWORK &lt;index&gt;
/// &lt;LANG&gt; …</c>; the language rides on the marker (no separate header) and the body round-trips.
/// Read-only CFC/SFC are NOT VG bodies — they have no networks and materialize declaration-only (their
/// language rides on the .cfc/.sfc extension, which the bridge derives from the IDE).
/// </summary>
public static class VgBody
{
    // NETWORK <index> <LANG> … — the editable marker (the digit after NETWORK rules out ST text).
    private static readonly Regex NetworkHeader = new(@"^NETWORK\s+\d+\s+([A-Za-z]\w*)", RegexOptions.Compiled);

    /// <summary>The text is an editable graphical VG body — it opens with a <c>NETWORK n …</c> block (FBD/LD).</summary>
    public static bool Is(string? impl) => impl != null && NetworkHeader.IsMatch(impl.TrimStart());

    /// <summary>The body's language ("FBD"/"LD" from the NETWORK marker), or null if not a VG body.</summary>
    public static string? LanguageOf(string? impl)
    {
        if (impl == null) return null;
        var m = NetworkHeader.Match(impl.TrimStart());
        return m.Success ? m.Groups[1].Value : null;
    }

    /// <summary>Editable graphical languages: FBD and LD. (CFC/SFC are read-only, not VG bodies.)</summary>
    public static bool IsEditable(string? language) => language is "FBD" or "LD";
}
