using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using Xunit;
using Xunit.Abstractions;
using Volt.Engine.Format.Network;

namespace Volt.Cli.Tests;

/// <summary>
/// Anything Volt MATERIALIZES must be something Volt will ACCEPT back.
///
/// <para>A pull turns a graphical body into network text and writes it to the workspace. If that exact text is
/// then refused on push, the engineer holds a file they cannot sync and did not write — and no edit of theirs
/// caused it. "Pull succeeded, push is impossible" is a worse failure than either half alone, because the only
/// way out is to discard work.</para>
///
/// <para>Driven over every RECORDED vendor export in the fixture tree rather than hand-written text. These are
/// real CODESYS and TwinCAT documents, so what they exercise is what the two IDEs actually emit — not what a test
/// author imagined they emit, which is how the earlier round-trip evidence in this repo managed to be green over
/// a body it was destroying.</para>
/// </summary>
public class MaterializedIsPushableTests
{
    private readonly ITestOutputHelper _out;
    public MaterializedIsPushableTests(ITestOutputHelper o) => _out = o;

    /// <summary>Every committed PLCopen fixture that carries a writable graphical body (FBD/LD).</summary>
    public static IEnumerable<object[]> GraphicalFixtures()
    {
        var root = Path.Combine(System.AppContext.BaseDirectory, "fixtures");
        if (!Directory.Exists(root)) yield break;
        foreach (var file in Directory.EnumerateFiles(root, "*.xml", SearchOption.AllDirectories).OrderBy(f => f))
        {
            XDocument doc;
            try { doc = XDocument.Load(file); } catch { continue; }
            foreach (var body in doc.Descendants().Where(e => e.Name.LocalName is "FBD" or "LD"))
            {
                // Name the CASE by file + language, so a failure names the document to open.
                yield return new object[] { Path.GetFileName(file), body.Name.LocalName, file };
                break;   // one per file is enough — the point is coverage of shapes, not of duplicates
            }
        }
    }

    /// <summary>The shape the fan-out guard exists for: ONE leaf feeding TWO consumers.
    /// <para>No recorded fixture contains one — measured, 0 of 11 — so the corpus above cannot speak to it either
    /// way, and this case is CONSTRUCTED rather than captured. It is constructed from the guard's own description
    /// of the shape it refuses ("TwinCAT draws one inVariable box per read; a shared one crashes its importer"),
    /// which means CODESYS is expected to emit it.</para>
    /// <para>What matters is not whether the guard is right — it is, for the vendor reason it states — but
    /// whether a PULL can produce text the guard then refuses. If it can, an engineer ends up holding a file Volt
    /// wrote and Volt will not take back.</para></summary>
    [Fact]
    public void A_body_whose_leaf_feeds_two_consumers_still_materializes_into_pushable_text()
    {
        const string Ns = "http://www.plcopen.org/xml/tc6_0200";
        var body = XElement.Parse($"""
            <FBD xmlns="{Ns}">
              <inVariable localId="1"><position x="0" y="0"/><connectionPointOut/><expression>a</expression></inVariable>
              <outVariable localId="2"><position x="0" y="0"/>
                <connectionPointIn><connection refLocalId="1"/></connectionPointIn>
                <expression>out1</expression></outVariable>
              <outVariable localId="3"><position x="0" y="0"/>
                <connectionPointIn><connection refLocalId="1"/></connectionPointIn>
                <expression>out2</expression></outVariable>
            </FBD>
            """);

        var text = NetworkCode.RenderBody(body);
        _out.WriteLine($"materialized as:\n{text}");

        var ex = Record.Exception(() => NetworkCode.Validate(text));
        Assert.True(ex is null,
            "a pull turned a shared leaf into text the push then refuses — the engineer holds a file Volt wrote " +
            $"and Volt will not accept back.\n{ex?.GetType().Name}: {ex?.Message}");
    }

    [Theory]
    [MemberData(nameof(GraphicalFixtures))]
    public void What_a_pull_materializes_a_push_accepts(string fixture, string lang, string path)
    {
        var body = XDocument.Load(path).Descendants().First(e => e.Name.LocalName == lang);

        // The PULL half: exactly what the workspace file would contain.
        var text = NetworkCode.RenderBody(body);

        // The PUSH half: exactly what the splice runs before writing. Must not throw.
        var ex = Record.Exception(() => NetworkCode.Validate(text));
        if (ex is not null)
        {
            _out.WriteLine($"--- {fixture} ({lang}) materialized as ---\n{text}");
            Assert.Fail(
                $"{fixture}: this body pulls cleanly and is then REFUSED on push — the engineer cannot sync a " +
                $"file Volt itself wrote.\n{ex.GetType().Name}: {ex.Message}");
        }
    }
}
