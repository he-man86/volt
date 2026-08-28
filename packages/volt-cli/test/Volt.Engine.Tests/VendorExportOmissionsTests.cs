using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;
using Xunit.Abstractions;
using Volt.Engine.Source;

namespace Volt.Cli.Tests;

/// <summary>
/// What a TwinCAT PLCopen export DOES NOT CONTAIN — pinned against recorded vendor bytes, because every claim in
/// this area was previously an inference and two of them were wrong.
///
/// <para>Both fixtures are live exports from TcXaeShell, recorded 2026-08-27 alongside the change that needed
/// them (<c>openspec/changes/declaration-from-the-aspect</c>). They are the evidence, not an illustration: an
/// absence is exactly the thing a synthetic fixture cannot honestly represent, because a hand-written document
/// omits whatever its author forgot rather than whatever the vendor omits.</para>
/// </summary>
public class VendorExportOmissionsTests
{
    private readonly ITestOutputHelper _out;
    public VendorExportOmissionsTests(ITestOutputHelper o) => _out = o;

    private static string Fixture(string file) =>
        File.ReadAllText(Path.Combine(System.AppContext.BaseDirectory, "fixtures", "tc-pou", file));

    // ── the declaration ─────────────────────────────────────────────────────────────────────────────

    /// <summary>THE REGRESSION, preserved. `FB_PackML_Unit` declares 45 variables and its export carries NO
    /// <c>&lt;InterfaceAsPlainText&gt;</c> — so the block is not merely "sometimes absent for empty POUs", it is
    /// absent for a POU with plenty to put in it.
    /// <para>This is what made every TwinCAT POU unreadable: <c>Materializer</c> required that block. It now takes
    /// the declaration from the IDE's declaration aspect instead, which this document cannot demonstrate — and
    /// that is the point. The document is not a declaration source on this vendor.</para></summary>
    [Fact]
    public void A_live_export_of_a_45_variable_POU_carries_no_plaintext_declaration()
    {
        var xml = Fixture("FB_PackML_Unit.plcopen.xml");

        Assert.Equal(0, Regex.Matches(xml, "interfaceasplaintext", RegexOptions.IgnoreCase).Count);
        Assert.Null(PouReader.Parse(xml).Declaration);
    }

    /// <summary>…and the typed <c>&lt;interface&gt;</c> IS there, with all 45. That pairing is the whole argument
    /// for the aspect: the names and types survive, so "the declaration was lost" would be the wrong diagnosis —
    /// what is lost is the engineer's TEXT. Rendering a declaration from these 45 elements would reformat every
    /// declaration in the project on first push, a diff against work nobody did.</summary>
    [Fact]
    public void The_same_export_carries_all_45_variables_in_the_typed_interface()
    {
        var xml = Fixture("FB_PackML_Unit.plcopen.xml");

        Assert.Equal(45, Regex.Matches(xml, "<variable ").Count);
        Assert.Contains("<interface>", xml);
    }

    // ── the disabled network ────────────────────────────────────────────────────────────────────────

    /// <summary>A DISABLED network is not "carried without its flag" — it is OMITTED FROM THE EXPORT ENTIRELY.
    ///
    /// <para>`POU_PBD` is the only capture in this repo with a network disabled in the IDE ("comment mode"). The
    /// native object archive holds TWO networks, one <c>OutCommented=true</c>; the PLCopen export holds ONE, and
    /// carries no <c>OutCommented</c>, <c>Title</c> or <c>Label</c> anywhere.</para>
    ///
    /// <para><b>Why this matters beyond bookkeeping:</b> `BodySpliceGuard` refuses a body whose network numbering
    /// has a gap, on the stated reason that "a disabled or hidden network would be lost". That was recorded as an
    /// UNVERIFIED INFERENCE — no fixture had a gapped body with a known-disabled network. This is that fixture,
    /// and the inference is CORRECT: regenerating across the gap would delete a disabled network from a running
    /// program. Do not weaken that refusal.</para></summary>
    [Fact]
    public void A_disabled_network_is_absent_from_the_export_that_the_native_file_still_has()
    {
        var native = Fixture("POU_PBD.TcPOU");
        var export = Fixture("POU_PBD.plcopen.xml");

        // the native archive: two networks, one of them commented out
        Assert.Equal(2, Regex.Matches(native, "n=\"OutCommented\"").Count);
        Assert.Single(Regex.Matches(native, "n=\"OutCommented\">true"));

        // The export: none of the three per-network attributes survive, in any form. Matched CASE-SENSITIVELY
        // and on word boundaries — a case-insensitive substring scan for "Title" hits `Untitled2`, the project
        // name in <contentHeader>, and this assertion failed on exactly that before it was tightened.
        foreach (var attr in new[] { "OutCommented", "Title", "Label" })
        {
            // The pattern must have TEETH before its absence means anything. Asserting "0 matches" proves
            // nothing if the pattern itself is broken — and this one was, twice: first a case-insensitive
            // substring that hit `Untitled2`, then a mangled escape that searched for a literal BACKSPACE and
            // "passed". So each pattern must FIND the attribute in the native file it demonstrably is in.
            Assert.True(Regex.Matches(native, @"\b" + attr + @"\b").Count > 0,
                $"the {attr} pattern matches nothing even in the NATIVE file - it is broken, so its " +
                "absence from the export would prove nothing");
            Assert.Equal(0, Regex.Matches(export, @"\b" + attr + @"\b").Count);
        }

        // …and only ONE network's worth of elements came across. PLCopen has no <network> element — a network is
        // a localId BAND (the 10^10 striding of DIALECT A12), so counting distinct bands counts networks.
        var bands = Regex.Matches(export, "localId=\"(\\d+)\"")
            .Select(m => long.Parse(m.Groups[1].Value) / 10_000_000_000L)
            .Distinct()
            .ToList();
        _out.WriteLine($"localId bands in the export: {string.Join(", ", bands)}");
        Assert.Single(bands);
    }
}
