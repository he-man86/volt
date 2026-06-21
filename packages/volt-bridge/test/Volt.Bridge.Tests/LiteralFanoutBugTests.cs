using Volt.Bridge.Core.Graphical;
using Volt.Bridge.Core.Graphical.Vg;
using Xunit;

namespace Volt.Bridge.Tests;

// A LITERAL leaf fanning out to two blocks re-emits identically through the VG-text round-trip gate, so it
// would slip through to the PLCopen writer and crash TwinCAT's importer ("Index was outside the bounds of the
// array" / "key not present in the dictionary") — a hidden bug that passes one check and crashes another. The
// leaf-fan-out guard refuses it cleanly. A BLOCK-output branch (the real fbd_branch shape) stays allowed.
public class LiteralFanoutBugTests
{
    private const string LiteralFanout =
        "NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    i3 : BOOL;\n" +
        "    g1 : BOOL;\n    g2 : BOOL;\n    g3 : BOOL;\n  END_VAR\n" +
        "  i1 := TRUE;\n  i2 := FALSE;\n  i3 := FALSE;\n" +
        "  g1 := (i1 AND i2);\n  g2 := (g1 OR i3);\n  g3 := (g2 AND i3);\n" +
        "  np := g2;\n  outpur := NOT g3;\nEND_NETWORK\n";

    [Fact]
    public void The_VG_text_gate_alone_accepts_it_which_is_why_an_explicit_guard_is_needed()
    {
        // It re-emits identically as VG text, so the round-trip gate alone would let it through — the trap.
        var graph = VgParser.Parse(LiteralFanout);
        Assert.Equal(LiteralFanout.Trim(), VgWriter.Write(graph).Trim());
    }

    [Fact]
    public void Validate_refuses_leaf_fanout_cleanly_instead_of_crashing_TwinCAT()
    {
        var ex = Assert.Throws<VgParseException>(() => GraphicalCode.Validate(LiteralFanout));
        Assert.Equal("VG_LEAF_FANOUT", ex.Code);
    }

    [Fact]
    public void Block_output_fanout_is_a_legitimate_branch_and_stays_accepted()
    {
        // g1 (a gate) feeding BOTH g2 and g3 is a real FBD branch — TwinCAT supports it (this is the fbd_branch
        // the user drew). The leaf-fan-out guard must NOT refuse it.
        const string branch =
            "NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    i3 : BOOL;\n    i4 : BOOL;\n" +
            "    g1 : BOOL;\n    g2 : BOOL;\n    g3 : BOOL;\n  END_VAR\n" +
            "  i1 := TRUE;\n  i2 := FALSE;\n  i3 := FALSE;\n  i4 := TRUE;\n" +
            "  g1 := (i1 AND i2);\n  g2 := (g1 OR i3);\n  g3 := (g1 OR i4);\n" +
            "  outpur := NOT g2;\n  np := g3;\nEND_NETWORK\n";
        GraphicalCode.Validate(branch);   // must not throw
    }
}
