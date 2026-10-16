using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Engine.Tests.Format.Network;

/// <summary>
/// THE SHARED CASE SET, ON THE BRIDGE'S SIDE (openspec <c>ld-fbd-coverage</c> 2R.3; <see cref="NetworkTextCases"/>): every
/// accept case reads — through the push's own gate — to its stated model and writes back to its canonical text; every
/// refuse case is refused by the gate under its code, with its phrase. The LSP reads the same files
/// (<c>network-cases.test.ts</c>), so a case the two sides judge differently fails both suites.
/// </summary>
public class NetworkTextCaseTests
{
    public static IEnumerable<object[]> Accepted() =>
        NetworkTextCases.All().Where(c => c.Accept).Select(c => new object[] { c.ToString() });

    public static IEnumerable<object[]> Refused() =>
        NetworkTextCases.All().Where(c => !c.Accept).Select(c => new object[] { c.ToString() });

    private static NetworkTextCase Case(string id) => NetworkTextCases.All().Single(c => c.ToString() == id);

    [Theory]
    [MemberData(nameof(Accepted))]
    public void An_accepted_case_reads_to_its_model_and_writes_back_its_canonical_text(string id)
    {
        var c = Case(id);
        var scope = c.ScopeOf();
        var gate = NetworkTextGate.Validate(c.Text, scope);
        Assert.True(gate.Ok, $"{c}: refused —\n" + string.Join("\n", gate.Diagnostics.Select(d => $"{d.Line}:{d.Column} {d.Code} {d.Message}")));
        Assert.Equal(NetworkModelDump.Normalized(c.Model!), NetworkModelDump.Normalized(NetworkModelDump.Of(gate.Body!)));
        Assert.Equal(c.Canonical ?? c.Text, gate.Canonical);
    }

    [Theory]
    [MemberData(nameof(Refused))]
    public void A_refused_case_is_refused_by_name(string id)
    {
        var c = Case(id);
        var gate = NetworkTextGate.Validate(c.Text, c.ScopeOf());
        Assert.False(gate.Ok, $"{c}: accepted, and it reads to\n{(gate.Body is null ? "" : NetworkModelDump.Of(gate.Body))}");
        Assert.True(gate.Diagnostics.Any(d => d.Code == c.RefusedCode &&
                                              (c.RefusedPhrase is null || d.Message.IndexOf(c.RefusedPhrase, StringComparison.OrdinalIgnoreCase) >= 0)),
            $"{c}: expected {c.RefusedCode} '{c.RefusedPhrase}', got\n" +
            string.Join("\n", gate.Diagnostics.Select(d => $"{d.Line}:{d.Column} {d.Code} {d.Message}")));
    }

    /// <summary>The set covers the grammar: both sides of every rule group it names.</summary>
    [Fact]
    public void The_case_set_is_there()
    {
        var all = NetworkTextCases.All();
        Assert.True(all.Count(c => c.Accept) >= 60, $"{all.Count(c => c.Accept)} accept cases");
        Assert.True(all.Count(c => !c.Accept) >= 60, $"{all.Count(c => !c.Accept)} refuse cases");
    }
}
