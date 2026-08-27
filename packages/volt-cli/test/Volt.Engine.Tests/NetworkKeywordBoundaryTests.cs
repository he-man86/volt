using Xunit;
using Xunit.Abstractions;
using Volt.Engine.Source.Body.Network;

namespace Volt.Cli.Tests;

/// <summary>
/// `NETWORK` opens a network only when it is the WHOLE keyword, not merely a prefix.
///
/// <para>The reader tested <c>line.StartsWith("NETWORK")</c>, so a statement whose l-value begins with those
/// seven letters — <c>NETWORK_OK := TRUE;</c>, and `NETWORK_OK`/`NETWORK_ERR` are ordinary PLC identifiers —
/// was read as a network HEADER. Inside an open network that means "a network is not closed by END_NETWORK",
/// which aborts the whole push with a diagnostic pointing at a line that is not the problem.</para>
/// </summary>
public class NetworkKeywordBoundaryTests
{
    private readonly ITestOutputHelper _out;
    public NetworkKeywordBoundaryTests(ITestOutputHelper o) => _out = o;

    /// <summary>An identifier that merely STARTS with the keyword is a statement.</summary>
    [Theory]
    [InlineData("NETWORK_OK")]
    [InlineData("NETWORK_ERR")]
    [InlineData("NETWORKSTATE")]
    public void An_identifier_beginning_with_NETWORK_is_not_a_network_header(string lvalue)
    {
        var text = $"NETWORK 0 FBD\n  {lvalue} := (a AND b);\nEND_NETWORK";

        var ex = Record.Exception(() => NetworkCode.Validate(text));
        Assert.True(ex is null,
            $"'{lvalue}' is an ordinary identifier, but the reader took it for a network header and refused the " +
            $"whole push: {ex?.Message}");

        var graph = NetworkCode.Validate(text);
        Assert.Single(graph.Networks);            // ONE network, not two
        _out.WriteLine($"{lvalue}: {graph.Networks.Count} network(s)");
    }

    /// <summary>And a real header still opens one — so the fix is a boundary, not a weakening.</summary>
    [Fact]
    public void A_real_NETWORK_header_still_opens_a_network()
    {
        var graph = NetworkCode.Validate("NETWORK 0 FBD\n  out := a;\nEND_NETWORK\nNETWORK 1 FBD\n  out2 := b;\nEND_NETWORK");
        Assert.Equal(2, graph.Networks.Count);
    }
}
