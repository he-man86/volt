using System.Linq;
using Volt.Engine.Sync;
using Volt.Engine.Wire;
using Volt.Engine.Workspace;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// The INTERFACE document. An interface joins the single-document write with two shape differences a POU does
/// not have: its members live in plain <c>&lt;Methods&gt;</c>/<c>&lt;Properties&gt;</c> containers rather than in
/// per-member <c>addData/data</c> wrappers, and neither it nor any of its members has a <c>&lt;body&gt;</c>.
/// <para>Measured on CODESYS 3.5.21.40 (probe 15/16) BEFORE these were written, because the offline fake cannot
/// answer whether the IDE accepts a document: a spliced <c>&lt;Method&gt;</c> with a bare <c>&lt;interface/&gt;</c>
/// lands, and so does a <c>&lt;Property&gt;</c> — with or without bodies on its accessors. So the import was
/// never the constraint here; what these pin is that the SPLICE actually produces the members at all.</para>
/// </summary>
public class InterfaceDocumentTests
{
    private const string Src =
        "INTERFACE K\n\nMETHOD DoIt : INT\nEND_METHOD\n\nPROPERTY Ready : BOOL\nGET\nEND_GET\nEND_PROPERTY\n\nEND_INTERFACE\n";

    private static string PushAndCapture(string src)
    {
        var ide = new FakeIde() { OneDocumentWrite = true };
        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            Ops = new() { new SetItemOp { Name = "K.itf", SourceText = src } },
        });
        Assert.True(resp.Accepted,
            "push rejected: " + string.Join("; ", resp.Conflicts?.Select(c => $"{c.Name}: {c.Reason}") ?? new[] { "<none>" }));
        return ide.WrittenXml["K"];
    }

    /// <summary>Both member kinds reach the document. The live failure this was written for landed the METHOD and
    /// silently dropped the PROPERTY — an asymmetry no guard reported, because a member that is never spliced in
    /// looks exactly like a member the push did not carry.</summary>
    [Fact]
    public void A_methods_AND_properties_both_reach_the_interface_document()
    {
        var doc = PushAndCapture(Src);

        Assert.Contains("<Method name=\"DoIt\"", doc);
        Assert.Contains("<Property name=\"Ready\"", doc);
    }

    /// <summary>Members go in the interface's own containers, NOT in the POU-style per-member addData wrapper.
    /// Both shapes are accepted by the importer, so only a structural assertion catches a regression here.</summary>
    [Fact]
    public void B_members_live_in_Methods_and_Properties_containers()
    {
        var doc = System.Xml.Linq.XDocument.Parse(PushAndCapture(Src));

        foreach (var (member, group) in new[] { ("Method", "Methods"), ("Property", "Properties") })
        {
            var el = doc.Descendants().Single(e => e.Name.LocalName == member);
            Assert.Equal(group, el.Parent!.Name.LocalName);
        }
        Assert.DoesNotContain(doc.Descendants(), e => e.Name.LocalName == "data"
            && ((string?)e.Attribute("name"))?.EndsWith("/method") == true);
    }

    /// <summary>An interface carries no code — not on itself and not on a member. A <c>&lt;body&gt;</c> anywhere
    /// in the document would be an element the vendor's own export never contains.</summary>
    [Fact]
    public void C_no_body_element_appears_anywhere()
    {
        var doc = System.Xml.Linq.XDocument.Parse(PushAndCapture(Src));

        Assert.DoesNotContain(doc.Descendants(), e => e.Name.LocalName == "body");
    }

    /// <summary>A GET-only property keeps its getter and gains no phantom setter. The absent accessor is
    /// REMOVED, not left as an empty stub — null and "" mean different things all the way down this path.</summary>
    [Fact]
    public void D_a_GET_only_property_has_no_SetAccessor()
    {
        var doc = System.Xml.Linq.XDocument.Parse(PushAndCapture(Src));

        Assert.Contains(doc.Descendants(), e => e.Name.LocalName == "GetAccessor");
        Assert.DoesNotContain(doc.Descendants(), e => e.Name.LocalName == "SetAccessor");
    }
}
