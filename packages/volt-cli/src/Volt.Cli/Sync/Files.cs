namespace Volt.Cli.Sync;

public sealed record SrcFile(string Path, string Content);

/// <summary>Workspace file IO — reads/writes the <c>src/</c> tree (the PLC text) and the root
/// <c>.gitignore</c>/<c>.gitattributes</c>. All paths are src-relative; on disk they live at
/// <c>&lt;root&gt;/src/&lt;path&gt;</c>. C# port of the original TypeScript implementation</summary>
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

    /// <summary>Ensure the root <c>.gitignore</c> ignores Rust build output, and seed <c>.gitattributes</c>
    /// (blanket LF) if absent.</summary>
    public static void EnsureGitignore(string root)
    {
        var giPath = System.IO.Path.Combine(root, ".gitignore");
        var wanted = new[] { "/rust/target/" };
        var lines = File.Exists(giPath) ? File.ReadAllText(giPath).Split('\n').ToList() : new List<string>();
        var changed = false;
        foreach (var w in wanted)
            if (!lines.Any(l => l.Trim() == w)) { lines.Add(w); changed = true; }
        if (changed)
        {
            if (lines.Count > 0 && lines[^1].Length == 0) lines.RemoveAt(lines.Count - 1); // drop one trailing blank
            File.WriteAllText(giPath, string.Join("\n", lines) + "\n");
        }

        var gaPath = System.IO.Path.Combine(root, ".gitattributes");
        if (!File.Exists(gaPath)) File.WriteAllText(gaPath, Extensions.GitattributesContent());
    }
}
