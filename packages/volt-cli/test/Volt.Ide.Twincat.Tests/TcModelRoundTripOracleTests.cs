using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// THE MODEL ROUND-TRIP ORACLE over the TwinCAT archive fixtures (task 2.2): every <c>&lt;NWL&gt;</c> body in
/// <c>fixtures/tc-pou</c>, read with the production <see cref="TcNetworkReader"/> — the vendor-read model a pull
/// hands the writer — must round-trip through network text v2 or be refused by name
/// (<see cref="NextModelOracle"/>). The engine suite runs the same oracle over the v1 tests and the LSP corpus;
/// this half lives here because only this suite can reach <see cref="TcNetworkReader"/>.
///
/// <para>Every archive is swept, not listed, so a fixture added later is in the oracle by being added. The
/// refusal table is pinned by reason: a count moving means v2 learned or lost a spelling, or the reader started
/// filling a fact (task 3.10 fills the output slots), and must be read, never re-pinned blind.</para>
/// </summary>
public class TcModelRoundTripOracleTests
{
    static readonly Lazy<(Dictionary<string, NetworkBody> Read, Dictionary<string, string> ReaderRefused)> Archives = new(Harvest);

    static (Dictionary<string, NetworkBody>, Dictionary<string, string>) Harvest()
    {
        var read = new Dictionary<string, NetworkBody>(StringComparer.Ordinal);
        var refused = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var file in Directory.EnumerateFiles(Fixtures.PouDir(), "*.TcPOU").OrderBy(f => f, StringComparer.Ordinal))
        {
            var doc = XDocument.Load(file, LoadOptions.PreserveWhitespace);
            var n = 0;
            foreach (var nwl in doc.Descendants("NWL"))
            {
                var impl = nwl.DescendantsAndSelf("o").First(o => (string?)o.Attribute("t") == "NWLImplementationObject");
                var language = string.Equals(TcArchive.ViewMode(impl), "Ld", StringComparison.OrdinalIgnoreCase)
                    ? BodyLanguage.Ld
                    : BodyLanguage.Fbd;
                var id = $"{Path.GetFileName(file)}#{n++}";
                // The v1 driver's own refusals (a pin flag, an unreadable Execute box) are the marker already — the
                // body never reaches a writer, v1 or v2. Counted, so a fixture silently lost here is seen.
                try { read[id] = TcNetworkReader.Read(impl, language); }
                catch (UnrepresentableBodyException e) { refused[id] = e.Marker; }
            }
        }
        return (read, refused);
    }

    public static TheoryData<string> Ids()
    {
        var d = new TheoryData<string>();
        foreach (var k in Archives.Value.Read.Keys) d.Add(k);
        return d;
    }

    [Theory]
    [MemberData(nameof(Ids))]
    public void Every_archive_body_round_trips_or_is_refused_by_name(string id) =>
        NextModelOracle.Check(id, Archives.Value.Read[id]);

    [Fact]
    public void Archive_tally()
    {
        // The fixture that exists to hold an Execute box whose ST cannot be read (TcExecuteBoxTests): the
        // driver's marker, before any writer.
        Assert.Equal(new Dictionary<string, string> { ["ExecuteBox.derived.TcPOU#0"] = "EXECUTE" }, Archives.Value.ReaderRefused);
        NextModelOracle.AssertTally("TwinCAT archives",
            Archives.Value.Read.Select(kv => NextModelOracle.Check(kv.Key, kv.Value)),
            bodies: 13, networks: 21, refused: new Dictionary<string, int>
            {
                // The rung drawn by hand to hold a coil and a jump on one assign (UnspellableCoilTests): marker-only.
                ["a rung driving a coil and a jump together"] = 1,
            });
    }
}
