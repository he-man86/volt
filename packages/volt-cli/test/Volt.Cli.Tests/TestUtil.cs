using System;
using System.IO;
using Volt.Cli.Sync;

namespace Volt.Cli.Tests;

/// <summary>Shared test helpers — a throwaway git repo with a definite identity, and a Windows-safe recursive
/// delete (git marks loose objects read-only, which plain Directory.Delete can't remove).</summary>
internal static class TestUtil
{
    public static string NewRepo()
    {
        Environment.SetEnvironmentVariable("GIT_AUTHOR_NAME", "t");
        Environment.SetEnvironmentVariable("GIT_AUTHOR_EMAIL", "t@t");
        Environment.SetEnvironmentVariable("GIT_COMMITTER_NAME", "t");
        Environment.SetEnvironmentVariable("GIT_COMMITTER_EMAIL", "t@t");
        var dir = Directory.CreateTempSubdirectory("volt-test-").FullName;
        Git.GitInit(dir);
        return dir;
    }

    public static void ForceDelete(string dir)
    {
        if (!Directory.Exists(dir)) return;
        foreach (var f in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
            try { File.SetAttributes(f, FileAttributes.Normal); } catch { /* best effort */ }
        try { Directory.Delete(dir, true); } catch { /* best effort */ }
    }
}
