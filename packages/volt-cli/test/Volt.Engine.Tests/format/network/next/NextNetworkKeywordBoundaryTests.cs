using System.Linq;
using Xunit;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.Network.Next;

namespace Volt.Engine.Tests;

/// <summary>
/// Task 2.7, the v2 form of <see cref="NetworkKeywordBoundaryTests"/> (which the swap, 3.7, replaces with this):
/// the words of the header mean what they say only where the header is.
/// <list type="bullet">
/// <item><c>NETWORK</c> opens a network only as the WHOLE word at a line start — <c>NETWORK_OK := …</c> is a
/// statement (the v1 regression this file's twin pins).</item>
/// <item>The header ENDS at its newline: a statement on the next line that starts <c>DISABLED :=</c>,
/// <c>TITLE :=</c> or <c>LABEL :=</c> is an assignment to a variable of that name, never a header field.</item>
/// <item>A <c>//</c> comment ends at its newline: the statement on the next line is a statement.</item>
/// <item>Header fields in another order are <c>NETWORK_NOT_CANONICAL</c>.</item>
/// </list>
/// </summary>
public class NextNetworkKeywordBoundaryTests
{
    const string Fbd = "(* @volt-implementation FBD *)\n";

    static NetworkBody Read(string text)
    {
        var r = NextNetworkTextReader.Read(text, BodyLanguage.Fbd, NextNetworkScope.Empty);
        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => $"{d.Line}:{d.Column} {d.Code} {d.Message}")));
        return r.Body!;
    }

    [Theory]
    [InlineData("NETWORK_OK")]
    [InlineData("NETWORK_ERR")]
    [InlineData("NETWORKSTATE")]
    public void An_identifier_beginning_with_NETWORK_is_not_a_network_header(string lvalue)
    {
        var body = Read(Fbd + $"NETWORK\n  {lvalue} := (a AND b);\nEND_NETWORK\n");
        var assign = Assert.IsType<Assign>(Assert.Single(Assert.Single(body.Networks).Trees));
        Assert.Equal(lvalue, assign.Targets.Single().Text);
    }

    [Fact]
    public void A_real_NETWORK_header_still_opens_a_network() =>
        Assert.Equal(2, Read(Fbd + "NETWORK\n  out := a;\nEND_NETWORK\nNETWORK\n  out2 := b;\nEND_NETWORK\n").Networks.Count);

    /// <summary>Spec, "a variable named like a header field": the header ends at its newline.</summary>
    [Theory]
    [InlineData("DISABLED")]
    [InlineData("TITLE")]
    [InlineData("LABEL")]
    public void A_statement_after_the_header_that_starts_with_a_header_word_is_a_statement(string word)
    {
        var body = Read(Fbd + $"NETWORK\n  {word} := x;\nEND_NETWORK\n");
        var net = Assert.Single(body.Networks);
        Assert.Equal(word, Assert.IsType<Assign>(Assert.Single(net.Trees)).Targets.Single().Text);
        Assert.Equal((null, null, false), (net.Title, net.Label, net.Disabled));
        // …and the gate takes it as written: it is the canonical form.
        Assert.True(NextNetworkTextGate.Validate(Fbd + $"NETWORK\n  {word} := x;\nEND_NETWORK\n", BodyLanguage.Fbd, NextNetworkScope.Empty).Ok);
    }

    /// <summary>The same word ON the header line is the field: position decides, not the word.</summary>
    [Fact]
    public void The_same_words_on_the_header_line_are_its_fields()
    {
        var net = Read(Fbd + "NETWORK LABEL: Done TITLE: \"t\" DISABLED\n  TITLE := x;\nEND_NETWORK\n").Networks.Single();
        Assert.Equal(("t", "Done", true), (net.Title, net.Label, net.Disabled));
        Assert.Equal("TITLE", Assert.IsType<Assign>(Assert.Single(net.Trees)).Targets.Single().Text);
    }

    /// <summary>A <c>//</c> comment line ends at its newline, even when the next line looks like more of it.</summary>
    [Fact]
    public void A_comment_ends_at_its_newline()
    {
        var net = Read(Fbd + "NETWORK\n  // holds the drive off\n  DISABLED := x;\nEND_NETWORK\n").Networks.Single();
        Assert.Equal("holds the drive off", net.Comment);
        Assert.False(net.Disabled);
        Assert.Equal("DISABLED", Assert.IsType<Assign>(Assert.Single(net.Trees)).Targets.Single().Text);
    }

    [Theory]
    [InlineData("NETWORK TITLE: \"t\" LABEL: Done")]
    [InlineData("NETWORK DISABLED LABEL: Done")]
    [InlineData("NETWORK DISABLED TITLE: \"t\"")]
    public void Header_fields_out_of_order_are_not_canonical(string header)
    {
        var r = NextNetworkTextGate.Validate(Fbd + header + "\n  ;\nEND_NETWORK\n", BodyLanguage.Fbd, NextNetworkScope.Empty);
        Assert.Equal("NETWORK_NOT_CANONICAL", Assert.Single(r.Diagnostics).Code);
    }
}
