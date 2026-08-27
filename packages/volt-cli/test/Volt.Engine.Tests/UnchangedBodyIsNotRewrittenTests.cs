using System.IO;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Document;
using Volt.Engine.Source.Body.Network;
using Xunit;
using Xunit.Abstractions;

namespace Volt.Cli.Tests;

/// <summary>
/// Pushing a graphical body back UNCHANGED must not touch the stored XML at all.
///
/// <para><c>NetworkCodec.Encode</c> ends with a no-op guard — <c>if (XNode.DeepEquals(existing, replacement))
/// return false;</c> — but it compares the stored element to the REGENERATED one. Regeneration is lossy: measured
/// over every recorded vendor export, <c>original != regenerated</c> on 9 of 9. So the guard can essentially never
/// fire on a real vendor document, and every push rewrites every graphical body.</para>
///
/// <para>That is not a rare path. A push restates EVERY member of a POU, so editing one line of a declaration —
/// or of one method's ST — rewrites every graphical body in that POU, discarding each one's ids, vendor addData,
/// comment boxes and param-type payloads. The engineer changed none of them.</para>
///
/// <para>The fix is to compare what the engineer actually pushed against what they would have pulled: the
/// BASELINE RENDER. <c>NetworkCode.RenderBody(existing)</c> reproduces the exact text a pull produced, so if the
/// pushed text equals it, there is nothing to write. Carrying requires byte equality, so this cannot carry the
/// wrong thing — a language change renders a different <c>NETWORK n LANG</c> header and regenerates, with no
/// special case needed.</para>
/// </summary>
public class UnchangedBodyIsNotRewrittenTests
{
    private readonly ITestOutputHelper _out;
    public UnchangedBodyIsNotRewrittenTests(ITestOutputHelper o) => _out = o;

    private static string FixtureRoot =>
        Path.Combine(System.AppContext.BaseDirectory, "fixtures");

    /// <summary>Every recorded vendor export carrying a writable graphical body, by file + language.</summary>
    public static TheoryData<string, string> RecordedGraphicalBodies()
    {
        var data = new TheoryData<string, string>();
        if (!Directory.Exists(FixtureRoot)) return data;
        foreach (var file in Directory.EnumerateFiles(FixtureRoot, "*.xml", SearchOption.AllDirectories)
                     .Where(f => !f.Contains("roundtrip"))   // hand-authored, not vendor output
                     .OrderBy(f => f))
        {
            XDocument doc;
            try { doc = XDocument.Load(file); } catch { continue; }
            var body = doc.Descendants().FirstOrDefault(e => e.Name.LocalName is "FBD" or "LD");
            if (body is not null) data.Add(file, body.Name.LocalName);
        }
        return data;
    }

    /// <summary>The whole claim, over real vendor XML: render the stored body to network text, hand that exact
    /// text back to the encoder, and the stored element must be untouched — same object, byte-identical.</summary>
    [Theory]
    [MemberData(nameof(RecordedGraphicalBodies))]
    public void Re_pushing_the_text_a_pull_produced_leaves_the_stored_body_untouched(string path, string lang)
    {
        var doc = XDocument.Load(path);
        var stored = doc.Descendants().First(e => e.Name.LocalName == lang);
        var body = stored.Parent!;
        var before = stored.ToString();

        // Exactly what the engineer holds in the repo after a pull.
        var pulled = NetworkCode.RenderBody(stored);

        var codec = BodyCodec.For(lang);
        var changed = codec.Encode(body, pulled, declaration: null);

        var after = body.Elements().First(e => e.Name.LocalName == lang).ToString();
        if (changed || after != before)
        {
            _out.WriteLine($"--- {Path.GetFileName(path)} ({lang}) pulled text ---\n{pulled}");
            _out.WriteLine($"--- stored ---\n{before}");
            _out.WriteLine($"--- after re-pushing the SAME text ---\n{after}");
        }

        Assert.False(changed,
            $"{Path.GetFileName(path)}: re-pushing the text a pull produced reported a CHANGE — so a push that " +
            "restates an unmodified body rewrites it.");
        Assert.Equal(before, after);
    }

    /// <summary>And the case that makes it expensive: the engineer edits something else entirely.
    /// <para>A push restates every member, so the graphical body is re-encoded even when the edit was to a
    /// declaration. Nothing about that edit may reach the diagram.</para></summary>
    [Theory]
    [MemberData(nameof(RecordedGraphicalBodies))]
    public void An_edit_elsewhere_in_the_pou_does_not_rewrite_the_diagram(string path, string lang)
    {
        var doc = XDocument.Load(path);
        var stored = doc.Descendants().First(e => e.Name.LocalName == lang);
        var body = stored.Parent!;
        var before = stored.ToString();

        var pulled = NetworkCode.RenderBody(stored);

        // The declaration changed; the body text did not. This is the ordinary shape of a push.
        BodyCodec.For(lang).Encode(body, pulled, declaration: "VAR\n\tsomethingNew : BOOL;\nEND_VAR");

        Assert.Equal(before, body.Elements().First(e => e.Name.LocalName == lang).ToString());
    }
}
