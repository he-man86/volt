using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Xunit;
using Xunit.Abstractions;
using Volt.Engine.Format.Network;

namespace Volt.Cli.Tests;

/// <summary>
/// Everything a ladder network declares must be WRITTEN, and every connection must land somewhere.
///
/// <para><c>WriteLadderBody</c> emits a coil and then pulls its spine in through <c>EmitPower</c>/<c>EmitData</c>;
/// its own comment says "InVar and Block are pulled by EmitPower/EmitData — never emitted at the rung top level".
/// So the reachable set is whatever a COIL reaches, and there is no throwing default arm for the rest. Two things
/// fall outside it: the condition spine of a conditional JMP/RETURN, and a block no <c>OutVar</c> consumes.</para>
///
/// <para>Neither failure is visible to <c>NetworkCode.Validate</c>. Its gates compare a round-trip through TEXT,
/// and an idempotent loss reads as identical both times — the same blind spot that hid the FB-type and
/// property-accessor bugs. So the assertions here are STRUCTURAL, made against the written XML: they ask whether
/// the document is internally consistent, which is the question the text can never answer.</para>
/// </summary>
public class LadderCompletenessTests
{
    private readonly ITestOutputHelper _out;
    public LadderCompletenessTests(ITestOutputHelper o) => _out = o;

    private static XElement Write(string text) => GraphWriter.WriteBody(NetworkCode.Validate(text), _ => "TON");

    /// <summary>Every <c>refLocalId</c> in the body must name an element that was actually emitted.
    /// <para>A dangling reference is not a cosmetic defect: Volt's own reader tolerates it (<c>CombineIn</c> misses
    /// in <c>byId</c> and yields nothing), so the body silently DEGRADES on the next read — a conditional jump
    /// becomes unconditional, and an unconditional RETURN dead-codes every rung after it on a live PLC.</para></summary>
    private void AssertNoDanglingRefs(XElement body, string what)
    {
        var ids = body.DescendantsAndSelf()
            .Select(e => e.Attribute("localId")?.Value).Where(v => v != null).ToHashSet();
        var refs = body.Descendants()
            .Select(e => e.Attribute("refLocalId")?.Value).Where(v => v != null).ToList();
        _out.WriteLine($"{what}: {ids.Count} emitted ids, {refs.Count} refs");
        var dangling = refs.Where(r => !ids.Contains(r)).ToList();
        Assert.True(dangling.Count == 0,
            $"{what}: {dangling.Count} connection(s) point at element(s) that were never written " +
            $"({string.Join(", ", dangling)}) — the reader will silently drop what they carried");
    }

    /// <summary>A CONDITIONAL jump keeps its condition.
    /// <para><c>IF a THEN JMP done; END_IF</c> is the canonical text a pull produces from a real conditional
    /// rung — and the canonicalizer steers you into it: the alternative spelling
    /// <c>LET i1 := a; IF i1 THEN JMP done; END_IF</c> is refused as NETWORK_NOT_CANONICAL with a message telling
    /// you to paste this exact form.</para></summary>
    [Fact]
    public void A_conditional_jump_writes_the_element_its_condition_hangs_off()
    {
        var body = Write("NETWORK 0 LD\n  IF a THEN JMP done; END_IF\nEND_NETWORK");
        AssertNoDanglingRefs(body, "conditional JMP");
    }

    /// <summary>Same for a conditional RETURN, where the consequence is worse: read back as UNconditional, it
    /// dead-codes every rung after it.</summary>
    [Fact]
    public void A_conditional_return_writes_the_element_its_condition_hangs_off()
    {
        var body = Write("NETWORK 0 LD\n  IF a THEN RETURN; END_IF\nEND_NETWORK");
        AssertNoDanglingRefs(body, "conditional RETURN");
    }

    /// <summary>A block nothing consumes is still part of the program.
    /// <para>An FB call made for its side effects — a timer stepped, a counter driven — has no <c>OutVar</c>
    /// taking its output. Reachability-from-a-coil deletes it outright: measured, the written <c>&lt;LD&gt;</c>
    /// was leftPowerRail + networktitle + rightPowerRail and nothing else. <c>Validate</c> accepts, and
    /// <c>GraphSplice.SafeToDrop</c> lists "block", so the splice removes the stored one without complaint — the
    /// FB call vanishes from the running program on a push that reports success.</para></summary>
    [Fact]
    public void A_block_no_outvar_consumes_is_still_written()
    {
        const string text = "NETWORK 0 LD\n  tmr(IN := a, PT := T#5S);\nEND_NETWORK";
        var body = Write(text);
        _out.WriteLine(body.ToString());

        var blocks = body.Descendants().Where(e => e.Name.LocalName == "block").ToList();
        Assert.True(blocks.Count > 0,
            "the FB call was deleted on write — nothing consumes its output, so nothing pulled it in, and the " +
            "push reports success while the call disappears from the PLC");
        AssertNoDanglingRefs(body, "unconsumed block");
    }
}
