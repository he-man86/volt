using System;
using System.IO;
using System.Linq;
using VoltBridge.Core.Fbd;
using Xunit;

namespace VoltBridge.Core.Tests;

/// <summary>
/// Ground-truth tests over real TwinCAT <c>.TcPOU</c> FBD bodies captured live from TcXaeShell
/// (fixtures/tc-fbd/). These lock in the FBD→ST transpile so it stays correct without a live
/// bridge. Pin names come straight from the serialized BoxTree (authoritative), so the resolver
/// here is a no-op — proving we no longer depend on resolving library-FB declarations.
/// </summary>
public class FbdCorpusTests
{
    private static readonly string FixtureDir =
        Path.Combine(AppContext.BaseDirectory, "fixtures", "tc-fbd");

    private static (System.Collections.Generic.IReadOnlyList<string>, System.Collections.Generic.IReadOnlyList<string>)? NoResolver(string _) => null;

    private static string St(string fixture, string member)
    {
        var xml = File.ReadAllText(Path.Combine(FixtureDir, fixture + ".TcPOU"));
        var gb = TcPouReader.ReadGraphicalBody(xml, member, NoResolver);
        Assert.NotNull(gb);
        return gb!.Body;
    }

    [Fact]
    public void PLC_PRG_action_transpiles_BoxTreeAssign_networks()
    {
        // Three var := (a OP b) assignment networks — the BoxTreeAssign form the old reader
        // turned into "xtest := ()". Now correct.
        Assert.Equal(
            "xtest := (FALSE AND TRUE);\n" +
            "xtest1 := (TRUE AND TRUE);\n" +
            "xtest3 := (FALSE OR TRUE);\n",
            St("PLC_PRG", "ACT_FBD"));
    }

    [Fact]
    public void TON_uses_authoritative_pin_names_from_the_box()
    {
        // Library FB (not in the project): IN/PT come from the serialized box, not a declaration.
        Assert.Equal("tmr(IN := TRUE, PT := T#500MS);\n",
            St("FB_LANG_fbd_ton_timer", "FB_LANG_fbd_ton_timer"));
    }

    [Fact]
    public void F_TRIG_uses_authoritative_pin_names()
    {
        Assert.Equal("ed(CLK := TRUE);\n",
            St("FB_LANG_fbd_f_trig_edge", "FB_LANG_fbd_f_trig_edge"));
    }

    [Fact]
    public void Block_output_assigned_to_outvar()
    {
        Assert.Equal("result := (TRUE AND FALSE);\n",
            St("FB_LANG_fbd_block_to_outvar", "FB_LANG_fbd_block_to_outvar"));
    }

    // The LIVE path: the adapter passes ImplementationText (the in-memory <NWL> string) straight to
    // FromBodyXml — no file read, no PLCopen import/export. Prove that string-in path matches.
    [Fact]
    public void FromBodyXml_transpiles_the_in_memory_NWL_string()
    {
        var xml = File.ReadAllText(Path.Combine(FixtureDir, "PLC_PRG.TcPOU"));
        var nwl = TcPouReader.FindChildBody(xml, "ACT_FBD")!.ToString();   // what ImplementationText returns
        var gb = TcPouReader.FromBodyXml(nwl, NoResolver);
        Assert.NotNull(gb);
        Assert.Equal(
            "xtest := (FALSE AND TRUE);\n" +
            "xtest1 := (TRUE AND TRUE);\n" +
            "xtest3 := (FALSE OR TRUE);\n",
            gb!.Body);
    }

    [Fact]
    public void FromBodyXml_returns_null_for_textual_ST()
    {
        Assert.Null(TcPouReader.FromBodyXml("x := 1;", NoResolver));
        Assert.Null(TcPouReader.FromBodyXml("", NoResolver));
    }

    // Every fixture must transpile without throwing and must never leak raw XmlArchive markup
    // into the "ST" (the no-fallback invariant: a graphical body is transpiled, never dumped raw).
    [Theory]
    [InlineData("FB_LANG_fbd_add_int")]
    [InlineData("FB_LANG_fbd_assignment_output")]
    [InlineData("FB_LANG_fbd_block_to_outvar")]
    [InlineData("FB_LANG_fbd_box_and_two_inputs")]
    [InlineData("FB_LANG_fbd_chained_blocks")]
    [InlineData("FB_LANG_fbd_comparison_gt")]
    [InlineData("FB_LANG_fbd_ctu_counter")]
    [InlineData("FB_LANG_fbd_dangling_connection_ref")]
    [InlineData("FB_LANG_fbd_duplicate_local_id")]
    [InlineData("FB_LANG_fbd_empty_network")]
    [InlineData("FB_LANG_fbd_f_trig_edge")]
    [InlineData("FB_LANG_fbd_fanout_one_source")]
    [InlineData("FB_LANG_fbd_fb_instance_call")]
    [InlineData("FB_LANG_fbd_fb_undeclared_instance")]
    [InlineData("FB_LANG_fbd_jump_to_label")]
    [InlineData("FB_LANG_fbd_jump_to_missing_label")]
    [InlineData("FB_LANG_fbd_move_assignment")]
    [InlineData("FB_LANG_fbd_not_unary")]
    [InlineData("FB_LANG_fbd_or_two_inputs")]
    [InlineData("FB_LANG_fbd_orphan_block")]
    [InlineData("FB_LANG_fbd_return_statement")]
    [InlineData("FB_LANG_fbd_sr_flipflop")]
    [InlineData("FB_LANG_fbd_ton_timer")]
    [InlineData("FB_LANG_fbd_two_networks_stacked")]
    [InlineData("FB_LANG_fbd_var_input_output_sections")]
    [InlineData("FB_LANG_fbd_xor_two_inputs")]
    public void Fixture_transpiles_without_leaking_raw_xml(string name)
    {
        var st = St(name, name);
        foreach (var marker in new[] { "XmlArchive", "NWLImplementation", "BoxTree", "<o ", "<v ", "<l2" })
            Assert.DoesNotContain(marker, st);
        Assert.DoesNotContain(":= ()", st);   // the old BoxTreeAssign bug signature
    }
}
