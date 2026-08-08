using System;
using System.IO;
using System.Linq;
using Volt.Engine.Graphical;
using Xunit;

namespace Volt.Cli.Tests;

public class PlcOpenPouParserTests
{
    private const string Ns = "http://www.plcopen.org/xml/tc6_0200";

    [Fact]
    public void Parses_textual_ST_POU_with_methods()
    {
        const string xml = $$"""
        <pou name="MyPgm" pouType="program" xmlns="{{Ns}}">
          <addData>
            <data><InterfaceAsPlainText><xhtml>PROGRAM MyPgm\nVAR\n  x : INT;\nEND_VAR</xhtml></InterfaceAsPlainText></data>
          </addData>
          <body><ST>x := 1;</ST></body>
          <pou name="DoWork" pouType="method">
            <addData>
              <data><InterfaceAsPlainText><xhtml>METHOD DoWork : INT\nVAR_INPUT\n  a : INT;\nEND_VAR</xhtml></InterfaceAsPlainText></data>
            </addData>
            <body><ST>DoWork := a * 2;</ST></body>
          </pou>
        </pou>
        """;

        var result = PlcOpenPouParser.Parse(xml);

        Assert.NotNull(result.Declaration);
        Assert.Contains("PROGRAM MyPgm", result.Declaration);
        Assert.Equal("ST", result.BodyLanguage);
        Assert.NotNull(result.BodyElement);
        Assert.Single(result.Children);

        var child = result.Children[0];
        Assert.Equal("DoWork", child.Name);
        Assert.Equal("method", child.PouType);
        Assert.NotNull(child.Declaration);
        Assert.Contains("METHOD DoWork", child.Declaration);
        Assert.Equal("ST", child.BodyLanguage);
    }

    [Fact]
    public void Parses_FBD_POU_with_action_children()
    {
        const string xml = $$"""
        <pou name="FbPou" pouType="functionBlock" xmlns="{{Ns}}">
          <addData>
            <data><InterfaceAsPlainText><xhtml>FUNCTION_BLOCK FbPou\nVAR\n  y : INT;\nEND_VAR</xhtml></InterfaceAsPlainText></data>
          </addData>
          <body>
            <FBD>
              <inVariable localId="1"><expression>y</expression></inVariable>
            </FBD>
          </body>
          <pou name="Tick" pouType="action">
            <addData>
              <data><InterfaceAsPlainText><xhtml>ACTION Tick</xhtml></InterfaceAsPlainText></data>
            </addData>
            <body><ST>y := y + 1;</ST></body>
          </pou>
          <pou name="Reset" pouType="action">
            <addData>
              <data><InterfaceAsPlainText><xhtml>ACTION Reset</xhtml></InterfaceAsPlainText></data>
            </addData>
            <body><ST>y := 0;</ST></body>
          </pou>
        </pou>
        """;

        var result = PlcOpenPouParser.Parse(xml);

        Assert.Contains("FUNCTION_BLOCK FbPou", result.Declaration);
        Assert.Equal("FBD", result.BodyLanguage);
        Assert.NotNull(result.BodyElement);
        Assert.Equal(2, result.Children.Count);

        Assert.Equal("Tick", result.Children[0].Name);
        Assert.Equal("action", result.Children[0].PouType);
        Assert.Equal("ST", result.Children[0].BodyLanguage);

        Assert.Equal("Reset", result.Children[1].Name);
        Assert.Equal("action", result.Children[1].PouType);
    }

    [Fact]
    public void Parses_interface_with_methods()
    {
        const string xml = $$"""
        <pou name="IMyInterface" pouType="interface" xmlns="{{Ns}}">
          <addData>
            <data><InterfaceAsPlainText><xhtml>INTERFACE IMyInterface</xhtml></InterfaceAsPlainText></data>
          </addData>
          <body/>
          <pou name="Compute" pouType="method">
            <addData>
              <data><InterfaceAsPlainText><xhtml>METHOD Compute : INT\nVAR_INPUT\n  x : INT;\nEND_VAR</xhtml></InterfaceAsPlainText></data>
            </addData>
            <body/>
          </pou>
        </pou>
        """;

        var result = PlcOpenPouParser.Parse(xml);

        Assert.Contains("INTERFACE IMyInterface", result.Declaration);
        Assert.Null(result.BodyLanguage);
        Assert.Single(result.Children);
        Assert.Equal("Compute", result.Children[0].Name);
        Assert.Equal("method", result.Children[0].PouType);
        Assert.Contains("METHOD Compute", result.Children[0].Declaration);
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

        var result = PlcOpenPouParser.Parse(xml);

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

        var result = PlcOpenPouParser.Parse(xml);

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

        var method = PlcOpenPouParser.Parse(xml).Children.Single(c => c.Name == "doSomething");

        Assert.Equal("CFC", method.BodyLanguage);
    }

    [Fact]
    public void Throws_on_malformed_XML()
    {
        const string badXml = "<not><valid>";

        Assert.Throws<System.Xml.XmlException>(() => PlcOpenPouParser.Parse(badXml));
    }

    [Fact]
    public void Throws_when_no_pou_element_found()
    {
        const string xml = $$"""
        <project xmlns="{{Ns}}">
          <types><pous/></types>
        </project>
        """;

        Assert.Throws<InvalidOperationException>(() => PlcOpenPouParser.Parse(xml));
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

        var result = PlcOpenPouParser.Parse(xml);

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

        var result = PlcOpenPouParser.Parse(xml);

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

        var result = PlcOpenPouParser.Parse(xml);

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

        var result = PlcOpenPouParser.Parse(xml);

        Assert.Null(result.BodyLanguage);
        Assert.Null(result.BodyElement);
    }
}
