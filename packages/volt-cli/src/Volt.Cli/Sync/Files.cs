using Volt.Contracts;
namespace Volt.Cli.Sync;

public sealed record SrcFile(string Path, string Content);

/// <summary>Workspace file IO — reads/writes the <c>src/</c> tree (the PLC text) and seeds the root
/// <c>.gitattributes</c>. All paths are src-relative; on disk they live at
/// <c>&lt;root&gt;/src/&lt;path&gt;</c>.</summary>
public static class Files
{
    public const string SrcDir = "src";

    public static string StripSrcPrefix(string p) => p.StartsWith(SrcDir + "/", StringComparison.Ordinal) ? p.Substring(SrcDir.Length + 1) : p;

    // onProgress (done, total) lets a large init report disk-write progress — kept as a plain callback so Files
    // stays decoupled from the wire's ProgressFrame; the caller maps it.
    public static void WriteSrcFiles(string root, IReadOnlyList<SrcFile> files, Action<int, int>? onProgress = null)
    {
        for (var i = 0; i < files.Count; i++)
        {
            var f = files[i];
            var abs = System.IO.Path.Combine(root, SrcDir, f.Path);
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(abs)!);
            File.WriteAllText(abs, f.Content);
            if (onProgress != null && ((i + 1) % 25 == 0 || i + 1 == files.Count)) onProgress(i + 1, files.Count);
        }
    }

    /// <summary>Seed the root <c>.gitattributes</c> (blanket LF — the bridge always emits LF) if absent. A Volt
    /// workspace is all tracked text (no build artifacts), so there's nothing to <c>.gitignore</c>.</summary>
    public static void EnsureGitattributes(string root)
    {
        var gaPath = System.IO.Path.Combine(root, ".gitattributes");
        if (!File.Exists(gaPath)) File.WriteAllText(gaPath, Extensions.GitattributesContent());
    }
}
