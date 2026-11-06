using System;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;
using static Volt.Engine.Tests.NetworkModels;

namespace Volt.Engine.Tests.Format.Network;

/// <summary>
/// THE SHAPES THE NWL COMPLETENESS GATE FOUND (openspec <c>nwl-schema-completeness-gate</c>, "Owner decision" and "Decided by
/// Volt + Sim-Assist", 2026-10-31), one test each on the model side: a shape CODESYS stores that changes the picture or the
/// code is spelled and round-trips; an inert bit is refused by name, so a pull never loses it silently.
/// </summary>
public class NwlShapeSpellingTests
{
    static NetworkScope Scope(NetworkBody b) => NetworkModelScopes.ScopeOf(b);

    static void RoundTrips(NetworkBody body, string text)
    {
        Assert.Equal(text, StNetworkWriter.Write(body, Scope(body)));
        var back = StNetworkReader.Read(text, Scope(body));
        Assert.Null(NetworkModelEquality.FirstDifference(NetworkTextFacts.Carried(body), NetworkTextFacts.Carried(back)));
    }

    static void Refused(NetworkBody body, string reason) =>
        Assert.Equal(reason, Assert.Throws<StNetworkUnspellableException>(() => StNetworkWriter.Write(body, Scope(body))).Reason);

    static Operand C(Operand o, string comment) => o with { Comment = comment };

    // ── spelled ────────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact] // #1
    public void A_root_leaf_is_a_value_standing_alone() =>
        RoundTrips(Ld1(L("a")), "%LANGUAGE LD\n%NETWORK\na;\n");

    [Fact] // #2
    public void A_negated_root_box_is_NOT_before_its_call() =>
        RoundTrips(Fbd1(Op("AND", L("a"), L("b")) with { Flags = Neg, ConnectedSlot = null }), "%LANGUAGE FBD\n%NETWORK\nINVERT(AND(a, b));\n");

    [Fact] // #7a
    public void A_negated_assign_item_is_NOT_before_an_empty_receiver_last_in_its_chain()
    {
        RoundTrips(Ld1(new Assign(L("a"), new[] { T("y") }, Neg)), "%LANGUAGE LD\n%NETWORK\nASSIGN(INVERT(a), Q => y);\n");
        RoundTrips(Ld1(new Assign(L("a"), new[] { T("y"), T("x") }, Neg)), "%LANGUAGE LD\n%NETWORK\nASSIGN(INVERT(a), Q => y, Q => x);\n");
    }

    [Fact] // #8
    public void A_negated_jump_is_NOT_before_its_target() =>
        RoundTrips(Ld1(new Assign(L("a"), new[] { T("l", JumpBit with { Negated = true }) }, JumpBit)), "%LANGUAGE LD\n%NETWORK\nASSIGN(a, Q_INVERTED => JMP.l);\n");

    [Fact] // #11
    public void A_root_branch_is_its_call_standing_alone() =>
        RoundTrips(Ld1(new Volt.Engine.Format.Network.Parallel(L("start"), new Node[] { L("a"), L("b") }, ParallelMode.Sequential)),
            "%LANGUAGE LD\n%NETWORK\nBRANCH(FEED := start, a, b);\n");

    [Fact] // #12
    public void The_rail_alone_is_RAIL_standing_alone() =>
        RoundTrips(Ld1(Empty), "%LANGUAGE LD\n%NETWORK\nRAIL();\n");

    [Fact] // #16
    public void A_negated_Execute_ENO_is_INVERT_around_its_call() =>
        RoundTrips(Ld1(new Assign(Exec("n := TRUE;", en: L("go"), connected: 0), new[] { T("y") }, Neg)),
            "%LANGUAGE LD\n%NETWORK\nASSIGN(INVERT(EXECUTE(EN := go, 'n := TRUE;')), Q => y);\n");

    [Fact] // #18
    public void A_rail_fed_branch_is_FEED_RAIL() =>
        RoundTrips(Ld1(Set(new Volt.Engine.Format.Network.Parallel(Empty, new Node[] { L("a"), L("b") }, ParallelMode.Sequential), T("y"))),
            "%LANGUAGE LD\n%NETWORK\nASSIGN(BRANCH(FEED := RAIL(), a, b), Q => y);\n");

    [Fact]
    public void The_operand_comment_is_COMMENT_on_a_value_a_coil_a_pin_and_an_output()
    {
        RoundTrips(Ld1(Set(new Leaf(C(new Operand("a"), "why"), Flags.None), T("y"))), "%LANGUAGE LD\n%NETWORK\nASSIGN(COMMENT(a, 'why'), Q => y);\n");
        RoundTrips(Ld1(Set(L("a"), C(T("y", Neg), "why"))), "%LANGUAGE LD\n%NETWORK\nASSIGN(a, Q_INVERTED => COMMENT(y, 'why'));\n");
        RoundTrips(Fbd1(Set(Call("F1", new[] { In(new Leaf(C(new Operand("a"), "it's"), Flags.None), "IN1") }, connected: 0), T("y"))),
            "%LANGUAGE FBD\n%NETWORK\nASSIGN(F1(IN1 := COMMENT(a, 'it$'s')), Q => y);\n");
        RoundTrips(Fbd1(Call("MOVE", new[] { In(L("a")) }, new[] { new Output(null, C(new Operand("x", IsLValue: true), "why"), 0) })),
            "%LANGUAGE FBD\n%NETWORK\nMOVE(a, OUT => COMMENT(x, 'why'));\n");
    }

    // ── inert in the IDE: refused by name ─────────────────────────────────────────────────────────────────────────

    [Fact] // #3
    public void A_coil_flag_on_a_pin_is_refused_by_name() =>
        Refused(Fbd1(Set(Op("AND", L("a"), L("b")) with { Inputs = new[] { new Input(null, L("a"), SetBit), In(L("b")) } }, T("y"))),
            "a coil flag on a pin");

    [Fact] // #5
    public void Both_edges_on_one_node_are_refused_by_name() =>
        Refused(Ld1(Set(L("a"), T("y", Rise with { Falling = true }))), "a rising and falling edge on one node");

    [Fact] // #7b
    public void A_set_bit_on_the_assign_item_is_refused_by_name() =>
        Refused(Ld1(new Assign(L("a"), new[] { T("y") }, SetBit)), UnheldFlags.AssignItemMarker);

    [Fact] // #9
    public void A_return_with_a_named_target_is_refused_by_name() =>
        Refused(Ld1(new Assign(L("a"), new[] { T("l", ReturnBit) }, ReturnBit)), "a return with a named target");

    [Fact] // #10
    public void A_jump_and_a_return_on_one_target_are_refused_by_name() =>
        Refused(Ld1(new Assign(L("a"), new[] { T("l", JumpBit with { Return = true }) }, JumpBit with { Return = true })),
            "a jump and a return on one target");

    [Fact] // #14
    public void A_coil_flag_on_a_value_is_refused_by_name() =>
        Refused(Ld1(Set(L("a", SetBit), T("y"))), "a coil flag on an operand");

    [Fact] // #15
    public void A_coil_flag_on_a_box_is_refused_by_name() =>
        Refused(Fbd1(Set(Op("AND", L("a"), L("b")) with { Flags = SetBit, ConnectedSlot = null }, T("y"))), "a coil flag on a box");

    [Fact] // #17
    public void A_negated_rail_is_refused_by_name() =>
        Refused(Ld1(Set(new Terminator(Neg), T("y"))), "a modifier on the rail");

    [Fact]
    public void A_comment_where_the_text_names_no_operand_is_refused_by_name()
    {
        Refused(Ld1(new Assign(L("a"), new[] { C(T("l", JumpBit), "why") }, JumpBit)), "a comment on a jump or a return");
        Refused(Ld1(Set(L("a"), C(T("y"), ""))), "an empty operand comment");
    }
}
