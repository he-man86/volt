using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;
using Xunit.Abstractions;

namespace Volt.Repo.Gates;

/// <summary>
/// Nothing under <c>src/</c> is reachable only from tests.
///
/// <para>This is the general form of the finding the whole `splice-graphical-body` change came out of. The write
/// path was unified three times, and <b>each unification left its predecessor standing</b> — shipped, compiled,
/// documented, and called by nothing:</para>
///
/// <list type="bullet">
/// <item><c>GraphSplice.SpliceFbdLdBody</c> + its helpers — ~97 lines implementing a SECOND graphical write path,
///   with a weaker element scan than the live one.</item>
/// <item><c>PushService.RemoveOrphanChildren</c> — 19 lines, superseded when member removal moved into the
///   document splice. A bug fix was later applied to it, inertly.</item>
/// <item><c>NetworkCodeIo</c> + <c>PlcOpenDocument.DeclFromExport</c> — 66 lines whose own doc-comment said
///   "A TEST SEAM, kept deliberately", in <c>src/Volt.Engine/Sync/</c>.</item>
/// </list>
///
/// <para>Three instances, none noticed by any existing gate, because nothing checks whether shipped code is
/// reachable. The compiler cannot: a <c>public</c> member is never "unused". Tests cannot either — they were the
/// callers, which is exactly what made the code look alive.</para>
///
/// <para><b>What this is not.</b> It is a name scan, not a call-graph. It asks whether a declared name appears
/// anywhere in <c>src/</c> other than its own declaration, which is coarse: it cannot see a name reached only
/// through reflection, and it would not notice a whole cluster of types that reference each other and nothing
/// else. It catches the shape that actually occurred three times — one entry point, called from tests only — and
/// that is the bar it is held to.</para>
/// </summary>
public class NoTestOnlyCodeInSrcTests
{
    private readonly ITestOutputHelper _out;
    public NoTestOnlyCodeInSrcTests(ITestOutputHelper o) => _out = o;

    /// <summary>Entry points whose only caller is legitimately outside the scanned tree.
    /// <para>Every entry carries its reason. An exemption with no reason is how an allowlist turns into a place
    /// to put things that fail.</para></summary>
    private static readonly Dictionary<string, string> Allowed = new(StringComparer.Ordinal)
    {
        ["Main"] = "process entry point — the runtime calls it",

        ["CreateKillOnClose"] = "called from the containing file, on a sibling type it cannot be private to",

        ["ResetOnceKeysForTest"] = "a test hook, and it says so in its name — BridgeLog's once-keys are static, " +
                                  "so a test that asserts a warning fires ONCE has to clear them between cases",

        ["ChooseBridgePipe"] = "the pipe-selection RULE, split out so it can be driven with a list of candidate " +
                               "pipes instead of a live machine — its production caller passes the real list " +
                               "from the same file",

        // Deliberate reference implementations. `FastImport_tree_matches_hash_object_plus_BuildTree` asserts the
        // fast-import path produces a byte-identical tree SHA to plumbing git — so these exist to be the OTHER
        // answer in a differential test, and a differential test with one implementation is not one.
        ["BuildTree"] = "reference implementation for the fast-import differential test",
        ["WriteBlob"] = "reference implementation for the fast-import differential test",
    };

    [Fact]
    public void Every_public_method_in_the_engine_has_a_caller_outside_its_own_file()
    {
        var src = FindSrcDir();
        var files = Directory.EnumerateFiles(src, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}") &&
                        !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}"))
            .ToList();

        // A guard that scanned nothing passes for the wrong reason — the same floor the other source guards keep.
        Assert.True(files.Count >= 60,
            $"only {files.Count} .cs file(s) under {src} — the guard is not looking at the toolchain.");

        var bodies = files.ToDictionary(f => f, File.ReadAllText);

        // `public`/`internal` STATIC methods only. Instance methods are reached through interfaces and overrides
        // that a name scan cannot follow, and a false accusation is worse than a miss in a guard nobody can
        // silence except by deleting real code.
        var decl = new Regex(
            @"^\s*(?:public|internal)\s+static\s+(?:readonly\s+)?[\w<>,\[\]\?\. ]+?\s+(\w+)\s*(?:<[^>]*>)?\s*\(",
            RegexOptions.Multiline);

        var orphans = new List<string>();
        foreach (var (file, text) in bodies)
        {
            foreach (Match m in decl.Matches(text))
            {
                var name = m.Groups[1].Value;
                if (Allowed.ContainsKey(name)) continue;
                if (name is "get" or "set" or "if" or "while" or "for" or "foreach" or "switch" or "return") continue;

                // The bare NAME, not `name(`. A method group — `SelectMany(Materialize.MaterializeItem)` — is a
                // real call site with no parentheses, and requiring them accused live production code of being
                // test-only. Coarser on purpose: a false miss costs one undetected orphan, a false accusation
                // costs someone deleting working code because a guard told them to.
                var called = new Regex(@"\b" + Regex.Escape(name) + @"\b");
                var elsewhere = bodies.Any(kv => kv.Key != file && called.IsMatch(kv.Value));
                if (!elsewhere)
                    orphans.Add($"{Path.GetFileName(file)}: {name}");
            }
        }

        foreach (var o in orphans) _out.WriteLine(o);

        Assert.True(orphans.Count == 0,
            "These are declared in src/ and called from nowhere else in src/ — so if anything runs them, it is a " +
            "test. Shipped code that only tests reach is how three separate superseded write paths survived in " +
            "this repo, each looking covered because its tests were the callers.\n  " +
            string.Join("\n  ", orphans) +
            "\n\nDelete it, or — if it is genuinely reached from outside the scan (reflection, a runtime entry " +
            "point) — add it to `Allowed` WITH the reason.");
    }

    private static string FindSrcDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "src"))) dir = dir.Parent;
        Assert.True(dir is not null, "could not locate the volt-cli src/ directory from the test output folder");
        return Path.Combine(dir!.FullName, "src");
    }
}
