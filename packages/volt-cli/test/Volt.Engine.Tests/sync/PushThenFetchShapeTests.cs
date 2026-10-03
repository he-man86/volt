using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// WHAT A CLIENT PUSHES IS NOT WHAT IT READS BACK — THE CANONICAL FORM (openspec <c>st-roundtrip-fixed-point</c> 1.1).
///
/// <para>PLCAssist's census (CODESYS 3.5.21.40, 2026-10-03) created an FB as W1 — the body running straight into
/// <c>END_FUNCTION_BLOCK</c>, a PROPERTY, then an ACTION — and read it back (R14) with one blank line before the END line
/// and the ACTION before the PROPERTY. That is <c>StWriter</c>'s canonical form, kept on purpose: one blank line joins
/// the body to the END line (the reader drops exactly that one on the way in), and members are written METHOD, ACTION,
/// PROPERTY then by name, so a workspace diff never moves members around. Route (B), keeping the pushed shape, does not
/// fit that design; this test records the difference the push answer has to cover instead (route A).</para>
///
/// <para>push → fetch adds the line and reorders; fetch → push → fetch is stable. Both are pinned here.</para>
/// </summary>
public class PushThenFetchShapeTests
{
    /// <summary>The census's W1 shape: no blank line before <c>END_FUNCTION_BLOCK</c>, PROPERTY before ACTION.</summary>
    private const string W1 =
        "FUNCTION_BLOCK FB_Motor\n" +
        "VAR_INPUT\n\txEnable : BOOL;\nEND_VAR\n" +
        "VAR\n\txRunning : BOOL;\nEND_VAR\n" +
        "IMPLEMENTATION ST\n" +
        "xRunning := xEnable;\n" +
        "END_FUNCTION_BLOCK\n" +
        "\n" +
        "PROPERTY Running : BOOL\n" +
        "GET\n" +
        "IMPLEMENTATION ST\n" +
        "Running := xRunning;\n" +
        "END_GET\n" +
        "END_PROPERTY\n" +
        "\n" +
        "ACTION Stop\n" +
        "IMPLEMENTATION ST\n" +
        "xRunning := FALSE;\n" +
        "END_ACTION\n";

    /// <summary>What a fetch from the FAKE gives for W1: the blank line before the END line, the ACTION before the PROPERTY.
    ///
    /// <para>This is <c>StWriter</c>'s output over the fake's read, NOT the census recording. R14 attests two facts and
    /// no more: one blank line before <c>END_FUNCTION_BLOCK</c>, and the ACTION before the PROPERTY. Every other byte —
    /// no blank line before <c>END_ACTION</c> or <c>END_GET</c>, the one blank line between members — comes from the
    /// writer and the fake alone, so this constant is no proof of what live CODESYS fetches; task 4.1 compares against a
    /// live fetch, never against this text.</para></summary>
    private const string Canonical =
        "FUNCTION_BLOCK FB_Motor\n" +
        "VAR_INPUT\n\txEnable : BOOL;\nEND_VAR\n" +
        "VAR\n\txRunning : BOOL;\nEND_VAR\n" +
        "IMPLEMENTATION ST\n" +
        "xRunning := xEnable;\n" +
        "\n" +
        "END_FUNCTION_BLOCK\n" +
        "\n" +
        "ACTION Stop\n" +
        "IMPLEMENTATION ST\n" +
        "xRunning := FALSE;\n" +
        "END_ACTION\n" +
        "\n" +
        "PROPERTY Running : BOOL\n" +
        "GET\n" +
        "IMPLEMENTATION ST\n" +
        "Running := xRunning;\n" +
        "END_GET\n" +
        "END_PROPERTY\n";

    private static PushResponse Set(FakeIde ide, string text, string? ifVersion) =>
        PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = "FB_Motor.pou", SourceText = text, IfVersion = ifVersion } },
        });

    private static FetchedItem Fetch(FakeIde ide) =>
        FetchService.Handle(ide, new FetchRequest
        {
            KnownItems = new Dictionary<string, string>(),
            OnlyItems = new List<string> { "FB_Motor.pou" },
        }).Changed.Single();

    [Fact]
    public void A_created_W1_text_is_fetched_in_the_canonical_form()
    {
        var ide = new FakeIde();

        var push = Set(ide, W1, null);
        Assert.True(push.Accepted);
        var fetched = Fetch(ide);

        Assert.Equal(Canonical, fetched.SourceText);
        Assert.NotEqual(W1, fetched.SourceText);
        // The receipt's version is the fetched item's: what differs is the text alone, which the receipt does not carry.
        Assert.Equal(push.NewItems!["FB_Motor.pou"], fetched.Version);
    }

    /// <summary>The difference, line by line: exactly one blank line before the END line, and the two members swapped.</summary>
    [Fact]
    public void The_difference_is_one_blank_line_and_the_member_order()
    {
        var ide = new FakeIde();
        Set(ide, W1, null);
        var fetched = Fetch(ide).SourceText;

        Assert.Equal(W1.Split('\n').Length + 1, fetched.Split('\n').Length);
        Assert.Contains("xRunning := xEnable;\n\nEND_FUNCTION_BLOCK\n", fetched);
        Assert.DoesNotContain("xRunning := xEnable;\n\nEND_FUNCTION_BLOCK\n", W1);
        Assert.True(W1.IndexOf("PROPERTY Running") < W1.IndexOf("ACTION Stop"));
        Assert.True(fetched.IndexOf("ACTION Stop") < fetched.IndexOf("PROPERTY Running"));
    }

    /// <summary>The canonical form is a fixed point ON THE WRITE PATH: the fetched text pushed back is WRITTEN (the
    /// review's worry was that the push would drop it as unchanged and the next fetch re-read untouched state — measured:
    /// the write happens) and reads back byte for byte; so does an edit made in the canonical form.</summary>
    [Fact]
    public void Fetch_push_fetch_is_stable()
    {
        var ide = new FakeIde();
        Set(ide, W1, null);
        var first = Fetch(ide);

        int Writes() => ide.Recorded.Count(r => r == "writecontent:FB_Motor");
        var created = Writes();

        var restated = Set(ide, first.SourceText, first.Version);
        Assert.True(restated.Accepted);
        var restatedWrites = Writes();
        Assert.True(restatedWrites > created, "the restatement was not written, so its fetch proves nothing about the write");
        Assert.Equal(first.SourceText, Fetch(ide).SourceText);

        var edited = first.SourceText.Replace("xRunning := FALSE;", "xRunning := NOT xEnable;");
        Assert.NotEqual(first.SourceText, edited);
        var push = Set(ide, edited, Fetch(ide).Version);
        Assert.True(push.Accepted);
        Assert.True(Writes() > restatedWrites, "the canonical edit was not written");

        Assert.Equal(edited, Fetch(ide).SourceText);
    }
}
