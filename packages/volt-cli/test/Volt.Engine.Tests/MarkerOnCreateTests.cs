using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Xunit;
using Xunit.Abstractions;
using Volt.Engine.Source;
using Volt.Engine.Library;
using Volt.Engine.Source.Body;
using Volt.Engine.Item;

namespace Volt.Cli.Tests;

/// <summary>
/// The unsupported-body MARKER means "there is a diagram here I cannot write". On an UPDATE that reads as "leave
/// it exactly as it is", which is right. On a CREATE it cannot mean anything at all — there is no diagram yet to
/// leave alone, and a marker is not a body you can build one from.
///
/// <para><c>PouDocument</c> collapses the marker to <c>null</c> before choosing its arm:
/// <c>if (BodyMarker.Is(body)) body = null;</c>. `null` is then handed to <c>SetChildText</c> (update — correct,
/// means "don't touch it") or to <c>AddChild</c> (create — means "no body"). A member that does not already
/// exist therefore gets created EMPTY, silently.</para>
///
/// <para>The reachable route is a RENAME. A renamed member is a remove-plus-add by construction — the push
/// carries a member list, so a rename looks like one name gone and another appeared, and §3.2 already defines it
/// that way. So renaming a CFC method deletes the diagram and creates an empty method in its place, on a push
/// that reports success.</para>
/// </summary>
public class MarkerOnCreateTests
{
    private readonly ITestOutputHelper _out;
    public MarkerOnCreateTests(ITestOutputHelper o) => _out = o;

    private const string Ns = "http://www.plcopen.org/xml/tc6_0200";

    /// <summary>An FB carrying one CFC method called <c>Draw</c>.</summary>
    private static string FbWithCfcMethod() =>
        $"""
        <?xml version="1.0" encoding="utf-8"?>
        <project xmlns="{Ns}">
          <types><pous>
            <pou name="FB_D" pouType="functionBlock">
              <interface />
              <body><ST><xhtml>x := 1;</xhtml></ST></body>
              <addData>
                <data name="http://www.3s-software.com/plcopenxml/interfaceasplaintext" handleUnknown="implementation">
                  <InterfaceAsPlainText><xhtml>FUNCTION_BLOCK FB_D
        VAR
        END_VAR</xhtml></InterfaceAsPlainText>
                </data>
                <data name="http://www.3s-software.com/plcopenxml/method" handleUnknown="implementation">
                  <Method name="Draw">
                    <body>
                      <ST><xhtml /></ST>
                      <addData><data name="http://www.3s-software.com/plcopenxml/cfc"><CFC><box>real diagram</box></CFC></data></addData>
                    </body>
                    <InterfaceAsPlainText><xhtml>METHOD Draw</xhtml></InterfaceAsPlainText>
                  </Method>
                </data>
              </addData>
            </pou>
          </pous></types>
        </project>
        """;

    private static ItemContent WithMember(string memberName) =>
        new(ItemKind.Kinds.FunctionBlock, "FUNCTION_BLOCK FB_D\nVAR\nEND_VAR", "x := 1;",
            new List<Member> { new(ItemKind.Kinds.Method, memberName, $"METHOD {memberName}", BodyMarker.For("CFC")) });

    /// <summary>Restating the marker for the member that ALREADY exists leaves its diagram untouched. This is the
    /// arm that works, and it is here so the failing one below cannot be mistaken for the marker being broken in
    /// general.</summary>
    [Fact]
    public void Restating_the_marker_for_an_existing_member_keeps_its_diagram()
    {
        var doc = PouDocument.Splice(FbWithCfcMethod(), "FB_D", WithMember("Draw"), establishing: false);
        Assert.Contains("real diagram", doc);
    }

    /// <summary>Renaming it must NOT silently produce an empty member.
    /// <para>`Draw` is gone from the pushed list and `Sketch` has appeared, so the splice removes one and adds the
    /// other — with a marker body, which collapses to null, which on the ADD arm means "no body". The diagram is
    /// deleted and an empty method takes its name.</para>
    /// <para>Either outcome is acceptable to this test: keeping the diagram, or REFUSING. What is not acceptable
    /// is an accepted push that quietly loses it.</para></summary>
    [Fact]
    public void Renaming_a_member_whose_body_is_a_marker_does_not_silently_empty_it()
    {
        var before = FbWithCfcMethod();
        var ex = Record.Exception(() =>
        {
            var doc = PouDocument.Splice(before, "FB_D", WithMember("Sketch"), establishing: false);
            _out.WriteLine(doc);
            Assert.Contains("real diagram", doc);
        });

        Assert.True(ex is null || ex is System.InvalidOperationException,
            $"expected the diagram kept or the push refused; got {ex?.GetType().Name}: {ex?.Message}");
        if (ex is not null) Assert.Contains("CFC", ex.Message);
    }
}
