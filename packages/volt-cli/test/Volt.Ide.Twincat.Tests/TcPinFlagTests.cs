using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A POPULATED <c>InputFlags</c> ON A TWINCAT BOX IS REFUSED BY NAME — the parity twin of CODESYS's
/// <c>A_negation_on_a_box_input_pin_is_refused_by_name_not_dropped</c>.
///
/// <para>The reader wrote <c>Flags.None</c> for every pin because the member was null in all 22 archive occurrences
/// measured. On CODESYS — the same object model (DIALECT N1) — the census of 2026-09-26 found six pins whose negation
/// lives ONLY there (<c>scripts/probe-nwl-census-v2.py</c>), and they were pulled as plain contacts. A populated
/// member has never been seen in a TwinCAT archive, so its exact spelling is unmeasured: anything but the null form
/// is refused by name rather than read by a guess or dropped.</para>
/// </summary>
public class TcPinFlagTests
{
    private static XElement Impl(bool populated)
    {
        var doc = XDocument.Load(Fixtures.Path("tc-pou", "FbCall.derived.TcPOU"), LoadOptions.PreserveWhitespace);
        if (populated)
        {
            var nul = doc.Descendants("n").First(n => (string?)n.Attribute("n") == "InputFlags");
            nul.ReplaceWith(new XElement("a", new XAttribute("n", "InputFlags"), new XAttribute("cet", "Flags"),
                new XElement("o", new XElement("v", new XAttribute("n", "Flags"), "1"))));
        }
        return doc.Descendants("NWL").Single()
            .DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");
    }

    [Fact]
    public void A_null_InputFlags_reads_as_before()
    {
        Assert.NotEmpty(TcNetworkReader.Read(Impl(populated: false), BodyLanguage.Fbd).Networks);
    }

    [Fact]
    public void A_populated_InputFlags_is_refused_by_name_not_dropped()
    {
        var ex = Assert.Throws<UnrepresentableBodyException>(() => TcNetworkReader.Read(Impl(populated: true), BodyLanguage.Fbd));
        Assert.Equal("a flag on a box input pin", ex.Marker);
        Assert.Contains("InputFlags", ex.Message);
    }
}
