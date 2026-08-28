using System;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.PlcOpen;
using Volt.Engine.Format.Network;
using Xunit;
using Xunit.Abstractions;

namespace Volt.Cli.Tests;

/// <summary>
/// The capability gate is narrower in SCOPE, not softer in what it refuses.
///
/// <para>It refuses a write that would destroy something network text cannot express — an in-out pin, a pin wired
/// from several sources, a `connector`, a gap in the network numbering. That was exactly right when a push
/// regenerated the whole body: anything anywhere in it was about to be thrown away.</para>
///
/// <para>Once untouched networks are carried verbatim, the same refusal on THEIR account refuses a push that
/// would have lost nothing. The gate exists to stop a loss; where there is no loss there is nothing to stop.</para>
///
/// <para><b>The trap this file exists for</b> is that "narrower" quietly becomes "softer". Both cases run the SAME
/// construct on the SAME recorded body: leave the gapped networks alone and the push goes through; rewrite every
/// network and the refusal fires, by name.</para>
/// </summary>
public class ScopedRefusalTests
{
    private readonly ITestOutputHelper _out;
    public ScopedRefusalTests(ITestOutputHelper o) => _out = o;

    private const long Stride = 10_000_000_000L;

    /// <summary>The recorded Beckhoff export whose FBD body has a GAP in its network numbering — indices
    /// {1,2,4,5,6}. A gap is what the gate reads as "a disabled or hidden network would be lost", and this body
    /// is a real one Volt could not write to AT ALL before the gate was scoped.
    ///
    /// <para>Recorded, not constructed. A first attempt at this file built two synthetic FBD networks holding a
    /// `connector` and a multi-source pin; both rendered as EMPTY networks, because hand-written PLCopen is not
    /// the shape the reader accepts. That is a lesson this repo has paid for more than once — a synthetic fixture
    /// tests the test author's idea of the format, not the vendor's.</para></summary>
    private static (XElement Body, XElement Fbd, string Pulled)? GappedExport()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "fixtures", "tc-fbd", "PLC_PRG_jump_sr.plcopen.xml");
        if (!File.Exists(path)) return null;
        var fbd = XDocument.Load(path).Descendants().FirstOrDefault(e => e.Name.LocalName == "FBD");
        if (fbd?.Parent is null) return null;
        return (fbd.Parent, fbd, NetworkCode.RenderBody(fbd));
    }

    /// <summary>Each `NETWORK n …` block, sliced so concatenation reproduces the original.</summary>
    private static string[] Networks(string text)
    {
        var heads = Regex.Matches(text, @"^NETWORK[ \t]+\d+\b", RegexOptions.Multiline).Cast<Match>().ToList();
        return heads.Select((h, i) =>
            text.Substring(h.Index, (i + 1 < heads.Count ? heads[i + 1].Index : text.Length) - h.Index)).ToArray();
    }

    /// <summary>UNTOUCHED: edit one network and the gapped ones are carried, so nothing is lost and nothing is
    /// refused.
    /// <para>Before this, one numbering gap made every push to this recorded vendor body impossible — permanently,
    /// and for a reason that had nothing to do with what the engineer was editing.</para></summary>
    [Fact]
    public void A_gapped_body_is_pushable_when_the_gapped_networks_are_untouched()
    {
        if (GappedExport() is not { } g) { _out.WriteLine("fixture missing"); return; }

        var indices = g.Fbd.Elements()
            .Select(e => (long?)e.Attribute("localId")).Where(id => id.HasValue)
            .Select(id => id!.Value / Stride).Distinct().OrderBy(i => i).ToList();
        _out.WriteLine($"network indices: [{string.Join(", ", indices)}]");

        var nets = Networks(g.Pulled);
        if (nets.Length < 2) { _out.WriteLine("not a multi-network body — nothing to carry"); return; }

        // Edit the first network that HAS an assignment — not simply the last one. The last network of this
        // export has none, so keying on it made the whole case bail before `Encode` was ever called: a test that
        // passed identically with and without the change under test. Found by trying to prove it red.
        var target = Array.FindIndex(nets, n => n.Contains(":="));
        Assert.True(target >= 0, "no network in the recorded body carries an assignment to edit");
        var pushed = string.Concat(nets.Select((n, i) => i == target ? n.Replace(":=", "_edited :=") : n));
        Assert.NotEqual(g.Pulled, pushed);
        _out.WriteLine($"editing network at position {target} of {nets.Length}; the gap is in the rest");

        var ex = Record.Exception(() => BodyCodec.For("FBD").Encode(g.Body, pushed, declaration: null));
        Assert.True(ex is null,
            "a recorded Beckhoff body is still un-pushable because of a numbering gap in networks nobody " +
            $"touched: {ex?.Message}");
    }

    /// <summary>EDITED: rewrite EVERY network and the gap is genuinely spanned again, so the refusal fires with
    /// the same message. This is the half that stops "narrower" becoming "softer".</summary>
    [Fact]
    public void Rewriting_every_network_of_a_gapped_body_is_still_refused_by_name()
    {
        if (GappedExport() is not { } g) { _out.WriteLine("fixture missing"); return; }

        var pushed = g.Pulled.Replace(":=", "_edited :=");
        if (pushed == g.Pulled) { _out.WriteLine("no assignment to edit"); return; }

        var ex = Assert.Throws<InvalidOperationException>(
            () => BodyCodec.For("FBD").Encode(g.Body, pushed, declaration: null));
        Assert.Contains("gap", ex.Message);
        _out.WriteLine(ex.Message);
    }
}
