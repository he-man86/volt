using System;
using System.IO;
using System.Linq;
using Xunit;
using Volt.Engine.Source;

namespace Volt.Cli.Tests;

public class PouReaderTests
{
    private const string Ns = "http://www.plcopen.org/xml/tc6_0200";

    /// <summary>An FBD root body whose children are ACTIONS — in the shape both vendors actually emit:
    /// <c>&lt;actions&gt;/&lt;action&gt;</c>, which they place BEFORE the POU's own <c>&lt;body&gt;</c>
    /// (recorded in <c>codesys-pou/FB_FolderChild.plcopen.xml</c> and <c>tc-fbd/PLC_PRG.plcopen.xml</c>).
    /// <para>This used to carry nested <c>&lt;pou pouType="action"&gt;</c> children, a shape TC6 forbids
    /// (<c>pouType</c> is function|functionBlock|program) and no recorded export contains. It was the only thing
    /// keeping a dead reader branch alive — a test asserting an invented shape reads as coverage.</para>
    /// <para>Ordering is the point of using two: the root's own FBD body must not be mistaken for an action's,
    /// and the actions must come back in document order.</para></summary>
    [Fact]
    public void Parses_FBD_POU_with_action_children()
    {
        const string xml = $$"""
        <pou name="FbPou" pouType="functionBlock" xmlns="{{Ns}}">
          <interface/>
          <actions>
            <action name="Tick">
              <InterfaceAsPlainText><xhtml>ACTION Tick</xhtml></InterfaceAsPlainText>
              <body><ST>y := y + 1;</ST></body>
            </action>
            <action name="Reset">
              <InterfaceAsPlainText><xhtml>ACTION Reset</xhtml></InterfaceAsPlainText>
              <body><ST>y := 0;</ST></body>
            </action>
          </actions>
          <body>
            <FBD>
              <inVariable localId="1"><expression>y</expression></inVariable>
            </FBD>
          </body>
          <addData>
            <data><InterfaceAsPlainText><xhtml>FUNCTION_BLOCK FbPou</xhtml></InterfaceAsPlainText></data>
          </addData>
        </pou>
        """;

        var result = PouReader.Parse(xml);

        Assert.Contains("FUNCTION_BLOCK FbPou", result.Declaration);
        Assert.Equal("FBD", result.BodyLanguage);          // the ROOT's body, not the first action's
        Assert.NotNull(result.BodyElement);
        Assert.Equal(2, result.Children.Count);

        Assert.Equal("Tick", result.Children[0].Name);
        Assert.Equal("action", result.Children[0].PouType);
        Assert.Equal("ST", result.Children[0].BodyLanguage);
        Assert.Contains("ACTION Tick", result.Children[0].Declaration);

        Assert.Equal("Reset", result.Children[1].Name);
        Assert.Equal("action", result.Children[1].PouType);
    }

    [Fact]
    public void Parses_POU_with_no_children()
    {
        const string xml = $$"""
        <pou name="SimplePgm" pouType="program" xmlns="{{Ns}}">
          <addData>
            <data><InterfaceAsPlainText><xhtml>PROGRAM SimplePgm\nVAR\n  x : INT;\nEND_VAR</xhtml></InterfaceAsPlainText></data>
          </addData>
          <body><ST>x := 1;</ST></body>
        </pou>
        """;

        var result = PouReader.Parse(xml);

        Assert.Contains("PROGRAM SimplePgm", result.Declaration);
        Assert.Equal("ST", result.BodyLanguage);
        Assert.NotNull(result.BodyElement);
        Assert.Empty(result.Children);
    }

    [Fact]
    public void Parses_CFC_body()
    {
        const string xml = $$"""
        <pou name="CfcPgm" pouType="program" xmlns="{{Ns}}">
          <addData>
            <data><InterfaceAsPlainText><xhtml>PROGRAM CfcPgm\nVAR\n  x : INT;\nEND_VAR</xhtml></InterfaceAsPlainText></data>
          </addData>
          <body>
            <CFC>
              <block localId="1" typeName="ADD" />
            </CFC>
          </body>
        </pou>
        """;

        var result = PouReader.Parse(xml);

        Assert.Equal("CFC", result.BodyLanguage);
        Assert.NotNull(result.BodyElement);
        Assert.Empty(result.Children);
    }

    /// <summary>REGRESSION — the synthetic `&lt;body&gt;&lt;CFC/&gt;&lt;/body&gt;` above is a shape NO recorded
    /// export produces. CODESYS nests a real CFC body under
    /// <c>&lt;body&gt;&lt;ST/&gt;&lt;addData&gt;&lt;data name="…/cfc"&gt;&lt;CFC&gt;</c> — an EMPTY sibling
    /// <c>&lt;ST&gt;</c> and the diagram in an addData. Scanning only DIRECT children of <c>&lt;body&gt;</c>
    /// therefore finds the <c>&lt;ST&gt;</c> first and reports a graphical body as TEXTUAL, which is how a
    /// read-only CFC body slips past the guard that exists to protect it.
    /// <para>Run against the RECORDED fixture, not synthetic XML — that is the whole point of the bug.</para></summary>
    [Fact]
    public void A_CODESYS_CFC_body_nested_in_addData_reads_as_CFC_not_ST()
    {
        var xml = File.ReadAllText(Path.Combine(
            System.AppContext.BaseDirectory, "fixtures", "codesys-pou", "FB_GraphicalChild.plcopen.xml"));

        var method = PouReader.Parse(xml).Children.Single(c => c.Name == "doSomething");

        Assert.Equal("CFC", method.BodyLanguage);
    }

    [Fact]
    public void Throws_on_malformed_XML()
    {
        const string badXml = "<not><valid>";

        Assert.Throws<System.Xml.XmlException>(() => PouReader.Parse(badXml));
    }

    [Fact]
    public void Throws_when_no_pou_element_found()
    {
        const string xml = $$"""
        <project xmlns="{{Ns}}">
          <types><pous/></types>
        </project>
        """;

        Assert.Throws<InvalidOperationException>(() => PouReader.Parse(xml));
    }

    [Fact]
    public void Parses_CODESYS_addData_method_children()
    {
        const string xml = $$"""
        <pou name="MainPgm" pouType="program" xmlns="{{Ns}}">
          <addData>
            <data><InterfaceAsPlainText><xhtml>PROGRAM MainPgm</xhtml></InterfaceAsPlainText></data>
            <data>
              <Method name="Helper">
                <InterfaceAsPlainText><xhtml>METHOD Helper : BOOL</xhtml></InterfaceAsPlainText>
                <body><ST>Helper := TRUE;</ST></body>
              </Method>
            </data>
            <data>
              <action name="Init">
                <InterfaceAsPlainText><xhtml>ACTION Init</xhtml></InterfaceAsPlainText>
                <body><ST>x := 0;</ST></body>
              </action>
            </data>
          </addData>
          <body><ST>x := 1;</ST></body>
        </pou>
        """;

        var result = PouReader.Parse(xml);

        Assert.Equal(2, result.Children.Count);

        var method = result.Children.First(c => c.PouType == "method");
        Assert.Equal("Helper", method.Name);
        Assert.Equal("ST", method.BodyLanguage);
        Assert.Contains("METHOD Helper", method.Declaration);

        var action = result.Children.First(c => c.PouType == "action");
        Assert.Equal("Init", action.Name);
        Assert.Equal("ST", action.BodyLanguage);
        Assert.Contains("ACTION Init", action.Declaration);
    }

    // ── TwinCAT export shapes (regression: these once threw in Materialize, so the POU was silently dropped
    //    from /refs and /fetch — see fix "TwinCAT drops FB-with-method + interfaces on read") ──

    [Fact]
    public void TwinCAT_FB_with_folded_method_does_not_steal_the_methods_declaration_as_the_POUs()
    {
        // A TwinCAT FB carries a STRUCTURED <interface><localVars> (no own InterfaceAsPlainText); the METHOD under
        // <addData>/<Method> DOES carry one. DeclFromElement used to descend into <addData> and return the
        // METHOD's decl → the FB materialized as kind "method" → ExtFor("method") threw. The POU decl must NOT be
        // the method's (it's null here → the caller falls back to the COM declaration); the method is a child.
        const string xml = $$"""
        <pou name="FbM" pouType="functionBlock" xmlns="{{Ns}}">
          <interface><localVars><variable name="x"><type><INT/></type></variable></localVars></interface>
          <body><ST><xhtml>x:=x+1;</xhtml></ST></body>
          <addData>
            <data name="http://www.3s-software.com/plcopenxml/method">
              <Method name="Compute">
                <interface><returnType><INT/></returnType></interface>
                <InterfaceAsPlainText><xhtml>METHOD Compute : INT</xhtml></InterfaceAsPlainText>
                <body><ST><xhtml>Compute := 1;</xhtml></ST></body>
              </Method>
            </data>
          </addData>
        </pou>
        """;

        var result = PouReader.Parse(xml);

        Assert.True(result.Declaration is null || !result.Declaration.Contains("METHOD"),
            $"FB decl must not be the method's; was: {result.Declaration}");
        Assert.Single(result.Children);
        Assert.Equal("Compute", result.Children[0].Name);
        Assert.Equal("method", result.Children[0].PouType);
        Assert.Contains("METHOD Compute", result.Children[0].Declaration);
    }

    [Fact]
    public void TwinCAT_interface_exported_under_addData_with_no_pou_element_parses()
    {
        // TwinCAT exports an INTERFACE under <addData>/<Interface> with an EMPTY <pous/> — no <pou> element at
        // all. Parse used to throw "PLCopen document has no <pou> element". It must treat <Interface> as the
        // root: its own InterfaceAsPlainText is the declaration and its <Methods>/<Method> are the children.
        const string xml = $$"""
        <project xmlns="{{Ns}}">
          <types><dataTypes/><pous/></types>
          <addData>
            <data name="http://www.3s-software.com/plcopenxml/interface">
              <Interface name="IFoo">
                <Methods>
                  <Method name="Go">
                    <interface><returnType><INT/></returnType></interface>
                    <InterfaceAsPlainText><xhtml>METHOD Go : INT</xhtml></InterfaceAsPlainText>
                  </Method>
                </Methods>
                <InterfaceAsPlainText><xhtml>INTERFACE IFoo</xhtml></InterfaceAsPlainText>
              </Interface>
            </data>
          </addData>
        </project>
        """;

        var result = PouReader.Parse(xml);

        Assert.NotNull(result.Declaration);
        Assert.Contains("INTERFACE IFoo", result.Declaration);
        Assert.DoesNotContain("METHOD", result.Declaration);   // the interface's own decl, not the method's
        Assert.Single(result.Children);
        Assert.Equal("Go", result.Children[0].Name);
        Assert.Equal("method", result.Children[0].PouType);
        Assert.Contains("METHOD Go", result.Children[0].Declaration);
    }

    [Fact]
    public void BodyLanguage_is_null_when_body_has_no_recognized_child()
    {
        const string xml = $$"""
        <pou name="EmptyBodyPgm" pouType="program" xmlns="{{Ns}}">
          <addData>
            <data><InterfaceAsPlainText><xhtml>PROGRAM EmptyBodyPgm</xhtml></InterfaceAsPlainText></data>
          </addData>
          <body/>
        </pou>
        """;

        var result = PouReader.Parse(xml);

        Assert.Null(result.BodyLanguage);
        Assert.Null(result.BodyElement);
    }
}
