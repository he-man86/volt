using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Xml.Linq;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE IDENTITY GATE for writing a graphical body into a POU MEMBER.
///
/// <para>Volt rewrites the `.TcPOU` TwinCAT itself produced here, and that is the operation this repo has the
/// worst history with: inferring the member contract once wrote twenty unopenable files. So the rewrite has to
/// be proven to change ONLY what it claims, against a real vendor document, and these tests are that proof.</para>
///
/// <para>The fixture is TwinCAT's own output — an FB with an ST ACTION and an ST PROPERTY, created through the
/// bridge and taken off disk verbatim. Every assertion is "this changed, and nothing else did".</para>
///
/// <para>Why the rewrite exists at all: `ImplementationText` cannot carry a graphical body into a member. On a
/// POU already holding an NWL archive TwinCAT replaces the archive, but on a METHOD, an ACTION or a property
/// ACCESSOR the same assignment stores it as ST TEXT and the project stops compiling (DIALECT D32).</para>
///
/// <para>Reached by reflection because <c>TcItemArchive</c> is internal and its zip-level entry points want a
/// live COM parent. What is under test is the pure part — the function that decides what the document becomes —
/// which is exactly the part that can corrupt a file.</para>
/// </summary>
public class TcMemberBodyTests
{
    /// <summary>Read a vendor fixture from the repo, as the other TwinCAT tests do — they are not copied to the
    /// test output.</summary>
    private static string VendorFixture(string name)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "Volt.sln"))) dir = dir.Parent;
        Assert.True(dir != null, "could not find Volt.sln above the test binaries");
        var path = Path.Combine(dir!.FullName, "test", "Volt.Engine.Tests", "fixtures", "tc-pou", name);
        Assert.True(File.Exists(path), $"missing vendor fixture: {path}");
        return File.ReadAllText(path);
    }

    private static string Fixture() => VendorFixture("MembersSt.TcPOU");

    /// <summary>A real graphical body, lifted from an IDE-drawn ladder.</summary>
    private static string Nwl()
    {
        var ladder = VendorFixture("ladder.TcPOU");
        var i = ladder.IndexOf("<NWL>", StringComparison.Ordinal);
        var j = ladder.IndexOf("</NWL>", StringComparison.Ordinal) + "</NWL>".Length;
        return ladder.Substring(i, j - i);
    }

    /// <summary>Invoke the internal <c>TrySetBody(ref string, string[], string)</c>.</summary>
    private static (bool Ok, string Doc) SetBody(string tcPou, string[] path, string nwl)
    {
        var t = typeof(TcNetworkWriter).Assembly.GetType("Volt.Ide.Twincat.TcItemArchive")
                ?? throw new InvalidOperationException("TcItemArchive not found");
        var m = t.GetMethod("TrySetBody", BindingFlags.NonPublic | BindingFlags.Static)
                ?? throw new InvalidOperationException("TrySetBody not found");
        object?[] args = { tcPou, path, nwl };
        var ok = (bool)m.Invoke(null, args)!;
        return (ok, (string)args[0]!);
    }

    private static XElement Member(string doc, params string[] path)
    {
        XElement e = XDocument.Parse(doc).Root!;
        foreach (var step in path)
            e = e.Descendants().First(x => x.Name.LocalName is "Method" or "Action" or "Property" or "Get" or "Set"
                                        && (string?)x.Attribute("Name") == step);
        return e;
    }

    private static string[] LineIdNames(string doc) =>
        XDocument.Parse(doc).Descendants().Where(e => e.Name.LocalName == "LineIds")
                 .Select(e => (string?)e.Attribute("Name") ?? "").ToArray();

    /// <summary>THE BODY LANDS, as a diagram and not as text.</summary>
    [Fact]
    public void A_graphical_body_replaces_the_accessors_ST()
    {
        var (ok, doc) = SetBody(Fixture(), new[] { "P_G", "Get" }, Nwl());

        Assert.True(ok, "the accessor was not found in the archive");
        var impl = Member(doc, "P_G", "Get").Elements().First(e => e.Name.LocalName == "Implementation");
        Assert.Equal("NWL", Assert.Single(impl.Elements()).Name.LocalName);
    }

    /// <summary>AND ITS LINE BOOKKEEPING GOES WITH IT. `LineIds` is per-TEXTUAL-body — an IDE-drawn ladder
    /// carries none — so leaving `POU.P_G.Get` behind would describe line numbers for a body with no lines. The
    /// OTHER members keep theirs, which is the half that says this removed the right one.</summary>
    [Fact]
    public void Only_that_members_line_ids_are_removed()
    {
        var before = LineIdNames(Fixture());
        var (_, doc) = SetBody(Fixture(), new[] { "P_G", "Get" }, Nwl());

        Assert.Contains("VltProbe_Mem.P_G.Get", before);
        Assert.Equal(before.Where(n => n != "VltProbe_Mem.P_G.Get").ToArray(), LineIdNames(doc));
    }

    /// <summary>AND NOTHING ELSE IN THE DOCUMENT MOVES — the sibling accessor, the action, and the POU's own
    /// declaration all come through byte for byte.</summary>
    [Fact]
    public void Every_other_member_is_untouched()
    {
        var (_, doc) = SetBody(Fixture(), new[] { "P_G", "Get" }, Nwl());

        foreach (var path in new[] { new[] { "A_G" }, new[] { "P_G", "Set" } })
            Assert.Equal(Member(Fixture(), path).ToString(SaveOptions.DisableFormatting),
                         Member(doc, path).ToString(SaveOptions.DisableFormatting));

        var was = XDocument.Parse(Fixture()).Descendants().First(e => e.Name.LocalName == "POU");
        var now = XDocument.Parse(doc).Descendants().First(e => e.Name.LocalName == "POU");
        Assert.Equal((string?)was.Attribute("Name"), (string?)now.Attribute("Name"));
        Assert.Equal(was.Elements().First(e => e.Name.LocalName == "Declaration").Value,
                     now.Elements().First(e => e.Name.LocalName == "Declaration").Value);
    }

    /// <summary>A METHOD OR ACTION is addressed by one step, an accessor by two — and both work.</summary>
    [Fact]
    public void An_action_is_addressed_by_its_own_name()
    {
        var (ok, doc) = SetBody(Fixture(), new[] { "A_G" }, Nwl());

        Assert.True(ok);
        var impl = Member(doc, "A_G").Elements().First(e => e.Name.LocalName == "Implementation");
        Assert.Equal("NWL", Assert.Single(impl.Elements()).Name.LocalName);
        Assert.DoesNotContain("VltProbe_Mem.A_G", LineIdNames(doc));
    }

    /// <summary>A MEMBER THE ARCHIVE DOES NOT HOLD ANSWERS FALSE, so the caller can name the body it could not
    /// place instead of reporting a write that never happened.</summary>
    [Fact]
    public void A_missing_member_is_reported_not_ignored()
    {
        var (ok, doc) = SetBody(Fixture(), new[] { "NoSuchMember" }, Nwl());

        Assert.False(ok);
        Assert.Equal(Fixture(), doc);
    }

    /// <summary>AND A MALFORMED BODY THROWS HERE, before the caller deletes the POU to re-import it. The round
    /// trip removes the item from the project for the window between export and import, so anything that can
    /// throw must throw before that window opens.</summary>
    [Fact]
    public void A_malformed_body_throws_before_anything_is_written()
    {
        Assert.ThrowsAny<Exception>(() => SetBody(Fixture(), new[] { "A_G" }, "<NWL><unclosed>"));
    }
}
