using Xunit;
using Volt.Engine.Format.Network;

namespace Volt.Engine.Tests;

/// <summary>
/// The bridge OWNS the graphical format: every invalid structure must be REFUSED with a stable, specific
/// diagnostic code BEFORE it can reach the IDE (a malformed body crashes/corrupts the importer). This pins the
/// full set of structural refusals the parser makes, and — just as important — the valid shapes it must NOT
/// refuse (so the guards never over-fire on a canonical body).
/// </summary>
public class NetworkTextDiagnosticsTests
{
    [Theory]
    // ── network framing ───────────────────────────────────────────────────────────────
    [InlineData("NETWORK 0 FBD\n  out := a;\n", "NETWORK_NOT_CLOSED")]                                   // no END_NETWORK at EOF
    [InlineData("NETWORK 0 FBD\n  out := a;\nNETWORK 1 FBD\n  z := b;\nEND_NETWORK\n", "NETWORK_NOT_CLOSED")] // network 0 left open
    [InlineData("END_NETWORK\n", "NETWORK_PARSE")]                                                                // close with nothing open
    [InlineData("  x := y;\n", "NETWORK_PARSE")]                                                                  // statement before any NETWORK
    [InlineData("NETWORK 0 FBD\n  out := a;\nEND_NETWORK\nNETWORK 0 FBD\n  z := b;\nEND_NETWORK\n", "NETWORK_DUPLICATE_NETWORK")] // index 0 twice → localId collision

    // ── statement shape ───────────────────────────────────────────────────────────────
    [InlineData("NETWORK 0 FBD\n  := a;\nEND_NETWORK\n", "NETWORK_PARSE")]                                        // assignment with no target
    [InlineData("NETWORK 0 FBD\n  foo;\nEND_NETWORK\n", "NETWORK_PARSE")]                                         // bare token, not a call/assignment
    // `inst(IN);` USED TO BE HERE, expecting NETWORK_PARSE on the reasoning that a positional call as a
    // statement is "a call whose result goes nowhere". The premise is refuted by the VENDOR, not by a change
    // of mind: a real customer project (Lenze_MID-S100) renders `MOVE(g0, iDec);` as a bare statement in 34
    // of its 373 networks — a MOVE box in a ladder with its EN wired and its output connected to nothing.
    // Refusing it meant those POUs could be pulled and never pushed back. The row is now a POSITIVE case in
    // NetworkTextRoundTripTests, which asserts the statement survives a round trip instead of being refused.

    // ── expression shape ──────────────────────────────────────────────────────────────
    [InlineData("NETWORK 0 FBD\n  out := (a AND b OR c);\nEND_NETWORK\n", "NETWORK_BAD_EXPRESSION")]              // mixed operators in one group
    [InlineData("NETWORK 0 FBD\n  out := ((a AND b);\nEND_NETWORK\n", "NETWORK_BAD_EXPRESSION")]                  // unbalanced parens
    [InlineData("NETWORK 0 FBD\n  out := (a AND b) OR c;\nEND_NETWORK\n", "NETWORK_BAD_EXPRESSION")]              // partially parenthesised
    [InlineData("NETWORK 0 FBD\n  out := (a AND);\nEND_NETWORK\n", "NETWORK_BAD_EXPRESSION")]                     // operator missing an operand
    [InlineData("NETWORK 0 FBD\n  out := (a FOO b);\nEND_NETWORK\n", "NETWORK_UNKNOWN_OPERATOR")]                 // not an FBD operator

    // ── temp / name integrity ─────────────────────────────────────────────────────────
    // `LET g2 := NOT g1;` was NETWORK_LEAF_REFERENCES_TEMP and is now VALID - it moved to the accepted
    // shapes below. The refusal existed because a LET name was, in the specification's own words, "a network
    // text-only construct: they never reach the IDE", so a leaf whose TEXT aliased one pushed a reference to
    // something that would not exist. A named wire is now the vendor's own BoxTreeDemux VarId - measured, 573
    // of them in one real ladder project - so the reference DOES reach the IDE and the hazard is gone.
    // Refusing it would also break closure: the writer emits exactly this shape for a negated fan-out wire.
    [InlineData("NETWORK 0 FBD\n  LET g1 := (a AND b);\n  LET g1 := (c OR d);\n  out := g1;\nEND_NETWORK\n", "NETWORK_DUPLICATE_NAME")] // result defined twice
    [InlineData("NETWORK 0 FBD\n  lbl:\n  lbl:\nEND_NETWORK\n", "NETWORK_DUPLICATE_NAME")]                        // label declared twice

    // ── EN/ENO ────────────────────────────────────────────────────────────────────────
    [InlineData("NETWORK 0 FBD\n  IF en1 THEN LET g1 := (a AND b); END_IF\n  out := g1;\nEND_NETWORK\n", "NETWORK_BAD_EXPRESSION")] // IF guard with no 'en1 := …' binding
    public void Invalid_structure_is_refused_with_its_code(string net, string code)
    {
        var ex = Assert.Throws<NetworkTextException>(() => NetworkTextReader.Parse(net));
        Assert.Equal(code, ex.Code);
    }

    [Theory]
    // The flip side: canonical shapes the guards must NEVER refuse.
    [InlineData("NETWORK 0 FBD\n  out := ((a AND b) OR c);\nEND_NETWORK\n")]                                  // nested, fully parenthesised
    [InlineData("NETWORK 0 FBD\n  LET g1 := (a AND b);\n  out := g1;\n  z := g1;\nEND_NETWORK\n")] // a fan-out result named ONCE, referenced twice — not a duplicate
    [InlineData("NETWORK 0 FBD\n  out := a;\nEND_NETWORK\nNETWORK 1 FBD\n  z := b;\nEND_NETWORK\n")]            // distinct network indices
    [InlineData("NETWORK 0 FBD\n  LET en1 := a;\n  IF en1 THEN LET g1 := (b AND c); END_IF\n  out := g1;\nEND_NETWORK\n")] // a valid EN/ENO box
    [InlineData("NETWORK 0 FBD\n  lbl:\n  JMP lbl;\nEND_NETWORK\n")]                                          // a label + a jump to it
    [InlineData("NETWORK 0 FBD\n  LET g1 := (a OR b);\n  LET g2 := NOT g1;\n  out := g2;\nEND_NETWORK\n")]   // a negated fan-out wire: a real Demux reference, not an alias
    public void Valid_structure_is_accepted(string net) => NetworkTextReader.Parse(net);   // must not throw
}
