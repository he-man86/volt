using Volt.Bridge.Core.Graphical.Vg;
using Xunit;

namespace Volt.Bridge.Tests;

/// <summary>
/// The bridge OWNS the graphical format: every invalid structure must be REFUSED with a stable, specific
/// diagnostic code BEFORE it can reach the IDE (a malformed body crashes/corrupts the importer). This pins the
/// full set of structural refusals the parser makes, and — just as important — the valid shapes it must NOT
/// refuse (so the guards never over-fire on a canonical body).
/// </summary>
public class VgDiagnosticsTests
{
    [Theory]
    // ── network framing ───────────────────────────────────────────────────────────────
    [InlineData("NETWORK 0 FBD\n  out := a;\n", "VG_NETWORK_NOT_CLOSED")]                                   // no END_NETWORK at EOF
    [InlineData("NETWORK 0 FBD\n  out := a;\nNETWORK 1 FBD\n  z := b;\nEND_NETWORK\n", "VG_NETWORK_NOT_CLOSED")] // network 0 left open
    [InlineData("END_NETWORK\n", "VG_PARSE")]                                                                // close with nothing open
    [InlineData("  x := y;\n", "VG_PARSE")]                                                                  // statement before any NETWORK
    [InlineData("NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n  out := a;\nEND_NETWORK\n", "VG_PARSE")]         // VAR_TEMP not closed by END_VAR
    [InlineData("NETWORK 0 FBD\n  out := a;\nEND_NETWORK\nNETWORK 0 FBD\n  z := b;\nEND_NETWORK\n", "VG_DUPLICATE_NETWORK")] // index 0 twice → localId collision

    // ── statement shape ───────────────────────────────────────────────────────────────
    [InlineData("NETWORK 0 FBD\n  := a;\nEND_NETWORK\n", "VG_PARSE")]                                        // assignment with no target
    [InlineData("NETWORK 0 FBD\n  foo;\nEND_NETWORK\n", "VG_PARSE")]                                         // bare token, not a call/assignment
    [InlineData("NETWORK 0 FBD\n  inst(IN);\nEND_NETWORK\n", "VG_PARSE")]                                    // FB call arg without ':='

    // ── expression shape ──────────────────────────────────────────────────────────────
    [InlineData("NETWORK 0 FBD\n  out := (a AND b OR c);\nEND_NETWORK\n", "VG_BAD_EXPRESSION")]              // mixed operators in one group
    [InlineData("NETWORK 0 FBD\n  out := ((a AND b);\nEND_NETWORK\n", "VG_BAD_EXPRESSION")]                  // unbalanced parens
    [InlineData("NETWORK 0 FBD\n  out := (a AND b) OR c;\nEND_NETWORK\n", "VG_BAD_EXPRESSION")]              // partially parenthesised
    [InlineData("NETWORK 0 FBD\n  out := (a AND);\nEND_NETWORK\n", "VG_BAD_EXPRESSION")]                     // operator missing an operand
    [InlineData("NETWORK 0 FBD\n  out := (a FOO b);\nEND_NETWORK\n", "VG_UNKNOWN_OPERATOR")]                 // not an FBD operator

    // ── temp / name integrity ─────────────────────────────────────────────────────────
    [InlineData("NETWORK 0 FBD\n  VAR_TEMP\n    g1 : BOOL;\n    g2 : BOOL;\n  END_VAR\n  g1 := (a OR b);\n  g2 := NOT g1;\n  out := g2;\nEND_NETWORK\n", "VG_LEAF_REFERENCES_TEMP")] // a leaf aliasing a temp
    [InlineData("NETWORK 0 FBD\n  VAR_TEMP\n    g1 : BOOL;\n  END_VAR\n  g1 := (a AND b);\n  g1 := (c OR d);\n  out := g1;\nEND_NETWORK\n", "VG_DUPLICATE_NAME")] // result defined twice
    [InlineData("NETWORK 0 FBD\n  lbl:\n  lbl:\nEND_NETWORK\n", "VG_DUPLICATE_NAME")]                        // label declared twice

    // ── EN/ENO ────────────────────────────────────────────────────────────────────────
    [InlineData("NETWORK 0 FBD\n  VAR_TEMP\n    en1 : BOOL;\n    g1 : BOOL;\n  END_VAR\n  IF en1 THEN g1 := (a AND b); END_IF\n  out := g1;\nEND_NETWORK\n", "VG_BAD_EXPRESSION")] // IF guard with no 'en1 := …' binding
    public void Invalid_structure_is_refused_with_its_code(string vg, string code)
    {
        var ex = Assert.Throws<VgParseException>(() => VgParser.Parse(vg));
        Assert.Equal(code, ex.Code);
    }

    [Theory]
    // The flip side: canonical shapes the guards must NEVER refuse.
    [InlineData("NETWORK 0 FBD\n  out := ((a AND b) OR c);\nEND_NETWORK\n")]                                  // nested, fully parenthesised
    [InlineData("NETWORK 0 FBD\n  VAR_TEMP\n    g1 : BOOL;\n  END_VAR\n  g1 := (a AND b);\n  out := g1;\n  z := g1;\nEND_NETWORK\n")] // a fan-out result named ONCE, referenced twice — not a duplicate
    [InlineData("NETWORK 0 FBD\n  out := a;\nEND_NETWORK\nNETWORK 1 FBD\n  z := b;\nEND_NETWORK\n")]            // distinct network indices
    [InlineData("NETWORK 0 FBD\n  VAR_TEMP\n    en1 : BOOL;\n    g1 : BOOL;\n  END_VAR\n  en1 := a;\n  IF en1 THEN g1 := (b AND c); END_IF\n  out := g1;\nEND_NETWORK\n")] // a valid EN/ENO box
    [InlineData("NETWORK 0 FBD\n  lbl:\n  JMP lbl;\nEND_NETWORK\n")]                                          // a label + a jump to it
    public void Valid_structure_is_accepted(string vg) => VgParser.Parse(vg);   // must not throw
}
