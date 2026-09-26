using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// AN EXECUTE BOX, READ FROM REAL VENDOR BYTES.
///
/// <para><c>fixtures/tc-pou/execute-box.TcPOU</c> was DRAWN BY HAND in XAE, because Volt cannot create one on
/// this vendor: emitted as a `&lt;block typeName="EXECUTE"&gt;` the PLCopen importer accepts the push and returns
/// `EXECUTE();` — a plain box whose type name is the string EXECUTE, with the ST gone (DIALECT C20). So this
/// fixture is the only way the shape could be captured, and it joins `VltFixtureCfc`/`VltFixtureSfc` as a
/// hand-authored fixture the suite maintains rather than provisions.</para>
///
/// <para><b>What it is worth.</b> Before it, <c>ReadStCode</c> refused outright — so an engineer who drew an
/// Execute box in their own project could not pull their POU at all. That is a field gap, not a test gap, and it
/// was invisible because no TwinCAT project in this repo contained one.</para>
///
/// <para>Two vendor facts are pinned here, and both were guessable wrongly: the line list is an <c>&lt;a&gt;</c>
/// ARRAY (not the <c>&lt;l2&gt;</c> list every other member uses — read with the wrong accessor it answers EMPTY,
/// which would look like a box with no code), and each line's <c>Text</c> is stored WITH its own surrounding
/// double quotes.</para>
/// </summary>
public class TcExecuteBoxTests
{
    private static string Body() =>
        XDocument.Parse(Fixtures.Pou("execute-box.TcPOU"), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);

    private static NetworkBody Read() =>
        TcNetworkReader.Read(
            XElement.Parse(Body(), LoadOptions.PreserveWhitespace)
                .DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject"),
            BodyLanguage.Fbd);

    [Fact]
    public void The_ST_inside_an_Execute_box_is_read_rather_than_refused()
    {
        var box = Read().Networks
            .SelectMany(n => n.Trees)
            .SelectMany(Flatten)
            .OfType<Box>()
            .Single(b => b.StCode != null);

        // The engineer's line, verbatim — quotes stripped, and NOT the `"iCount:=icount+1;"` the archive stores.
        Assert.Contains("iCount:=icount+1;", box.StCode);
        Assert.DoesNotContain("\"", box.StCode);
    }

    /// <summary>The box carries its ST, so the body materializes with the code rather than as a bare
    /// `EXECUTE();` — which is exactly what the repo shipped before the reader returned null unconditionally.</summary>
    [Fact]
    public void The_body_materializes_with_the_code_not_as_an_empty_call()
    {
        var text = TcText.Write(Read());

        Assert.Contains("EXECUTE", text);
        Assert.Contains("iCount:=icount+1;", text);
        Assert.DoesNotContain("EXECUTE();", text); // the empty-call rendering the old reader produced
    }

    private static System.Collections.Generic.IEnumerable<Node> Flatten(Node n)
    {
        yield return n;
        switch (n)
        {
            case Box b:
                foreach (var i in b.Inputs)
                    foreach (var c in Flatten(i.Value)) yield return c;
                if (b.Enable is { } en) foreach (var c in Flatten(en)) yield return c;
                break;
            case Assign a:
                foreach (var c in Flatten(a.Value)) yield return c;
                break;
            case Volt.Engine.Format.Network.Parallel p:
                if (p.Input is { } pi) foreach (var c in Flatten(pi)) yield return c;
                foreach (var br in p.Branches)
                    foreach (var c in Flatten(br)) yield return c;
                break;
            case Demux d when d.Input is { } di:
                foreach (var c in Flatten(di)) yield return c;
                break;
        }
    }

    /// <summary>AND THAT ST IS EDITABLE — one line at a time, which is as far as the archive allows.
    ///
    /// <para>Making the box readable created the edit, and for a while it was REFUSED: nothing in
    /// <c>TcNetworkWriter</c> looked at <c>StCode</c>, so changing it found no storage change, wrote nothing,
    /// reported SUCCESS and was reverted by the next pull — the `JMP` retarget bug's exact shape. A refusal was
    /// the honest stopgap; writing the line is the fix.</para>
    ///
    /// <para><b>Measured on a live XAE 2026-09-06</b>, on the same hand-drawn POU this fixture came from: the
    /// edit is accepted, comes back changed, the project BUILDS with zero errors, and pushing the original text
    /// afterwards restores it byte-identically. A `TextLine` is an existing element whose `Id` the IDE minted,
    /// so rewriting its `Text` is an ordinary value edit — the same thing this writer does to every operand.</para>
    ///
    /// <para>The boundary is the LINE COUNT, and it is a real one: a new line needs a new `TextLine` with an
    /// invented `Id`, which is the archive construction this writer does not do (N11).</para></summary>
    [Fact]
    public void An_edit_to_that_ST_is_written_line_for_line()
    {
        // Edited the way production edits: through the TEXT, which is what the engineer's file holds.
        var text = TcText.Write(Read()).Replace("iCount:=icount+1;", "iCount:=icount+2;");
        var written = TcText.Apply(Body(), TcText.Validate(text, TcText.ScopeOf(Read())));

        Assert.NotNull(written);
        Assert.Contains("iCount:=icount+2;", written);
        Assert.DoesNotContain("iCount:=icount+1;", written);
    }

    /// <summary>GROWING THE ST PAST ITS SLOTS IS REFUSED — an `Id` is the IDE's to mint.
    ///
    /// <para>The boundary is not "any added line", and measuring it moved it. The archive keeps a trailing
    /// BLANK line that network text trims, so ONE added statement lands in that existing slot and is an ordinary
    /// value write — no element is created and the IDE's `Id` is reused. A SECOND has nowhere to go, and making
    /// somewhere is the construction this writer does not do (N11).</para></summary>
    [Fact]
    public void Growing_the_ST_past_its_line_slots_is_refused()
    {
        var text = TcText.Write(Read())
            .Replace("iCount:=icount+1;", "iCount:=icount+1;\n  iCount:=icount+9;\n  iCount:=icount+8;");

        var ex = Assert.ThrowsAny<System.Exception>(
            () => TcText.Apply(Body(), TcText.Validate(text, TcText.ScopeOf(Read()))));
        Assert.Contains("line(s)", ex.Message);
    }
}
