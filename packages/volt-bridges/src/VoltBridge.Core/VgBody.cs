using System;

namespace VoltBridge.Core;

/// <summary>
/// The VG graphical-body contract. A graphical body — a ROOT POU (its own .fbd/.ld file) or a CHILD
/// action/method (inline in a .st) — is VG text whose first line is <c>%LANG &lt;lang&gt;</c>. There
/// is no separate marker: the <c>%LANG</c> header is the single signal, and the language alone says
/// whether it round-trips — <b>FBD/LD are editable</b> (parsed and pushed back), <b>CFC/SFC are
/// read-only views</b> (shown, never written).
/// </summary>
public static class VgBody
{
    private const string Header = "%LANG";

    /// <summary>The text is a graphical VG body (its first non-blank line is <c>%LANG …</c>).</summary>
    public static bool Is(string? impl)
        => impl != null && impl.TrimStart().StartsWith(Header, StringComparison.Ordinal);

    /// <summary>The body's language (the <c>%LANG</c> value, e.g. "FBD"), or null if not a VG body.</summary>
    public static string? LanguageOf(string? impl)
    {
        if (!Is(impl)) return null;
        var first = impl!.TrimStart();
        var nl = first.IndexOf('\n');
        var line = (nl >= 0 ? first.Substring(0, nl) : first).Trim();
        return line.Length > Header.Length ? line.Substring(Header.Length).Trim() : null;
    }

    /// <summary>Whether a VG language round-trips on push: FBD/LD are editable; CFC/SFC are read-only.</summary>
    public static bool IsEditable(string? language) => language is "FBD" or "LD";
}
