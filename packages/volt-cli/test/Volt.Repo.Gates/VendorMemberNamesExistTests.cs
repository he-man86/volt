using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Volt.Repo.Gates;

/// <summary>
/// EVERY TWINCAT MEMBER NAME THE CODE READS MUST EXIST IN A COMMITTED ARCHIVE.
///
/// <para><b>The offline suite structurally cannot catch a wrong member name, and that is not a criticism of it
/// — it is what its doubles are for.</b> <c>Volt.Ide.Twincat.Tests</c> drives its collaborators through
/// <c>dynamic</c>, so a test double is satisfied by matching METHOD names; nothing there ever compares a
/// vendor's own MEMBER spelling against a real <c>.TcPOU</c>. So a call that asks the archive for a member it
/// does not have compiles, runs, answers null or empty, and every test still passes.</para>
///
/// <para><b>It has already cost a shipped feature.</b> The wired-EN repair in <c>TcNetworkWriter</c> read
/// <c>InputParam</c> through <c>Element("l")</c> where the archive writes <c>&lt;l2 n="Names"&gt;</c>, and set a
/// member spelled <c>En</c> where the archive spells <c>EN</c>. Both are silent misses — the wrong accessor
/// answers EMPTY rather than throwing — so the block never executed once, the round trip passed anyway (the
/// real fix was in the emission), and a DIALECT row recorded the repair as the measured cause for weeks. This
/// gate is exactly the check that was missing: it would have failed on the day <c>"En"</c> was written.</para>
///
/// <para><b>How it decides.</b> Member names reach the archive through a small set of accessors whose FIRST
/// string literal argument is the name (<c>Str(e, "BoxType")</c>, <c>Obj(e, "Instance")</c>, …). Each of those
/// literals must appear as an <c>n="…"</c> attribute in at least one committed fixture. That is a weaker claim
/// than "the vendor has this member" and deliberately so: the fixtures are real IDE output, so appearing in one
/// proves the spelling is the vendor's, while absence proves only that nothing we hold demonstrates it — which
/// is precisely when a name should be looked at twice.</para>
///
/// <para>A name the fixtures cannot demonstrate goes in <see cref="NotInAnyFixture"/> WITH ITS REASON, so the
/// list is a census of what is unproven rather than a mute suppression.</para>
/// </summary>
public class VendorMemberNamesExistTests
{
    /// <summary>The accessors whose first string argument names an archive member.</summary>
    private static readonly Regex MemberRead = new(
        @"\b(?:Str|Obj|Bool|Int|List|Slots|Items|Strings|RequireObj|RequireList|SetString|SetBool|SetInt|Set)\s*\(\s*[^,()]+,\s*""([A-Za-z][A-Za-z0-9_]*)""",
        RegexOptions.Compiled);

    /// <summary>Names no committed fixture demonstrates, each with why it is allowed to be absent. A name here
    /// is UNPROVEN, not blessed — the reason has to say how it would be confirmed.</summary>
    private static readonly Dictionary<string, string> NotInAnyFixture = new(StringComparer.Ordinal)
    {
        // ONE OF THE THREE UNPROVEN NODE TYPES IS NOW PROVEN, and it took a hand-drawn body to do it.
        //
        // `BoxTreeOperand`, `BoxTreeBox` and `BoxTreeAssign` were always demonstrated. `BoxTreeDemux` now is
        // too — `ladder-demux.TcPOU` carries three, so `VarId` and `Input` came off this list. It was drawn by
        // hand in XAE's LADDER editor: a contact whose output BRANCHES, one path into an OR box and another to
        // a second coil.
        //
        // THE CREATE PATH CANNOT REACH IT, which is why this needed a person and not a test. Pushed through
        // the PLCopen importer the same fan-out comes back as ONE `BoxTreeAssign` with TWO `OutputItems` — the
        // importer spells a shared wire as a multi-target assign, and only the editor builds the Demux. A
        // measurement of the importer is not a measurement of the vendor.
        //
        // `BoxTreeParallel` is still unproven and may be unreachable on this vendor: drawing parallel contacts
        // produced an OR BOX, and the ladder rendering of an OR box is parallel contacts, so the two are hard
        // to tell apart from the drawing alone. FBD, LD and IL are three views of ONE network here (see
        // `TcArchive`), so there may be no separate parallel object to make. `BoxTreeTerminator` likewise: an
        // unconnected input pin stores as an empty OPERAND, not a terminator.
        ["Trees"] = "BoxTreeParallel — no committed archive contains one; drawing parallel contacts in XAE " +
                    "produces an OR box instead, so this may be unreachable on TwinCAT rather than merely " +
                    "unsampled. Needs a hand-drawn body that yields one, or a note that none exists.",
        ["Mode"] = "BoxTreeParallel.Mode (OperationMode) — no committed archive contains a Parallel (see Trees). The " +
                   "reader refuses an absent or unknown value by name, so a wrong spelling reaches the marker, not a guess.",
    };

    private static readonly string[] Sources =
    {
        Path.Combine("src", "Volt.Ide.Twincat", "Ide", "TcArchive.cs"),
        Path.Combine("src", "Volt.Ide.Twincat", "Ide", "TcNetworkReader.cs"),
        Path.Combine("src", "Volt.Ide.Twincat", "Ide", "TcNetworkWriter.cs"),
    };

    [Fact]
    public void Every_member_name_the_code_reads_appears_in_a_committed_fixture()
    {
        var root = RepoRoot();
        var attributes = FixtureAttributeNames(root);
        Assert.True(attributes.Count > 50,
            $"only {attributes.Count} distinct n=\"…\" names across the fixtures — the corpus is too thin for " +
            "this gate to mean anything; check the fixture path before trusting a pass.");

        var missing = new List<string>();
        foreach (var rel in Sources)
        {
            var path = Path.Combine(root, "packages", "volt-cli", rel);
            Assert.True(File.Exists(path), $"gate points at a file that no longer exists: {rel}");
            foreach (Match m in MemberRead.Matches(StripComments(File.ReadAllText(path))))
            {
                var name = m.Groups[1].Value;
                if (attributes.Contains(name) || NotInAnyFixture.ContainsKey(name)) continue;
                missing.Add($"{Path.GetFileName(rel)}: \"{name}\"");
            }
        }

        Assert.True(missing.Count == 0,
            "these TwinCAT member names appear in no committed .TcPOU — either the spelling is wrong (the `En` " +
            "vs `EN` class of bug) or the shape needs a fixture that demonstrates it:\n  " +
            string.Join("\n  ", missing.Distinct().OrderBy(x => x, StringComparer.Ordinal)));
    }

    /// <summary>The gate must be able to FAIL — a regex that matched nothing would pass silently forever, which
    /// is the failure mode a name-based gate is most prone to.</summary>
    [Fact]
    public void The_gate_can_fail_and_does_read_real_names()
    {
        var found = MemberRead.Matches(
                "var a = TcArchive.Str(e, \"BoxType\"); var b = TcArchive.Obj(e, \"NoSuchMemberXyz\");")
            .Select(m => m.Groups[1].Value).ToList();
        Assert.Equal(new[] { "BoxType", "NoSuchMemberXyz" }, found);

        // ...and a name the fixtures genuinely do not carry is reported rather than silently accepted.
        var attributes = FixtureAttributeNames(RepoRoot());
        Assert.Contains("BoxType", attributes);
        Assert.DoesNotContain("NoSuchMemberXyz", attributes);

        // The comment stripper must not eat code: the archive's own docs quote `n="EN"` in prose constantly, and
        // counting those as evidence would make the gate agree with any spelling it had just written down.
        Assert.Equal("var x = Str(e, \"Real\");", StripComments(
            "// Str(e, \"FromAComment\");\nvar x = Str(e, \"Real\");\n/// <summary>Str(e, \"FromDoc\")</summary>").Trim());
    }

    /// <summary>Every distinct <c>n="…"</c> name across the committed TwinCAT fixtures — the vendor's own
    /// spelling, since these files are real IDE output.</summary>
    private static HashSet<string> FixtureAttributeNames(string root)
    {
        var dir = Path.Combine(root, "packages", "volt-cli", "test", "Volt.Ide.Twincat.Tests", "fixtures");
        Assert.True(Directory.Exists(dir), $"fixture directory not found: {dir}");
        var names = new HashSet<string>(StringComparer.Ordinal);
        var attr = new Regex(@"\bn=""([A-Za-z][A-Za-z0-9_]*)""", RegexOptions.Compiled);
        foreach (var f in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
            foreach (Match m in attr.Matches(File.ReadAllText(f)))
                names.Add(m.Groups[1].Value);
        return names;
    }

    /// <summary>Source with `//`, `///` and `/* */` removed. Doc comments here quote member names in prose, and
    /// a gate that read those would confirm a spelling from the same file that invented it.</summary>
    private static string StripComments(string source) =>
        Regex.Replace(Regex.Replace(source, @"/\*.*?\*/", "", RegexOptions.Singleline), @"//.*?$", "",
            RegexOptions.Multiline);

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "CLAUDE.md"))) dir = dir.Parent;
        Assert.True(dir is not null, "could not locate the repo root from the test output folder");
        return dir!.FullName;
    }
}
