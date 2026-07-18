namespace Volt.Cli.Sync;

public sealed record SrcFile(string Path, string Content);

/// <summary>Workspace file IO — reads/writes the <c>src/</c> tree (the PLC text) and the root
/// <c>.gitignore</c>/<c>.gitattributes</c>. All paths are src-relative; on disk they live at
/// <c>&lt;root&gt;/src/&lt;path&gt;</c>. C# port of packages/volt-git/src/files.ts.</summary>
public static class Files
{
    public const string SrcDir = "src";

    public static string StripSrcPrefix(string p) => p.StartsWith(SrcDir + "/", StringComparison.Ordinal) ? p.Substring(SrcDir.Length + 1) : p;

    public static void WriteSrcFiles(string root, IReadOnlyList<SrcFile> files)
    {
        foreach (var f in files)
        {
            var abs = System.IO.Path.Combine(root, SrcDir, f.Path);
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(abs)!);
            File.WriteAllText(abs, f.Content);
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
