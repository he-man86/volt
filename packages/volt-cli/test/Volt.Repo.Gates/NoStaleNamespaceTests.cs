using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Xunit;
using Xunit.Abstractions;

namespace Volt.Repo.Gates;

/// <summary>
/// No source file or document names a namespace that no longer exists.
///
/// <para><b>This guard exists because the same thing has now happened twice.</b>
/// `restructure-plcopen-layer` renamed the engine's namespaces and closed without checking for references to the
/// old ones; ten stale symbol references survived into the source and two into `ARCHITECTURE.md`, and they were
/// still there a whole restructure later. Then a SECOND, unrecorded rename landed on top, so that change's own
/// documents described a layout that did not exist.</para>
///
/// <para>A stale namespace name in a comment is not a compile error and never will be — which is exactly why it
/// needs a test. The cost is not cosmetic: `GraphSplice.cs` spent two restructures asserting it "belongs with the
/// graph, not with the document" while sitting in the document folder, and that claim was one of the things that
/// kept a dead parallel write path looking intentional.</para>
///
/// <para>The rule for the next rename is therefore mechanical rather than remembered: add the old name here, and
/// the build stays red until every reference to it is gone.</para>
/// </summary>
public class NoStaleNamespaceTests
{
    private readonly ITestOutputHelper _out;
    public NoStaleNamespaceTests(ITestOutputHelper o) => _out = o;

    /// <summary>Namespace segments that have been renamed away. Each entry is the FULL old namespace, so a
    /// legitimate use of the bare word (a folder called `Source`, the word "text") is never matched.</summary>
    private static readonly string[] Retired =
    {
        // engine-layout, 2026-08-27: named after a dependency level, not a subject.
        "Volt.Engine.Vocabulary",
        "Volt.Engine.Model",
        // engine-layout: a body language's implementation belongs under the body.
        "Volt.Engine.Text",
        "Volt.Engine.Graph",
        "Volt.Engine.Document",
        // pou-transport-per-vendor, 2026-08-28: `Source` read as "source code" and quietly accommodated a
        // VENDOR's format. Split by what each file is: Volt's own formats under `Format/`, PLCopen under
        // `PlcOpen/` (which is on its way out entirely), the neutral contract type under `Item/`.
        "Volt.Engine.Source",
        // engine-layout: proposed and REJECTED — `Ops` collides with `Volt.Contracts.Ops`, the wire op-code
        // vocabulary. Listed so the collision is not rediscovered by someone renaming `Sync/` again.
        "Volt.Engine.Ops",
    };

    /// <summary>Everything a reader could be misled by: source, tests, the architecture doc, the repo guide.
    /// <para>NOT `openspec/changes/` — a closed change is a frozen record of what was true when it was written,
    /// and rewriting one to keep a guard green destroys the evidence. `restructure-plcopen-layer` carries a
    /// post-close note instead.</para></summary>
    private static IEnumerable<string> Scanned(string repo)
    {
        foreach (var rel in new[] { Path.Combine("packages", "volt-cli", "src"),
                                    Path.Combine("packages", "volt-cli", "test"),
                                    Path.Combine("packages", "volt-cli", "docs") })
        {
            var dir = Path.Combine(repo, rel);
            if (!Directory.Exists(dir)) continue;
            foreach (var f in Directory.EnumerateFiles(dir, "*.*", SearchOption.AllDirectories))
            {
                if (f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}") ||
                    f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")) continue;
                // This file NAMES the retired namespaces — that is its whole content — so it cannot scan itself.
                if (Path.GetFileName(f) == "NoStaleNamespaceTests.cs") continue;
                if (f.EndsWith(".cs") || f.EndsWith(".md") || f.EndsWith(".ts")) yield return f;
            }
        }
        foreach (var doc in new[] { Path.Combine("packages", "volt-cli", "ARCHITECTURE.md"), "CLAUDE.md" })
        {
            var p = Path.Combine(repo, doc);
            if (File.Exists(p)) yield return p;
        }
    }

    [Fact]
    public void Nothing_references_a_namespace_that_was_renamed_away()
    {
        var repo = RepoRoot();
        var scanned = 0;
        var offenders = new List<string>();

        foreach (var file in Scanned(repo))
        {
            scanned++;
            var lineNo = 0;
            foreach (var line in File.ReadLines(file))
            {
                lineNo++;
                foreach (var old in Retired)
                {
                    var i = line.IndexOf(old, StringComparison.Ordinal);
                    if (i < 0) continue;
                    // `Volt.Engine.Source` must not match `Volt.Engine.Sou` — require a non-identifier after.
                    var after = i + old.Length;
                    if (after < line.Length && (char.IsLetterOrDigit(line[after]) || line[after] == '_')) continue;
                    offenders.Add($"{Path.GetFileName(file)}:{lineNo}: {line.Trim()}");
                }
            }
        }

        // A guard that scanned nothing passes for the wrong reason — the same floor the other source guards keep.
        Assert.True(scanned >= 60, $"only {scanned} file(s) scanned from {repo} — the guard is not looking at the repo.");
        _out.WriteLine($"scanned {scanned} files for {Retired.Length} retired namespace(s)");

        Assert.True(offenders.Count == 0,
            "These name a namespace that no longer exists. A stale namespace in a comment is not a compile error " +
            "and never will be, which is why it is a test: the last two renames each left references behind, and " +
            "one of them kept a dead code path looking intentional for two restructures.\n  " +
            string.Join("\n  ", offenders));
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "CLAUDE.md"))) dir = dir.Parent;
        Assert.True(dir is not null, "could not locate the repo root from the test output folder");
        return dir!.FullName;
    }
}
