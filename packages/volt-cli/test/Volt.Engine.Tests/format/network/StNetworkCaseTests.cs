using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Engine.Tests.Format.Network;

/// <summary>
/// THE PLAIN-ST CASE SET, ON THE BRIDGE'S SIDE (openspec <c>network-text-st</c>; <see cref="NetworkTextCases.Root"/>):
/// <c>test/fixtures/network-text-st/</c>. An accept case reads to its model and writes back its text; a refuse case is
/// refused by name. The LSP reads the same files (its network check, <c>src/analysis/checks/network/_plain-st.test.ts</c>):
/// a case the two sides judge differently fails both suites (design.md oracle 2).
/// </summary>
public class StNetworkCaseTests
{
    public static IEnumerable<object[]> Accepted() =>
        NetworkTextCases.All().Where(c => c.Accept).Select(c => new object[] { c.ToString() });

    public static IEnumerable<object[]> Refused() =>
        NetworkTextCases.All().Where(c => !c.Accept).Select(c => new object[] { c.ToString() });

    private static NetworkTextCase Case(string id) => NetworkTextCases.All().Single(c => c.ToString() == id);

    [Theory]
    [MemberData(nameof(Accepted))]
    public void An_accepted_case_reads_to_its_model_and_writes_back_its_text(string id)
    {
        var c = Case(id);
        var scope = c.ScopeOf();
        var body = StNetworkReader.Read(c.Text, scope);
        Assert.Equal(NetworkModelDump.Normalized(c.Model!), NetworkModelDump.Normalized(NetworkModelDump.Of(body)));
        Assert.Equal(c.Text, StNetworkWriter.WritePulled(body, scope));
    }

    [Theory]
    [MemberData(nameof(Refused))]
    public void A_refused_case_is_refused_by_name(string id)
    {
        var c = Case(id);
        var ex = Assert.Throws<StNetworkReadException>(() => StNetworkReader.Read(c.Text, c.ScopeOf()));
        Assert.True(c.RefusedPhrase is null || ex.Message.IndexOf(c.RefusedPhrase, StringComparison.OrdinalIgnoreCase) >= 0,
            $"{c}: expected '{c.RefusedPhrase}', got: {ex.Message}");
    }

    /// <summary>The set covers the reader: every v2 accept case, and a refusal for each rule of what a network holds.</summary>
    [Fact]
    public void The_case_set_is_there()
    {
        var all = NetworkTextCases.All();
        Assert.True(all.Count(c => c.Accept) >= 100, $"{all.Count(c => c.Accept)} accept cases");
        Assert.True(all.Count(c => !c.Accept) >= 25, $"{all.Count(c => !c.Accept)} refuse cases");
    }
}
