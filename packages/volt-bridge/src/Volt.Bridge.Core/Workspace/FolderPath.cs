using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace Volt.Bridge.Core.Workspace;

/// <summary>
/// The folder path a tree item lives in, as a single `/`-joined string on the wire — with each SEGMENT
/// name reversibly percent-encoded so the join is unambiguous AND safe as a filesystem path.
///
/// Why encode: an IDE folder's display name may contain characters that collide with the path separator or
/// are illegal in a filesystem path component. Real CODESYS projects have a folder literally named
/// "Interfaces / Data" — the `/` in the NAME is indistinguishable from the separator, so a raw join both
/// mis-resolves on push (splitting it into "Interfaces " + " Data") and materializes to broken, git-hostile
/// directories on pull. Names can also carry `\`, Windows-reserved characters, leading/trailing spaces or
/// dots (Windows strips a trailing dot; a leading dot hides the directory from dotfile-skipping tooling —
/// including the LSP's own file scan — as seen with a real ".Interfaces / Data" folder in Pro2193).
///
/// <see cref="Encode"/> percent-escapes exactly those hazards; everything else (letters, digits, internal
/// spaces) stays literal so paths remain readable ("Interfaces / Data" → "Interfaces %2F Data").
/// <see cref="Decode"/> restores the exact original name for pushing back to the IDE. Applied per segment at
/// the bridge boundary only (walk emits, ResolveFolder consumes), so the wire folder is a plain safe string
/// everywhere downstream — volt-git treats it opaquely.
/// </summary>
public static class FolderPath
{
    /// <summary>Append one folder segment (by its raw IDE name) to an already-encoded path.</summary>
    public static string Append(string path, string segmentName) =>
        string.IsNullOrEmpty(path) ? Encode(segmentName) : path + "/" + Encode(segmentName);

    /// <summary>The decoded segment names of an encoded folder path (empty for a root-level item).</summary>
    public static IEnumerable<string> Segments(string? path) =>
        string.IsNullOrEmpty(path) ? Enumerable.Empty<string>() : path!.Split('/').Select(Decode);

    /// <summary>Reversibly encode an ITEM name (a single tree-item / file basename) into a filesystem-safe
    /// token — same codec as a folder segment. Source item names are IEC-clean, but a synthetic reference
    /// name (a placeholder library's `* (System)` version) can carry a Windows-illegal char.</summary>
    public static string EncodeName(string name) => Encode(name);

    /// <summary>Reversibly encode one segment name into a `/`-free, filesystem-safe token.</summary>
    public static string Encode(string name)
    {
        var sb = new StringBuilder(name.Length);
        for (int i = 0; i < name.Length; i++)
        {
            char c = name[i];
            bool edgeSpace = c == ' ' && (i == 0 || i == name.Length - 1);
            // Leading dot: a hidden directory (Unix/git convention). Tooling that ignores dotfiles — including
            // the LSP's own file scan — would silently drop the folder's contents, and it risks colliding with
            // .git/.opencode. Encode it so the folder is visible. (A trailing dot Windows also strips outright.)
            bool edgeDot = c == '.' && (i == 0 || i == name.Length - 1);
            if (c == '%' || IsHostile(c) || edgeSpace || edgeDot)
                sb.Append('%').Append(((int)c).ToString("X2", CultureInfo.InvariantCulture));
            else
                sb.Append(c);
        }
        return sb.ToString();
    }

    /// <summary>Inverse of <see cref="Encode"/> — restore the exact original segment name.</summary>
    public static string Decode(string token)
    {
        var sb = new StringBuilder(token.Length);
        for (int i = 0; i < token.Length; i++)
        {
            if (token[i] == '%' && i + 2 < token.Length
                && int.TryParse(token.Substring(i + 1, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var code))
            {
                sb.Append((char)code);
                i += 2;
            }
            else sb.Append(token[i]);
        }
        return sb.ToString();
    }

    // Path separators, Windows-reserved filename characters, and control characters — never safe in a path
    // component. `%` is escaped separately (in Encode) so the scheme stays reversible.
    private static bool IsHostile(char c) =>
        c is '/' or '\\' or ':' or '*' or '?' or '"' or '<' or '>' or '|' || c < 0x20;
}
