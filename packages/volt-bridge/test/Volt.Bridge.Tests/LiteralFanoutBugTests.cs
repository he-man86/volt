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
    public void Canonical_output_never_emits_a_fanout_leaf_so_the_guard_is_a_backstop()
    {
        // OLD form: a literal leaf fanning out re-emitted IDENTICALLY (a text fixed point), so ONLY an explicit
        // guard caught it — it passed one check and crashed another. READABLE form: the writer inlines a leaf
        // into each consumer, so a fan-out leaf becomes SEPARATE boxes (the valid FBD shape). Canonical output
        // therefore can never contain it — the guard (below) is now just a backstop for hand-authored VG.
        Assert.NotEqual(LiteralFanout.Trim(), VgWriter.Write(VgParser.Parse(LiteralFanout)).Trim());
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
        // g1 (a gate) feeding BOTH consumers is a real FBD branch — TwinCAT supports it (this is the fbd_branch
        // the user drew). It stays NAMED in the readable form (fan-out), and the leaf-fan-out guard must NOT
        // refuse it. Round-trip a rough body to the canonical form first so it passes the convergence invariant.
        var branch = VgWriter.Write(VgParser.Parse(
            "NETWORK 0 FBD\n  VAR_TEMP\n    g1 : BOOL;\n  END_VAR\n" +
            "  g1 := (a AND b);\n  outpur := (g1 OR c);\n  np := (g1 OR d);\nEND_NETWORK\n"));
        GraphicalCode.Validate(branch);   // must not throw
    }
}
