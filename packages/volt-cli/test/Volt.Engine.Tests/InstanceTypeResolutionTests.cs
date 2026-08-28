using System.Linq;
using System.Xml.Linq;
using Xunit;
using Xunit.Abstractions;
using Volt.Engine.Format.Network;
using Volt.Engine.PlcOpen;

namespace Volt.Cli.Tests;

/// <summary>
/// An FB instance's TYPE is the one thing a graphical body carries that its network text does not.
///
/// <para>A PLCopen <c>&lt;block&gt;</c> holds <c>typeName</c> and <c>instanceName</c> as attributes; the workspace
/// text names only the instance — <c>fbUp(CLK := a)</c>. So on write the type has to come back from somewhere,
/// and the only place it exists is the POU's DECLARATION. That is why an FB instance is special, and nothing else
/// is: an operator or a function call carries its own name in the text, so it needs no lookup at all.</para>
///
/// <para>The recovery is a regex — <c>(\w+)\s*:\s*([\w\.]+)\s*;</c> — which matches exactly
/// <c>name : TYPE ;</c> and nothing else. These tests are the measurement of what "nothing else" costs, because
/// a miss does not fail: <c>GraphWriter</c> writes <c>typeName=""</c> and the push is ACCEPTED.</para>
/// </summary>
public class InstanceTypeResolutionTests
{
    private readonly ITestOutputHelper _out;
    public InstanceTypeResolutionTests(ITestOutputHelper o) => _out = o;

    /// <summary>Ordinary IEC declaration forms an engineer writes without thinking. Every one of these declares
    /// an FB instance; the question is only whether the resolver can see it.</summary>
    [Theory]
    [InlineData("single", "VAR\n\ttmr : TON;\nEND_VAR", "tmr", "TON")]
    [InlineData("comma-list", "VAR\n\tfbUp, fbDown : R_TRIG;\nEND_VAR", "fbUp", "R_TRIG")]
    [InlineData("initializer", "VAR\n\ttmr : TON := (PT := T#5S);\nEND_VAR", "tmr", "TON")]
    [InlineData("array", "VAR\n\ttmrs : ARRAY[1..3] OF TON;\nEND_VAR", "tmrs", "TON")]
    [InlineData("address-bound", "VAR\n\ttrg AT %I* : R_TRIG;\nEND_VAR", "trg", "R_TRIG")]
    public void An_FB_instance_declared_the_ordinary_ways_resolves(string label, string decl, string inst, string type)
    {
        var map = InstanceTypes.Of(decl);
        _out.WriteLine($"{label}: {{{string.Join(", ", map.Select(kv => kv.Key + "=" + kv.Value))}}}");
        Assert.True(map.TryGetValue(inst, out var got),
            $"[{label}] '{inst}' is declared but the resolver did not see it — its box will be written with typeName=\"\"");
        Assert.Equal(type, got);
    }

    /// <summary>The SECOND declarator of a comma-list, which is the case most likely to be hit in the wild:
    /// a rising/falling pair is the canonical reason to write one.</summary>
    [Fact]
    public void Both_declarators_of_a_comma_list_resolve()
    {
        var map = InstanceTypes.Of("VAR\n\tfbUp, fbDown : R_TRIG;\nEND_VAR");
        Assert.Equal("R_TRIG", map.GetValueOrDefault("fbUp"));
        Assert.Equal("R_TRIG", map.GetValueOrDefault("fbDown"));
    }

    /// <summary>And the consequence, which is the finding rather than the parsing trivia: an unresolved
    /// instance must FAIL, not be written as <c>typeName=""</c>.
    /// <para><c>GraphWriter</c> did <c>resolveType(inst) ?? ""</c>. The export it replaces CARRIED the type, so
    /// an empty one destroys it — and the push reports success. Nothing downstream can catch that: network text
    /// never mentions FB types, so both of <c>NetworkCode.Validate</c>'s gates see an identical round-trip
    /// whether the type survived or not. The validation is blind to precisely the thing being lost, which is why
    /// it has to fail here or nowhere.</para>
    /// <para>Driven from the RECORDED TwinCAT ladder rather than hand-written network text: a real
    /// <c>&lt;block typeName="TON" instanceName="T1"&gt;</c> read by Volt's own reader, so the canonical form is
    /// whatever the product actually produces and the test cannot be wrong about its input. An earlier draft did
    /// invent the text, and failed on canonicalisation instead of on the bug.</para></summary>
    [Fact]
    public void An_unresolvable_FB_instance_fails_instead_of_writing_an_empty_typeName()
    {
        var graph = NetworkCode.Validate(NetworkCode.RenderBody(RecordedLadder()));

        var ex = Assert.Throws<InvalidOperationException>(() => GraphWriter.WriteBody(graph, _ => null));
        Assert.Contains("T1", ex.Message);                       // names the instance the engineer must look at
        Assert.Contains("VAR block", ex.Message);                // and says what to do about it
    }

    /// <summary>The body being replaced is the FIRST source, so an existing box needs no declaration at all.
    /// <para>This is what takes the ST parse off the critical path: editing a rung in a POU whose declaration the
    /// parser cannot read must still work, because the type is already in the element being replaced.</para></summary>
    [Fact]
    public void An_existing_box_takes_its_type_from_the_body_being_replaced()
    {
        var ld = RecordedLadder();
        var fromBody = InstanceTypes.FromBody(ld);
        Assert.Equal("TON", fromBody.GetValueOrDefault("T1"));

        // No declaration source at all — and it still writes the right type.
        var graph = NetworkCode.Validate(NetworkCode.RenderBody(ld));
        var body = GraphWriter.WriteBody(graph, inst => fromBody.GetValueOrDefault(inst));
        var block = body.Descendants().First(e => e.Name.LocalName == "block");
        Assert.Equal("TON", block.Attribute("typeName")?.Value);
    }

    /// <summary>A real recorded TwinCAT ladder containing an FB box.</summary>
    private static XElement RecordedLadder()
    {
        var xml = System.IO.File.ReadAllText(System.IO.Path.Combine(
            System.AppContext.BaseDirectory, "fixtures", "tc-ld", "ld_ton_rung_two_networks.plcopen.xml"));
        var ld = XDocument.Parse(xml).Descendants().First(e => e.Name.LocalName == "LD");
        Assert.Contains(ld.Descendants(), e => e.Name.LocalName == "block");   // the fixture really has one
        return ld;
    }
}
