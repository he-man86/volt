using System;
using System.IO;

namespace Volt.Tests.Shared;

/// <summary>Where the test binary sits in the repository — ONE walk up from <see cref="AppContext.BaseDirectory"/>, linked
/// into every test project (<c>test/Directory.Build.targets</c>). It was copied into some twenty tests, with three
/// spellings of the marker (<c>Volt.sln</c>, <c>packages/volt-cli/Volt.sln</c>, <c>CLAUDE.md</c>).</summary>
public static class RepoPaths
{
    /// <summary>The <c>volt-cli</c> package root: the directory holding <c>Volt.sln</c>.</summary>
    public static DirectoryInfo PackageDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "Volt.sln"))) dir = dir.Parent;
        return dir ?? throw new InvalidOperationException("could not locate Volt.sln above the test assembly " + AppContext.BaseDirectory);
    }

    /// <summary>The repository root, two levels above the package (<c>packages/volt-cli</c>).</summary>
    public static DirectoryInfo RepoDir() =>
        PackageDir().Parent?.Parent ?? throw new InvalidOperationException("the volt-cli package is not under <repo>/packages");
}
