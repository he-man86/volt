using System;
using System.IO;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.St;
using Xunit;
using Xunit.Abstractions;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE SHARED FORMAT LAYER, DRIVEN BY TWINCAT-AUTHORED TEXT — so a regression in it cannot stay green on this
/// vendor's side.
///
/// <para><b>The gap this closes.</b> `StReader`/`StWriter` and the network-text codec are SHARED: both drivers
/// hand them the same model and both get the same text back, which is the whole parity contract. But every
/// fixture the format is tested against — all nine `st-fixed-point` files and all five corpora — came from a
/// CODESYS pull. Nothing in this suite reached the format layer at all, so a change that happened to suit
/// CODESYS-shaped text could pass everything while breaking TwinCAT, and the first sign of it would be an
/// engineer's file.</para>
///
/// <para><b>The text here is a real TwinCAT pull</b>, taken from `test-corpus/twincat-project14` — the corpus
/// committed when the migration finder was first pointed at this vendor. It is committed as a FIXTURE rather
/// than swept from the corpus because the corpus sweep (`StFixedPointTests.Every_file_in_a_real_corpus…`) is
/// opt-in behind `VOLT_CORPUS` and therefore never runs in CI. A gate that only fires when someone remembers to
/// set an environment variable is not the gate this task asked for.</para>
///
/// <para><b>Member splitting needed its own text, and the corpus had none.</b> Not one of twincat-project14's
/// ten source files declares a METHOD, ACTION or PROPERTY — so the part of the ST format with the most boundary
/// rules and the most history of bugs had no TwinCAT-sourced evidence at all. `FB_VltMembers.fb` closes that:
/// a POU with a method and a property, PUSHED into a live TwinCAT project and then pulled back from it in a
/// fresh workspace, so the bytes are the IDE's rather than the ones that were sent.</para>
///
/// <para><b>And pushing it found a shape nothing had:</b> TwinCAT gives a property's SET accessor a BLANK LINE
/// between its `END_VAR` and its body, and its GET none — from identical pushed text. Measured stable (a second
/// forced write and pull leaves exactly one), so it is a create-time normalisation rather than drift, and it is
/// cosmetic rather than lossy. It is in the fixture because a hand-written sample would never have had it.</para>
/// </summary>
public class TcSharedFormatTests
{
    private readonly ITestOutputHelper _out;

    public TcSharedFormatTests(ITestOutputHelper output) => _out = output;

    /// <summary>Workspace files are LF; a Windows checkout may smudge them to CRLF, and the format is defined in
    /// LF. Same normalisation `StFixedPointTests` uses, for the same reason.</summary>
    private static string Read(string name) =>
        File.ReadAllText(Fixtures.Path("tc-workspace", name)).Replace("\r\n", "\n");

    /// <summary>THE FIXED POINT, on TwinCAT-authored text: <c>Write(Read(x)) == x</c>, exactly.
    ///
    /// <para><c>FB_PackML_Unit.fb</c> is 266 lines of real IDE output — three VAR sections, ragged alignment
    /// inside them, a blank line before an <c>END_VAR</c>, and a large CASE body. Its value is that nobody
    /// composed it to be a test.</para></summary>
    [Theory]
    [InlineData("FB_PackML_Unit.fb")]
    [InlineData("ladderLabel.prg")]
    [InlineData("FB_VltMembers.fb")]
    public void Twincat_authored_text_survives_the_st_round_trip(string name)
    {
        var text = Read(name);
        var back = StWriter.Write(StReader.Read(text));

        if (back == text) return;

        // Name the first differing line. "the strings differ" over 266 lines is not a diagnosis.
        var a = text.Split('\n');
        var b = back.Split('\n');
        for (var i = 0; i < Math.Max(a.Length, b.Length); i++)
            if (i >= a.Length || i >= b.Length || a[i] != b[i])
                Assert.Fail($"{name}: line {i + 1} " +
                            $"want {(i < a.Length ? "\"" + a[i] + "\"" : "<eof>")} " +
                            $"got {(i < b.Length ? "\"" + b[i] + "\"" : "<eof>")}");
        Assert.Fail($"{name}: identical line by line — the trailing newline differs");
    }

    /// <summary>A TWINCAT-DRAWN LADDER IS IN CANONICAL NETWORK-TEXT FORM.
    ///
    /// <para>The gate refuses a body that would not re-emit identically, because such a body drifts on the next
    /// pull. Running it over text this vendor's own driver produced asserts the two halves agree ON TWINCAT OUTPUT —
    /// the ST round trip above cannot, because it treats a graphical body as opaque text and would pass over any
    /// amount of network-level drift.</para>
    ///
    /// <para><c>ladderLabel.prg</c> earns its place by holding two shapes that are easy to get wrong and that no
    /// hand-written fixture had: a network whose LABEL is its only content (<c>NETWORK LABEL: testLabe2</c> with
    /// nothing between it and <c>END_NETWORK</c>), and a coil with nothing driving it — <c>coil := ;</c>, which
    /// reads back as the TERMINATOR the archive actually holds rather than as a null. The fixture is in network
    /// text v2 (the language on the implementation marker, no order numbers); the shapes are the ones TwinCAT drew.</para>
    ///
    /// <para>Read the way a push reads it: the body against the scope its own declaration builds (task 3.9).</para></summary>
    [Fact]
    public void A_twincat_drawn_ladder_is_canonical_network_text()
    {
        var pou = StReader.Read(Read("ladderLabel.prg"));
        var body = pou.Body!;

        Assert.StartsWith("IMPLEMENTATION LD\n", body);
        Assert.Contains("NETWORK LABEL: testLabel\n  coil := ;", body);
        Assert.Contains("NETWORK LABEL: testLabe2\nEND_NETWORK", body);

        // Throws NetworkTextException naming the canonical form if it would not round-trip.
        var model = NetworkText.Validate(body,
            NetworkScope.FromDeclarations(pou.Declaration, _ => null, () => Array.Empty<string>()));

        Assert.Equal(2, model.Networks.Count);
        Assert.Empty(model.Networks[1].Trees);          // the label-only network really is empty
        _out.WriteLine($"validated {model.Networks.Count} TwinCAT-authored network(s), language {model.Language}");
    }
}
