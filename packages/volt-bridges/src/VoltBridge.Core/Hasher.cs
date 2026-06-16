using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace VoltBridge.Core;

/// <summary>
/// Canonical content-version hashing, shared by every bridge so the same project
/// yields identical versions regardless of vendor. Adapters MUST route here rather
/// than reimplement it — the wire protocol's change-detection depends on a single,
/// stable hash format.
/// </summary>
public static class Hasher
{
    /// <summary>16-hex-char SHA-1 of the input (the building block for all versions).</summary>
    public static string ComputeSha1Short(string? input)
    {
        using var sha1 = SHA1.Create();
        var hash = sha1.ComputeHash(Encoding.UTF8.GetBytes(input ?? ""));
        return ToHex(hash).Substring(0, 16);
    }

    /// <summary>Per-item content version: hash of the item's FOLDER + its MATERIALIZED workspace text
    /// (the exact <c>.st</c>/<c>.fbd</c>/<c>.enum</c> bytes the CLI writes, or the manifest for
    /// non-source kinds). Content-addressed: same version ⇔ same file content, identical across both
    /// bridges. Folder is included so a move re-versions the item.</summary>
    public static string ComputeItemVersion(string? folderPath, string? materializedText)
    {
        var sb = new StringBuilder();
        sb.Append("folder=").Append(folderPath ?? "").Append('\0');
        sb.Append("src=").Append(materializedText ?? "").Append('\0');
        return ComputeSha1Short(sb.ToString());
    }

    /// <summary>Project version: ordinal-sorted "name:version" lines (content-sensitive).</summary>
    public static string ComputeProjectVersion(Dictionary<string, string> versions)
    {
        var sb = new StringBuilder();
        foreach (var kvp in versions.OrderBy(p => p.Key, System.StringComparer.Ordinal))
            sb.Append(kvp.Key).Append(':').Append(kvp.Value).Append('\n');
        return ComputeSha1Short(sb.ToString());
    }

    /// <summary>Structure version: ordinal-sorted names only (changes when items add/remove/rename).</summary>
    public static string ComputeStructureVersion(Dictionary<string, string> versions)
    {
        var sb = new StringBuilder();
        foreach (var name in versions.Keys.OrderBy(n => n, System.StringComparer.Ordinal))
            sb.Append(name).Append('\n');
        return ComputeSha1Short(sb.ToString());
    }

    private static string ToHex(byte[] bytes)
    {
        var sb = new StringBuilder(bytes.Length * 2);
        foreach (var b in bytes) sb.Append(b.ToString("x2"));
        return sb.ToString();
    }
}
