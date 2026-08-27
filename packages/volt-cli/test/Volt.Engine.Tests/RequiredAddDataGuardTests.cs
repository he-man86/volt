using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;
using Xunit.Abstractions;

namespace Volt.Cli.Tests;

/// <summary>
/// No production code may REQUIRE a vendor <c>addData</c> block.
///
/// <para>This is the general form of the outage that produced it. <c>InterfaceAsPlainText</c> is not part of
/// PLCopen — it is a vendor extension carried as
/// <c>&lt;data name="http://www.3s-software.com/plcopenxml/interfaceasplaintext" handleUnknown="implementation"&gt;</c>.
/// The TC6 XSD defines <c>addData</c> as <i>"application specific data defined in external schemata"</i> with a
/// REQUIRED <c>handleUnknown</c> attribute enumerating <c>preserve</c> / <c>discard</c> / <c>implementation</c>.
/// The standard has a vocabulary for DISMISSING vendor data — so requiring one such block is requiring something
/// a conforming processor is told it may drop.</para>
///
/// <para>Volt required exactly one (<c>parsed.Declaration ?? throw</c>), and when TwinCAT stopped emitting it,
/// <b>every POU on that vendor became unreadable</b> and <c>refs</c> answered with no POUs at all. The throw had
/// been added on a measurement that read "instrumenting the arm to throw produced ZERO hits across 195 live e2e
/// tests on both vendors" — true when taken, and falsified by a vendor changing its mind.</para>
///
/// <para><b>What this is and is not.</b> It is a source scan for a THROW whose message names an addData block, not
/// a proof that Volt tolerates every possible omission. It catches the shape that took out a vendor: a hard
/// failure raised because an optional extension was absent. Reading such a block opportunistically is fine and is
/// not flagged.</para>
/// </summary>
public class RequiredAddDataGuardTests
{
    private readonly ITestOutputHelper _out;
    public RequiredAddDataGuardTests(ITestOutputHelper o) => _out = o;

    /// <summary>The vendor extensions Volt genuinely depends on, each with the reason — so the dependency is
    /// DECLARED rather than assumed, which is the whole difference between this and what happened.
    /// <para>An entry here is a standing risk, not an exemption: if a vendor drops one of these the way TwinCAT
    /// dropped <c>interfaceasplaintext</c>, that capability degrades. Both are structural rather than content —
    /// losing them costs placement, not an engineer's source text.</para></summary>
    private static readonly Dictionary<string, string> Declared = new(StringComparer.OrdinalIgnoreCase)
    {
        ["objectid"] =
            "identity across a rename. Absent, Volt falls back to the name — which is the wire's identity anyway " +
            "(see the protocol invariant), so the degradation is bounded.",
        ["interfaceasplaintext"] =
            "the LAST declaration still written into a document: a property ACCESSOR's, via " +
            "`PouSplice.SetAccessor` -> `Declaration.Write`. Root, member and DUT/GVL declarations all moved to " +
            "the IDE's declaration aspect; this one has not, and it is a KNOWN latent outage on the TwinCAT " +
            "install measured in openspec/changes/declaration-from-the-aspect — an accessor with a non-empty " +
            "declaration would refuse the push there. It stays only because moving it CRASHED TcXaeShell " +
            "(0x800706BE RPC_S_CALL_FAILED) on INTERFACE properties, taking a green 141/0 suite to 135/9; the " +
            "attempt is reverted and the crash is not yet understood. Accessor declarations are blank in every " +
            "fixture and every live project measured, which is why nothing fails today. Tracked as open.",
        ["projectstructure"] =
            "in-POU folder placement. Absent, members materialize folder-less; `RestoreChildFolders` re-places " +
            "from Volt's OWN `%FOLDER` directive rather than from this block, so the loss is recoverable.",
    };

    /// <summary>Every addData name that appears in a THROW message under `src/`. A throw is the signal because it
    /// is the difference between "this vendor extension is missing, carry on" and "this item is unreadable".</summary>
    [Fact]
    public void No_production_throw_requires_a_vendor_addData_block()
    {
        var src = FindSrcDir();
        var offenders = new List<string>();

        foreach (var file in Directory.EnumerateFiles(src, "*.cs", SearchOption.AllDirectories))
        {
            if (file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}") ||
                file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}")) continue;

            var text = File.ReadAllText(file);
            // A throw statement plus the message that follows it, across the line breaks a long message takes.
            foreach (Match t in Regex.Matches(text, @"throw new [\s\S]{0,600}?;"))
            {
                foreach (var name in AddDataNames(t.Value))
                {
                    if (Declared.ContainsKey(name)) continue;
                    var line = text.Take(t.Index).Count(c => c == '\n') + 1;
                    offenders.Add($"{Path.GetRelativePath(src, file)}:{line}  requires '{name}'");
                }
            }
        }

        foreach (var o in offenders) _out.WriteLine(o);
        Assert.True(offenders.Count == 0,
            "production code REFUSES to proceed without a vendor addData block. `handleUnknown` is " +
            "preserve/discard/implementation by specification, so a required vendor extension is a latent " +
            "outage — this is how every TwinCAT POU became unreadable at once:\n  " +
            string.Join("\n  ", offenders) +
            "\n\nRead the block opportunistically, or take the value from the IDE's own object model. If Volt " +
            "genuinely depends on it, add it to `Declared` WITH the reason and the bound on the degradation.");
    }

    /// <summary>The known vendor-extension names, as they appear in a message. Matched on the bare name rather
    /// than the full namespace URI because a message quotes the ELEMENT (<c>&lt;InterfaceAsPlainText&gt;</c>),
    /// while the document carries the URI.</summary>
    private static IEnumerable<string> AddDataNames(string throwText) =>
        new[]
        {
            "interfaceasplaintext", "objectid", "projectstructure", "fbdcalltype",
            "implementationattributes", "fbdelementtype", "inputparamtypes", "outputparamtypes",
        }.Where(n => throwText.Contains(n, StringComparison.OrdinalIgnoreCase));

    private static string FindSrcDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "src"))) dir = dir.Parent;
        Assert.True(dir is not null, "could not locate the volt-cli src/ directory from the test output folder");
        return Path.Combine(dir!.FullName, "src");
    }
}
