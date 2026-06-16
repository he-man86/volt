using System;
using System.Text.RegularExpressions;

namespace Volt.Bridge.Core.Graphical;

/// <summary>
/// The VG graphical-body contract. A graphical body — a ROOT POU (its own .fbd/.ld file) or a CHILD
/// action/method (inline in a .st) — is detected by its opening marker:
/// <list type="bullet">
/// <item><b>Editable FBD/LD</b> lead with a network block <c>NETWORK &lt;index&gt; &lt;LANG&gt; …</c>;
/// the language rides on the marker (no separate header). These round-trip (parsed and pushed back).</item>
/// <item><b>Read-only CFC/SFC</b> have no networks, so they're a single <c>%LANG &lt;lang&gt;</c>
/// placeholder line — shown, never written.</item>
/// </list>
/// The language alone says whether the body round-trips: FBD/LD are editable, CFC/SFC are read-only.
/// </summary>
public static class VgBody
{
    private const string LangHeader = "%LANG";
    // NETWORK <index> <LANG> … — the editable marker (the digit after NETWORK rules out ST text).
    private static readonly Regex NetworkHeader = new(@"^NETWORK\s+\d+\s+([A-Za-z]\w*)", RegexOptions.Compiled);

    /// <summary>The text is a graphical VG body — it opens with a <c>NETWORK n …</c> block (FBD/LD)
    /// or a <c>%LANG …</c> placeholder (CFC/SFC).</summary>
    public static bool Is(string? impl)
    {
        if (impl == null) return false;
        var t = impl.TrimStart();
        return t.StartsWith(LangHeader, StringComparison.Ordinal) || NetworkHeader.IsMatch(t);
    }

    /// <summary>The body's language ("FBD"/"LD" from the NETWORK marker, or the <c>%LANG</c> value for
    /// a CFC/SFC placeholder), or null if not a VG body.</summary>
    public static string? LanguageOf(string? impl)
    {
        if (impl == null) return null;
        var t = impl.TrimStart();
        if (t.StartsWith(LangHeader, StringComparison.Ordinal))
        {
            var nl = t.IndexOf('\n');
            var line = (nl >= 0 ? t.Substring(0, nl) : t).Trim();
            return line.Length > LangHeader.Length ? line.Substring(LangHeader.Length).Trim() : null;
        }
        var m = NetworkHeader.Match(t);
        return m.Success ? m.Groups[1].Value : null;
    }

    /// <summary>Whether a VG language round-trips on push: FBD/LD are editable; CFC/SFC are read-only.</summary>
    public static bool IsEditable(string? language) => language is "FBD" or "LD";
}
