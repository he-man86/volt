using System;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE PRODUCTION ROUND TRIP, against real vendor bytes.
///
/// <para><b>Why this file exists.</b> An audit found that the writer degrades the engineer's project on every
/// push, and that the existing writer test could not see it: it feeds the writer an ARCHIVE-derived model, while
/// the push path always hands it a TEXT-derived one. Those are different shapes. An archive-derived model
/// carries an operand's <c>Flags</c>, <c>LValue</c>, <c>Type</c> and <c>SymbolComment</c>; a text-derived one
/// provably cannot — <c>NetworkTextReader</c> builds <c>new Operand(name)</c> and network text has no syntax for
/// any of them. So the writer was assigning four archive members from a model that never had values for them.</para>
///
/// <para>This drives the REAL path end to end:</para>
/// <code>
/// .TcPOU archive → TcNetworkReader → NetworkTextWriter → the .fb text an engineer sees in git
///                                  → NetworkTextGate    → TcNetworkWriter.Apply → the archive again
/// </code>
/// <para>and asserts the thing that actually matters: <b>a push that changes nothing must change nothing.</b>
/// `PushService` always sends the item's own body, so a declaration-only edit — renaming a variable in the VAR
/// block — takes this exact path through every operand of every network.</para>
/// </summary>
public class TcRoundTripTests
{
    private static string Fixture(string name)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "Volt.sln"))) dir = dir.Parent;
        Assert.True(dir != null, "could not find Volt.sln above the test binaries");
        var path = Path.Combine(dir!.FullName, "test", "Volt.Engine.Tests", "fixtures", "tc-pou", name);
        Assert.True(File.Exists(path), $"missing vendor fixture: {path}");
        return path;
    }

    /// <summary>The NWL body of a vendor-written .TcPOU, exactly as it sits in the file.</summary>
    private static string Body(string fixture) =>
        XDocument.Load(Fixture(fixture), LoadOptions.PreserveWhitespace)
            .Descendants("NWL").Single().ToString(SaveOptions.DisableFormatting);

    private static XElement Impl(string body) =>
        XElement.Parse(body, LoadOptions.PreserveWhitespace)
            .DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");

    /// <summary>Read the archive the way a PULL does, then parse the text back the way a PUSH does. This is the
    /// model the writer actually receives in production — not the archive-derived one.</summary>
    private static NetworkBody TextDerivedModel(string body)
    {
        var pulled = TcNetworkReader.Read(Impl(body), BodyLanguage.Ld);
        var text = NetworkTextWriter.Write(pulled);
        return NetworkTextGate.Validate(text);
    }

    /// <summary>Every scalar member in the archive, addressed by its path, so a diff names WHAT changed.</summary>
    private static System.Collections.Generic.Dictionary<string, string> Scalars(string body)
    {
        var map = new System.Collections.Generic.Dictionary<string, string>();
        var root = XElement.Parse(body);
        var n = 0;
        foreach (var v in root.Descendants("v"))
        {
            var name = (string?)v.Attribute("n") ?? "?";
            map[$"{name}#{n++}"] = v.Value;
        }
        return map;
    }

    /// <summary>THE INVARIANT. Pull a body, push the identical text straight back, and the archive must be
    /// untouched — every operand's declared Type, its l-value marker, its modifier bits and the engineer's
    /// symbol comments still exactly as the IDE wrote them.
    ///
    /// <para>This needs NO body edit to trigger in production: `PushService` sends the item's own body on every
    /// push, so renaming a variable in the VAR block runs this path over every operand of every network.</para></summary>
    [Theory]
    [InlineData("POU_PBD.TcPOU")]
    [InlineData("ladder.TcPOU")]
    public void A_push_that_changes_nothing_changes_nothing_in_the_archive(string fixture)
    {
        var before = Body(fixture);
        var model = TextDerivedModel(before);

        var written = TcNetworkWriter.Apply(before, model);

        // Null is the ideal answer — "nothing changed, so nothing was written". If the writer does return a
        // document, it must at least be scalar-for-scalar what it was handed.
        if (written is null) return;

        var was = Scalars(before);
        var now = Scalars(written);
        var drifted = was.Where(kv => now.TryGetValue(kv.Key, out var v) && v != kv.Value)
                         .Select(kv => $"{kv.Key}: '{kv.Value}' -> '{now[kv.Key]}'")
                         .ToList();

        Assert.True(drifted.Count == 0,
            "a no-op push rewrote live vendor state:\n  " + string.Join("\n  ", drifted));
    }

    /// <summary>And the stated contract of the writer itself: an unchanged model is not written back AT ALL.
    /// Its doc says so — "an unchanged model does not come back at all" — and that is what stops a push from
    /// rewriting ids and vendor members for no change. Measured against the model production actually
    /// supplies, not one derived from the archive it is about to be compared with.</summary>
    [Theory]
    [InlineData("POU_PBD.TcPOU")]
    [InlineData("ladder.TcPOU")]
    public void A_push_of_an_unchanged_body_is_not_written_back_at_all(string fixture)
    {
        var before = Body(fixture);
        Assert.Null(TcNetworkWriter.Apply(before, TextDerivedModel(before)));
    }
}
