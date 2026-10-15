using System.Collections.Generic;
using Volt.Tests.Shared;
using Xunit;
using static Volt.Tests.Shared.NwlArchive;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// THE COMPLETENESS ORACLE'S OWN MACHINERY (openspec <c>ld-fbd-coverage</c> 1b.3): a comparison that cannot fail is no
/// oracle, so each verdict it promises is shown failing here — an unlisted member by name, a known loss that moved or
/// went stale, a member the rebuild did not write, a cache that is skipped.
/// </summary>
public class NwlCompletenessHarnessTests
{
    static ArchiveNode Operand(string text, params (string Member, object? Value)[] extra)
    {
        var o = new ArchiveNode("Operand").Set("Operand", S(text));
        foreach (var (m, v) in extra) o.Set(m, v);
        return o;
    }

    [Fact]
    public void A_member_the_table_does_not_name_fails_by_name()
    {
        var stored = Operand("a", ("FutureMember", B(true)));

        Assert.Contains("Operand.FutureMember", NwlCompare.Unlisted(stored));
        var f = Assert.Single(NwlCompare.Node(stored, Operand("a"), "n"), x => x.Kind == "unlisted");
        Assert.Equal("Operand.FutureMember", f.Key);
    }

    [Fact]
    public void A_member_the_rebuild_did_not_write_is_a_finding_and_a_cache_is_not()
    {
        var stored = new ArchiveNode("TextDocument").Set("LineInfoPersistence", null).Set("api.Text", S("x := 1;"));
        var written = new ArchiveNode("TextDocument");

        var f = Assert.Single(NwlCompare.Node(stored, written, "d"));
        Assert.Equal(("TextDocument.api.Text", "not written"), (f.Key, f.Kind));
    }

    [Fact]
    public void A_value_node_is_keyed_by_where_it_sits()
    {
        var stored = new ArchiveNode("BoxTreeBox").Set("Instance", Operand("t1", ("IsInstance", B(true))));
        var written = new ArchiveNode("BoxTreeBox").Set("Instance", Operand("t1", ("IsInstance", B(false))));

        var f = Assert.Single(NwlCompare.Node(stored, written, "b"));
        Assert.Equal("Operand.IsInstance in BoxTreeBox.Instance — changed", f.Ledger);
    }

    [Fact]
    public void A_refusable_member_off_its_default_on_a_compared_network_is_a_finding()
    {
        var stored = new ArchiveNode("Network").Set("Connectors", new ArchiveList(new object?[] { Operand("c") }));

        Assert.Equal(new[] { "Network.Connectors" }, NwlCompare.RefusableX(stored));
        Assert.Contains(NwlCompare.Node(stored, new ArchiveNode("Network"), "n"), x => x.Kind == "present and not refused");
    }

    static List<(string, List<NwlFinding>)> OneFinding() =>
        new() { ("net", new List<NwlFinding> { new("Operand.Type", "Operand", "changed", "net.Type", S("BOOL"), S("")) }) };

    [Fact]
    public void The_ledger_fails_an_unexpected_a_moved_and_a_stale_entry()
    {
        NwlLedger.AssertExactly("v", OneFinding(), new[] { new NwlKnown("Operand.Type — changed", 1, 1, "t") });

        Assert.Contains("UNEXPECTED", Assert.ThrowsAny<Xunit.Sdk.XunitException>(
            () => NwlLedger.AssertExactly("v", OneFinding(), new NwlKnown[0])).Message);
        Assert.Contains("MOVED", Assert.ThrowsAny<Xunit.Sdk.XunitException>(
            () => NwlLedger.AssertExactly("v", OneFinding(), new[] { new NwlKnown("Operand.Type — changed", 1, 2, "t") })).Message);
        Assert.Contains("STALE", Assert.ThrowsAny<Xunit.Sdk.XunitException>(
            () => NwlLedger.AssertExactly("v", OneFinding(), new[]
            {
                new NwlKnown("Operand.Type — changed", 1, 1, "t"), new NwlKnown("Operand.Boolean — not written", 1, 1, "t"),
            })).Message);
    }
}
