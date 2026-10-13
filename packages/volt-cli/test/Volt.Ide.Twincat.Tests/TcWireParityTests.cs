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
        new BeckhoffDriver(new TcObjectModel()).ReadManifest(new ItemRef(new XmlItem(xml)), kind);

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
    private static readonly string PlaceholderXml =
        "<TreeItem><ItemName>Util</ItemName>" +
        "<PathName>TIPC^Untitled2^Untitled2 Project^References^Util</PathName><ItemType>657</ItemType>" +
        "<ItemSubType>0</ItemSubType><ItemSubTypeName>TREEITEMTYPE_PLCLIBPLACEHOLDER</ItemSubTypeName><ChildCount>0</ChildCount>" +
        "<PlcLibPlaceholder><PlaceholderReference><LibItemName>#Util</LibItemName><PlaceholderName>Util</PlaceholderName>" +
        "<Namespace>Util</Namespace><DefaultResolution>Util, * (System)</DefaultResolution>" +
        $"<EffectiveResolution><LibraryName>{WireParityCases.LibraryName}</LibraryName>" +
        $"<Version>{WireParityCases.LibraryVersion}</Version><Distributor>{WireParityCases.LibraryDistributor}</Distributor>" +
        "</EffectiveResolution></PlaceholderReference></PlcLibPlaceholder><VSProperties /></TreeItem>";

    [Fact]
    public void A_placeholder_reference_pulls_without_a_SYSTEM_line()
    {
        Assert.Equal(WireParityCases.PlaceholderLibrary, Manifest(PlaceholderXml, ItemKind.Kinds.Library));
    }

    /// <summary>An interface property with a GET: TwinCAT reads presence (its stored <c>PUBLIC / VAR / END_VAR</c> is a
    /// measured constant, spelled as the empty declaration), so the interface pulls as CODESYS's does.</summary>
    [Fact]
    public void An_interface_property_with_a_GET_pulls_the_shared_text()
    {
        var getter = new TcHiddenBodyWriteTests.Node("Get", ItemKind.PlcItfPropGet, "", "");
        var property = new TcHiddenBodyWriteTests.Node("Speed", ItemKind.PlcItfProp, "PROPERTY Speed : INT", "", getter);
        var site = new MemberSites.Site(null, new ItemRef(property), "Speed", ItemKind.PlcItfProp);

        var member = TcUntouchablePouTests.BoundDriver().ReadMember(site, ownerIsInterface: true, WireParityCases.InterfaceDeclaration);

        Assert.Equal(WireParityCases.InterfaceWithGetter,
            StWriter.Write(new ItemContent(ItemKind.Kinds.Interface, WireParityCases.InterfaceDeclaration, null,
                                           new List<Member> { member }, ObjectProperties.None)));
    }
}
