using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Engine.Tests.Format.Network;

/// <summary>
/// The plain-ST round-trip oracle (openspec <c>network-text-st</c> 2.2; <see cref="StNetworkOracle"/>) over the shared
/// accept cases: each case's model (read by the v2 gate, which still reads the case set until 3.2 re-records it) → plain
/// ST → model. Every network lands in one bucket, no network is a gap, and the tally is pinned; a network the text does
/// not spell yet is its <c>%UNSUPPORTED</c> line, spelled by 3.0. <c>VOLT_ST_ORACLE_REPORT=&lt;dir&gt;</c> writes the report.
/// </summary>
public class StNetworkOracleTests
{
    [Fact]
    public void Every_accept_case_network_round_trips_or_is_unsupported_by_name()
    {
        var results = new List<StNetworkOracle.Result>();
        foreach (var c in NetworkTextCases.All().Where(c => c.Accept))
        {
            var scope = c.ScopeOf();
            var gate = NetworkTextGate.Validate(c.Text, scope);
            Assert.True(gate.Ok, $"{c}: the v2 gate refuses an accept case");
            var body = gate.Body!;
            for (var i = 0; i < body.Networks.Count; i++)
                results.Add(StNetworkOracle.Check("cases/" + c, i, body.Language, body.Networks[i], scope));
        }
        var report = StNetworkOracle.Report("accept cases", results);
        StNetworkOracle.Save("cases", report, results);
        StNetworkOracle.AssertTally(results, report, identical: 100, stored: 26, new Dictionary<string, int>(StringComparer.Ordinal)
        {
            // Volt's own v2 cases, 0 in the corpora and the TwinCAT archives. A name ST cannot write: niche, accepted loss
            // (owner, 2026-10-28; CODESYS ST refuses the names too).
            ["an operand named like an ST keyword"] = 1,   // `Then`
            ["an operand that is no ST expression"] = 1,   // `a``b`
            // `JMP Done S= c`: the IDE's jump element has no set or reset (a coil's modifier), a v2 grammar shape. Niche:
            // accepted loss (0 occurrences in the corpora); for the owner (design.md "3.0").
            ["a coil modifier on a jump"] = 1,
        });
    }
}
