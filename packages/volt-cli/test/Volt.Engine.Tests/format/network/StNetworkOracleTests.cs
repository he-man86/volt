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
        StNetworkOracle.AssertTally(results, report, identical: 68, stored: 23, new Dictionary<string, int>(StringComparer.Ordinal)
        {
            // The hand-written cases only; every one is a 3.0 spelling (design.md "Open for the owner" and the probe's accept-case gaps).
            ["a Parallel with a side effect on a branch"] = 2,
            ["a box showing ENO without EN"] = 2,
            ["a box type that is no call head"] = 1,        // an operator box typed 'and' (lower case)
            ["a coil modifier on a jump"] = 1,
            ["a jump inside a tree"] = 1,
            ["a jump with several targets"] = 2,
            ["a second unnamed output"] = 2,
            ["a target that is no ST variable"] = 3,     // a coil on `s` or `r`, which CODESYS ST takes for no name (1.2)
            ["a variable on the ENO of an enabled function"] = 1,
            ["a wire read before its definition"] = 1,
            ["a wire read fewer than twice"] = 6,           // a Demux read once (design: no spelling)
            ["an FB box with no instance"] = 1,
            ["an FB instance the scope does not declare"] = 1,
            ["an edge contact"] = 1,
            ["an edge on a box output"] = 2,
            ["an edge on a pin"] = 2,
            ["an empty item"] = 2,
            ["an enabled box without ENO"] = 2,
            ["an operand named like an ST keyword"] = 4,   // `s` / `r` (1.2: no name in CODESYS ST), and one more
            ["an operand that is no ST expression"] = 1,
        });
    }
}
