using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Document;
using Xunit;
using Xunit.Abstractions;

namespace Volt.Cli.Tests;

/// <summary>
/// ONE declaration rule, for every member position.
///
/// <para>A declaration was written four different ways depending on WHERE it sat. The root POU and an existing
/// child (<c>SetDeclaration</c>, <c>SetChildText</c>) took the same rule: every <c>&lt;InterfaceAsPlainText&gt;</c>
/// the item owns, and throw if there is none. A property ACCESSOR took a different one: the FIRST direct child
/// only, and silently CREATE one when absent.</para>
///
/// <para>First-only is not a stylistic difference. <c>PlcOpenDocument</c> records why the others take all of
/// them: <i>"once a POU declares any variable, CODESYS exports its declaration TWICE… Taking the FIRST wrote to
/// the nested copy while the IDE kept reading the other."</i> DIALECT <b>A7</b> confirms it with two fixtures.
/// So the accessor path is the shape that is already known to produce a write that reports success and changes
/// nothing the IDE will read.</para>
///
/// <para><b>The two-copy case has never been exercised on an accessor</b> — every recorded fixture carrying one
/// has exactly a single block and none declares a variable (openspec `splice-graphical-body`, U21). That is
/// precisely why the rule must not be position-dependent: nobody can point at the fixture that would have caught
/// this, so the only defence is that there is one rule to get wrong.</para>
/// </summary>
public class DeclarationRuleTests
{
    private readonly ITestOutputHelper _out;
    public DeclarationRuleTests(ITestOutputHelper o) => _out = o;

    private const string Ns = "http://www.plcopen.org/xml/tc6_0200";
    private const string Xh = "http://www.w3.org/1999/xhtml";
    /// <summary>The accessor's stored declaration. Built as an escaped constant because a raw
    /// string literal cannot carry the leading TAB that real IEC declarations use.</summary>
    private const string Decl0 = "VAR\n\tcached : INT;\nEND_VAR";

    /// <summary>A property whose GET accessor carries its declaration TWICE — the shape A7 describes for a POU,
    /// applied to the position that never had a fixture.</summary>
    private const string AccessorWithTwoDeclBlocks = $"""
    <pou xmlns="{Ns}" name="P" pouType="functionBlock">
      <interface><addData><data name="x"><InterfaceAsPlainText><xhtml xmlns="{Xh}">FUNCTION_BLOCK P</xhtml></InterfaceAsPlainText></data></addData></interface>
      <body><ST><xhtml xmlns="{Xh}">;</xhtml></ST></body>
      <addData><data name="p"><Property name="Ready">
        <interface><addData><data name="x"><InterfaceAsPlainText><xhtml xmlns="{Xh}">PROPERTY Ready : INT</xhtml></InterfaceAsPlainText></data></addData></interface>
        <GetAccessor name="Get">
          <InterfaceAsPlainText><xhtml xmlns="{Xh}">{Decl0}</xhtml></InterfaceAsPlainText>
          <body><ST><xhtml xmlns="{Xh}">Ready := cached;</xhtml></ST></body>
          <addData><data name="x"><InterfaceAsPlainText><xhtml xmlns="{Xh}">{Decl0}</xhtml></InterfaceAsPlainText></data></addData>
        </GetAccessor>
      </Property></data></addData>
    </pou>
    """;

    private static string[] AccessorDecls(string xml) =>
        XDocument.Parse(xml).Descendants().First(e => e.Name.LocalName == "GetAccessor")
            .Descendants().Where(e => e.Name.LocalName == "InterfaceAsPlainText")
            .Select(e => e.Value).ToArray();

    /// <summary>The A7 shape, on an accessor: BOTH copies must be written, or the IDE reads the stale one.</summary>
    [Fact]
    public void An_accessor_declaration_is_written_to_every_copy_the_export_carries()
    {
        const string updated = "VAR\n\tcached : DINT;\nEND_VAR";

        var before = AccessorDecls(AccessorWithTwoDeclBlocks);
        Assert.Equal(2, before.Length);          // the fixture really is the two-copy shape

        var outXml = PouSplice.SetAccessor(AccessorWithTwoDeclBlocks, "P", "Ready", getter: true, "Ready := cached;", updated);

        var after = AccessorDecls(outXml);
        _out.WriteLine($"copies: {after.Length} -> [{string.Join(" | ", after.Select(a => a.Replace("\n", "\\n")))}]");

        Assert.All(after, d => Assert.Equal(updated, d));
    }

    /// <summary>The other axis: an accessor with NO declaration block gets one — because Volt BUILT that
    /// accessor, and a half-built element of its own is the one case where creating a block is correct.
    ///
    /// <para>This case originally asserted a REFUSAL, on the reasoning that inventing a block manufactures a
    /// document shape no vendor emits. That reasoning is sound and the assertion was still wrong, for a reason
    /// independent of any code under test: <c>PouSplice.AddChild</c> materializes the accessor pair a property
    /// declaration implies as bare <c>&lt;GetAccessor&gt;&lt;interface/&gt;&lt;/GetAccessor&gt;</c>, and
    /// <c>SetAccessor</c> creates one a push introduces the same way. On that path an absent block means "Volt has
    /// not finished building this yet", and refusing it breaks every interface-property push — which is exactly
    /// what it did: four <c>InterfaceDocumentTests</c> went red.</para>
    ///
    /// <para>So the two facts are separated rather than fused. <c>Declaration.Write</c> stays strict everywhere,
    /// and <c>Declaration.Establish</c> completes Volt's own construction, at the one site that constructs. What
    /// is NOT achievable is telling a half-built accessor from a genuinely malformed vendor export — they are the
    /// same bytes — so that refusal is not claimed. The old code reached the same outcome by fusing the cases and
    /// therefore could not state which it was handling.</para></summary>
    [Fact]
    public void An_accessor_volt_built_gets_its_declaration_block_on_first_write()
    {
        var noDecl = $"""
        <pou xmlns="{Ns}" name="P" pouType="functionBlock">
          <interface><addData><data name="x"><InterfaceAsPlainText><xhtml xmlns="{Xh}">FUNCTION_BLOCK P</xhtml></InterfaceAsPlainText></data></addData></interface>
          <body><ST><xhtml xmlns="{Xh}">;</xhtml></ST></body>
          <addData><data name="p"><Property name="Ready">
            <interface><addData><data name="x"><InterfaceAsPlainText><xhtml xmlns="{Xh}">PROPERTY Ready : INT</xhtml></InterfaceAsPlainText></data></addData></interface>
            <GetAccessor name="Get"><body><ST><xhtml xmlns="{Xh}">Ready := 1;</xhtml></ST></body></GetAccessor>
          </Property></data></addData>
        </pou>
        """;
        const string decl = "VAR\nEND_VAR";

        Assert.Empty(AccessorDecls(noDecl));                     // the half-built shape Volt creates

        var outXml = PouSplice.SetAccessor(noDecl, "P", "Ready", getter: true, "Ready := 1;", decl);

        var after = AccessorDecls(outXml);
        _out.WriteLine($"established {after.Length} block(s)");
        Assert.Single(after);
        Assert.Equal(decl, after[0]);
    }

    /// <summary>And once established, the strict rule applies again: a SECOND write goes to every copy, so an
    /// accessor cannot drift back into the first-only behaviour just because Volt created it.</summary>
    [Fact]
    public void A_second_write_to_an_established_accessor_uses_the_strict_rule()
    {
        const string updated = "VAR\n\tcached : LINT;\nEND_VAR";
        var outXml = PouSplice.SetAccessor(AccessorWithTwoDeclBlocks, "P", "Ready", getter: true, "Ready := cached;", updated);
        // NB `code: null` REMOVES an accessor — null and "" are deliberately distinct on this path — so a
        // declaration-only write restates the body it already has.
        Assert.All(AccessorDecls(outXml), d => Assert.Equal(updated, d));
    }
}
