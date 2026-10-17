using System.Collections.Generic;
using Volt.Engine.Format.St;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE WIRE-PARITY GATE, TWINCAT'S OFFLINE HALF (openspec <c>bridge-one-to-one</c> §2.3): the TwinCAT driver gives the
/// text <see cref="WireParityCases"/> states for each case — the constant <c>CodesysWireParityTests</c> asserts of the
/// CODESYS driver. The live half is <c>test/e2e/vendor-parity.test.ts</c>.
/// </summary>
public class TcWireParityTests
{
    /// <summary>A tree item answering <c>ProduceXml</c> with the document it was given — what <c>ReadManifest</c> reads.
    /// Public: the driver calls it through <c>dynamic</c>, which binds from the driver's assembly.</summary>
    public sealed class XmlItem
    {
        private readonly string _xml;
        public XmlItem(string xml) => _xml = xml;
        public string ProduceXml(bool recursive) => _xml;
    }

    private static string Manifest(string xml, string kind) =>
        new BeckhoffDriver(new TcObjectModel()).ReadManifest(TcRefs.LooseRef(new XmlItem(xml)), kind);

    [Theory]
    [InlineData(ItemKind.Kinds.Visualization, WireParityCases.VisualizationStub)]
    [InlineData(ItemKind.Kinds.TextList, WireParityCases.TextListStub)]
    public void A_stub_manifest_is_the_kind_alone(string kind, string expected)
    {
        Assert.Equal(expected, Manifest("<TreeItem><ItemName>Visu</ItemName><ItemType>1</ItemType></TreeItem>", kind));
    }

    /// <summary>A placeholder reference's item XML, in the element structure <c>tc-library-system</c> recorded for
    /// <c>Tc2_Standard</c> (<c>scripts/vendor-facts.twincat.json</c>: <c>library-xml</c>, <c>placeholder-reference</c>,
    /// <c>placeholder-subtree.standard</c>) with the shared case's values.</summary>
    private static readonly string PlaceholderXml = Placeholder();

    /// <summary>The reference's four flag properties as TcXaeShell answers them (<c>vs-properties.*</c>: present on every
    /// fixture reference, <c>False</c> unless the <c>.plcproj</c> sets the CODESYS member — DIALECT C37b).</summary>
    private static string Placeholder(string hide = "False", string publish = "False", string qualified = "False",
                                      string optional = "False", bool withFlags = true) =>
        "<TreeItem><ItemName>Util</ItemName>" +
        "<PathName>TIPC^Untitled2^Untitled2 Project^References^Util</PathName><ItemType>657</ItemType>" +
        "<ItemSubType>0</ItemSubType><ItemSubTypeName>TREEITEMTYPE_PLCLIBPLACEHOLDER</ItemSubTypeName><ChildCount>0</ChildCount>" +
        "<PlcLibPlaceholder><PlaceholderReference><LibItemName>#Util</LibItemName><PlaceholderName>Util</PlaceholderName>" +
        "<Namespace>Util</Namespace><DefaultResolution>Util, * (System)</DefaultResolution>" +
        $"<EffectiveResolution><LibraryName>{WireParityCases.LibraryName}</LibraryName>" +
        $"<Version>{WireParityCases.LibraryVersion}</Version><Distributor>{WireParityCases.LibraryDistributor}</Distributor>" +
        "</EffectiveResolution></PlaceholderReference></PlcLibPlaceholder><VSProperties>" +
        "<VSProperty><Name>Resolution</Name><Value>Util, * (System) [Default]</Value></VSProperty>" +
        (withFlags
            ? $"<VSProperty><Name>HideReference</Name><Value>{hide}</Value></VSProperty>" +
              $"<VSProperty><Name>PublishAll</Name><Value>{publish}</Value></VSProperty>" +
              $"<VSProperty><Name>QualifiedlAccessOnly</Name><Value>{qualified}</Value></VSProperty>" +
              $"<VSProperty><Name>Optional</Name><Value>{optional}</Value></VSProperty>"
            : "") +
        "</VSProperties></TreeItem>";

    [Fact]
    public void A_placeholder_reference_pulls_without_a_SYSTEM_line()
    {
        Assert.Equal(WireParityCases.PlaceholderLibrary, Manifest(PlaceholderXml, ItemKind.Kinds.Library));
    }

    /// <summary>TwinCAT's reference properties are CODESYS's members under other names — measured live 2026-10-16 by
    /// setting the CODESYS member in a <c>.plcproj</c> copy and reading what TcXaeShell answers (DIALECT C37b):
    /// <c>Optional</c> → <c>Optional</c>, <c>PublishSymbolsInContainer</c> → <c>PublishAll</c>,
    /// <c>HideWhenReferencedAsDependency</c> → <c>HideReference</c>, <c>QualifiedOnly</c> → <c>QualifiedlAccessOnly</c>.
    /// Each spells the line CODESYS spells for its member, so the same reference pulls the same bytes on both vendors.</summary>
    [Theory]
    [InlineData("True", "False", "False", "False", "HIDEWHENREFERENCEDASDEPENDENCY\n")]
    [InlineData("False", "True", "False", "False", "PUBLISHSYMBOLSINCONTAINER\n")]
    [InlineData("False", "False", "True", "False", "QUALIFIEDONLY\n")]
    [InlineData("False", "False", "False", "True", "OPTIONAL\n")]
    [InlineData("True", "True", "True", "True", "QUALIFIEDONLY\nOPTIONAL\nHIDEWHENREFERENCEDASDEPENDENCY\nPUBLISHSYMBOLSINCONTAINER\n")]
    public void A_flagged_reference_spells_the_line_CODESYS_spells(string hide, string publish, string qualified,
                                                                    string optional, string lines)
    {
        Assert.Equal(WireParityCases.PlaceholderLibrary.Replace("MATERIALIZATION ", lines + "MATERIALIZATION "),
                     Manifest(Placeholder(hide, publish, qualified, optional), ItemKind.Kinds.Library));
    }

    /// <summary>A flag property the reference does not answer, or answers with a value that is neither True nor False,
    /// refuses the reference by name — read, never assumed (every live reference answers all four).</summary>
    [Fact]
    public void A_reference_without_its_flag_properties_is_refused_by_name()
    {
        var missing = Assert.Throws<Volt.Engine.BridgeException>(() =>
            Manifest(Placeholder(withFlags: false), ItemKind.Kinds.Library));
        Assert.Contains("HideReference", missing.Message);

        var odd = Assert.Throws<Volt.Engine.BridgeException>(() =>
            Manifest(Placeholder(optional: "Maybe"), ItemKind.Kinds.Library));
        Assert.Contains("Optional = Maybe", odd.Message);
    }

    /// <summary>An interface property with a GET: TwinCAT reads presence (its stored <c>PUBLIC / VAR / END_VAR</c> is a
    /// measured constant, spelled as the empty declaration), so the interface pulls as CODESYS's does.</summary>
    [Fact]
    public void An_interface_property_with_a_GET_pulls_the_shared_text()
    {
        var getter = new TcHiddenBodyWriteTests.Node("Get", ItemKind.PlcItfPropGet, "", "");
        var property = new TcHiddenBodyWriteTests.Node("Speed", ItemKind.PlcItfProp, "PROPERTY Speed : INT", "", getter);
        var driver = TcUntouchablePouTests.BoundDriver();
        var site = new MemberSites.Site(null, TcRefs.Ref(property), "Speed", ItemKind.PlcItfProp);

        var member = driver.ReadMember(site, ownerIsInterface: true, WireParityCases.InterfaceDeclaration);

        Assert.Equal(WireParityCases.InterfaceWithGetter,
            StWriter.Write(new ItemContent(ItemKind.Kinds.Interface, WireParityCases.InterfaceDeclaration, null,
                                           new List<Member> { member }, ObjectProperties.None)));
    }
}
