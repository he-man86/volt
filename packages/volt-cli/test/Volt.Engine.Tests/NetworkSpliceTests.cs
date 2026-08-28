using System;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.PlcOpen;
using Volt.Engine.Format.Network;
using Xunit;
using Xunit.Abstractions;

namespace Volt.Cli.Tests;

/// <summary>
/// Editing ONE network must not rewrite the others.
///
/// <para>A push regenerates a graphical body from network text, and regeneration is lossy — measured on the
/// recorded exports, it destroys the `fbdattributes` vendorElement, every comment box, an LD contact's power-rail
/// wire and all the localIds. The whole-body no-op guard covers "nothing changed at all"; this covers the
/// ordinary edit, where one network moved and the rest were collateral.</para>
///
/// <para>These drive the REAL production path — <c>BodyCodec.For(lang).Encode</c> — over recorded vendor exports,
/// not hand-built XML. That is deliberate: the loss this prevents was only ever visible against what a vendor
/// actually emits, and a fixture written by a test author cannot testify about that.</para>
/// </summary>
public class NetworkSpliceTests
{
    private readonly ITestOutputHelper _out;
    public NetworkSpliceTests(ITestOutputHelper o) => _out = o;

    /// <summary>Recorded vendor exports with MORE THAN ONE network — the only ones where "carry the others" can
    /// mean anything. A single-network body is covered by the whole-body no-op.</summary>
    public static TheoryData<string, string> MultiNetworkBodies()
    {
        var data = new TheoryData<string, string>();
        var root = Path.Combine(AppContext.BaseDirectory, "fixtures");
        if (!Directory.Exists(root)) return data;
        foreach (var file in Directory.EnumerateFiles(root, "*.xml", SearchOption.AllDirectories)
                     .Where(f => !f.Contains("roundtrip"))
                     .OrderBy(f => f, StringComparer.Ordinal))
        {
            XDocument doc;
            try { doc = XDocument.Load(file); } catch { continue; }
            var body = doc.Descendants().FirstOrDefault(e => e.Name.LocalName is "FBD" or "LD");
            if (body is null) continue;
            var text = NetworkCode.RenderBody(body);
            if (Networks(text).Length > 1) data.Add(Path.GetFileName(file), file);
        }
        return data;
    }

    /// <summary>Each `NETWORK n … ` block of a body's text, in order — SLICED, not split, so concatenating
    /// them reproduces the original byte for byte. A `Split` on the header swallows the separator, and the
    /// concatenation then reads `END_NETWORKNETWORK 2 FBD`, which is not a body.</summary>
    private static string[] Networks(string text)
    {
        var heads = Regex.Matches(text, @"^NETWORK[ \t]+\d+\b", RegexOptions.Multiline)
            .Cast<Match>().ToList();
        return heads.Select((h, i) =>
            text.Substring(h.Index, (i + 1 < heads.Count ? heads[i + 1].Index : text.Length) - h.Index)).ToArray();
    }

    /// <summary>The whole claim: edit the LAST network, and every earlier one keeps its stored XML byte for byte.
    ///
    /// <para>The edit is a coil/output rename — the smallest change that is unambiguously an edit, cannot be
    /// mistaken for a reformat, and leaves the body still parseable.</para></summary>
    [Theory]
    [MemberData(nameof(MultiNetworkBodies))]
    public void Editing_one_network_leaves_the_others_byte_identical(string fixture, string path)
    {
        var doc = XDocument.Load(path);
        var stored = doc.Descendants().First(e => e.Name.LocalName is "FBD" or "LD");
        var lang = stored.Name.LocalName;
        var body = stored.Parent!;

        var pulled = NetworkCode.RenderBody(stored);
        var nets = Networks(pulled);
        var storedGroups = GraphReader.SplitNetworks(stored.Elements().ToList());

        // Snapshot every network's stored XML BEFORE the write.
        var beforeXml = storedGroups.ToDictionary(
            g => g.Index, g => string.Concat(g.Els.Select(e => e.ToString())));

        // Edit only the last network: rename an assignment target.
        var lastIdx = nets.Length - 1;
        var editedLast = nets[lastIdx].Replace(":=", "_edited :=");
        if (editedLast == nets[lastIdx]) { _out.WriteLine($"{fixture}: last network has no assignment — skipped"); return; }
        var pushed = string.Concat(nets.Take(lastIdx)) + editedLast;

        var changed = BodyCodec.For(lang).Encode(body, pushed, declaration: null);
        Assert.True(changed, $"{fixture}: an edited body reported no change");

        var after = body.Elements().First(e => e.Name.LocalName == lang);
        var afterGroups = GraphReader.SplitNetworks(after.Elements().ToList())
            .ToDictionary(g => g.Index, g => string.Concat(g.Els.Select(e => e.ToString())));

        var carried = 0;
        foreach (var (index, xml) in beforeXml.OrderBy(kv => kv.Key))
        {
            if (index == storedGroups[lastIdx].Index) continue;        // the edited one regenerates, as it must
            if (!afterGroups.TryGetValue(index, out var now)) continue;
            if (now == xml) { carried++; continue; }
            _out.WriteLine($"--- {fixture} network {index} STORED ---\n{xml}");
            _out.WriteLine($"--- after editing a DIFFERENT network ---\n{now}");
            Assert.Fail($"{fixture}: editing the last network rewrote network {index}, which nobody touched.");
        }

        _out.WriteLine($"{fixture}: {carried} of {beforeXml.Count - 1} untouched network(s) carried verbatim");
        Assert.True(carried > 0, $"{fixture}: nothing was carried — the splice did not engage at all");
    }

    /// <summary>A network that WAS edited is regenerated, so the splice cannot be hiding an edit by carrying it.
    /// <para>Without this, "everything is byte-identical" would pass for a splice that carried the whole body and
    /// never wrote the engineer's change — the failure mode of a carry keyed on anything looser than equality.</para></summary>
    [Theory]
    [MemberData(nameof(MultiNetworkBodies))]
    public void The_edited_network_really_is_rewritten(string fixture, string path)
    {
        var doc = XDocument.Load(path);
        var stored = doc.Descendants().First(e => e.Name.LocalName is "FBD" or "LD");
        var lang = stored.Name.LocalName;
        var body = stored.Parent!;

        var nets = Networks(NetworkCode.RenderBody(stored));
        var lastIdx = nets.Length - 1;
        var editedLast = nets[lastIdx].Replace(":=", "_edited :=");
        if (editedLast == nets[lastIdx]) return;

        BodyCodec.For(lang).Encode(body, string.Concat(nets.Take(lastIdx)) + editedLast, declaration: null);

        var after = body.Elements().First(e => e.Name.LocalName == lang);
        Assert.Contains("_edited", NetworkCode.RenderBody(after));
    }
}
