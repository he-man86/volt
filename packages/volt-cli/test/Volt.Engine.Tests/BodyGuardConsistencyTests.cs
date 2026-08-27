using Xunit;
using Xunit.Abstractions;
using Volt.Engine.Document;

namespace Volt.Cli.Tests;

/// <summary>
/// The body gate gives the SAME answer wherever the body sits.
///
/// <para>There were four body-write call sites and three different gates. The root ran five checks; an existing
/// child and a property accessor ran two each; a created child ran none. They were not variations — they
/// disagreed. A restated unsupported-body marker was the ordinary no-op at the ROOT and a hard refusal on a
/// CHILD, while the root's own comment called that same asymmetry, in the other direction, "nothing justified".
/// An unmodelled body language was refused at the root and written straight over on the other two.</para>
///
/// <para>These cases exist because collapsing the three onto one gate CHANGED behaviour at two of them, and a
/// behaviour change with no test is how the divergence got there in the first place. What they pin is not any
/// single answer but the agreement: same input, same verdict, three positions.</para>
/// </summary>
public class BodyGuardConsistencyTests
{
    private readonly ITestOutputHelper _out;
    public BodyGuardConsistencyTests(ITestOutputHelper o) => _out = o;

    private const string Ns = "http://www.plcopen.org/xml/tc6_0200";
    private const string Xh = "http://www.w3.org/1999/xhtml";

    /// <summary>An FB whose ROOT body, whose METHOD body and whose GET accessor body are all CFC — the language
    /// Volt does not support, which materializes as a marker.</summary>
    private const string CfcEverywhere = $"""
    <pou xmlns="{Ns}" name="P" pouType="functionBlock">
      <interface><addData><data name="i"><InterfaceAsPlainText><xhtml xmlns="{Xh}">FUNCTION_BLOCK P</xhtml></InterfaceAsPlainText></data></addData></interface>
      <body><addData><data name="http://www.3s-software.com/plcopenxml/cfc"><CFC/></data></addData><ST/></body>
      <addData><data name="m"><Method name="M">
        <interface><addData><data name="i"><InterfaceAsPlainText><xhtml xmlns="{Xh}">METHOD M</xhtml></InterfaceAsPlainText></data></addData></interface>
        <body><addData><data name="http://www.3s-software.com/plcopenxml/cfc"><CFC/></data></addData><ST/></body>
      </Method></data></addData>
      <addData><data name="p"><Property name="R">
        <interface><addData><data name="i"><InterfaceAsPlainText><xhtml xmlns="{Xh}">PROPERTY R : INT</xhtml></InterfaceAsPlainText></data></addData></interface>
        <GetAccessor name="Get">
          <InterfaceAsPlainText><xhtml xmlns="{Xh}">VAR</xhtml></InterfaceAsPlainText>
          <body><addData><data name="http://www.3s-software.com/plcopenxml/cfc"><CFC/></data></addData><ST/></body>
        </GetAccessor>
      </Property></data></addData>
    </pou>
    """;

    /// <summary>The marker an unsupported body materializes as — what a pull writes into the repo, and therefore
    /// exactly what the next push of that untouched file carries back.</summary>
    private static string Marker => Volt.Engine.Vocabulary.BodyMarker.For("CFC");

    /// <summary>Restating the marker is the ordinary round-trip of an untouched CFC body. It must be a no-op at
    /// every position — not a no-op at the root and a rejected push on a child.
    /// <para>The cost of the old disagreement was concrete: a push that restates every member could not touch a
    /// POU containing a CFC method AT ALL, because the child arm refused the marker its own pull had written.</para></summary>
    [Fact]
    public void Restating_an_unsupported_body_marker_is_a_no_op_at_every_position()
    {
        var root = PouSplice.SetBody(CfcEverywhere, "P", Marker, null, establishing: false);
        Assert.Equal(CfcEverywhere, root);                                  // untouched, byte for byte

        var child = PouSplice.SetChildText(CfcEverywhere, "P", "M", null, Marker, null);
        Assert.Equal(CfcEverywhere, child);

        var accessor = PouSplice.SetAccessor(CfcEverywhere, "P", "R", getter: true, Marker, null);
        Assert.Equal(CfcEverywhere, accessor);

        _out.WriteLine("root / child / accessor all no-op on a restated marker");
    }

    /// <summary>And the other arm, which two of the three positions did not have at all: pushing REAL SOURCE over
    /// an unsupported body is refused everywhere. Volt cannot produce a CFC body, so writing ST over one destroys
    /// a diagram it can never rebuild.</summary>
    [Fact]
    public void Pushing_source_over_an_unsupported_body_is_refused_at_every_position()
    {
        const string st = "x := 1;";

        var atRoot = Record.Exception(() => PouSplice.SetBody(CfcEverywhere, "P", st, null, establishing: false));
        var atChild = Record.Exception(() => PouSplice.SetChildText(CfcEverywhere, "P", "M", null, st, null));
        var atAcc = Record.Exception(() => PouSplice.SetAccessor(CfcEverywhere, "P", "R", getter: true, st, null));

        foreach (var (where, ex) in new[] { ("root", atRoot), ("child", atChild), ("accessor", atAcc) })
        {
            Assert.True(ex is not null, $"{where}: pushing ST over a CFC body was ACCEPTED");
            Assert.Contains("CFC", ex!.Message);
            _out.WriteLine($"{where}: {ex.Message}");
        }
    }
}
