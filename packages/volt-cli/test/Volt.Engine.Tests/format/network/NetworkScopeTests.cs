using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Network;
using Volt.Engine.Ide;
using Xunit;
using static Volt.Engine.Tests.NetworkModels;

namespace Volt.Engine.Tests;

/// <summary>
/// Task 3.9 (review 7.2): ONE reserved-name set, BUILT FROM THE DECLARATIONS and used by writer and reader alike —
/// <see cref="NetworkScope.FromDeclarations"/>. Every scope here is built from declaration text the way a driver
/// builds it (a member's declarations, then its owner's — <see cref="SourceScopes.Scope"/> — every GVL, and the
/// project's other items by name), never stated as a name list: a test that hands the reader a flat set of names
/// cannot fail for a global's or an owner's reason.
/// </summary>
public class NetworkScopeTests
{
    const string Owner = "FUNCTION_BLOCK FB_Axis\nVAR\n    G3 : BOOL;\n    t1 : TON;\nEND_VAR";
    const string Method = "METHOD Run : BOOL\nVAR_INPUT\n    speed : INT;\nEND_VAR";
    const string Gvl = "VAR_GLOBAL\n    G7 : BOOL;\n    fbGlobal : TOF;\nEND_VAR";
    const string Machine = "VAR_GLOBAL\n    timers : ST_Timers;\nEND_VAR";
    const string Timers = "TYPE ST_Timers :\nSTRUCT\n    offDelay : TOF;\nEND_STRUCT\nEND_TYPE";
    const string REdge = "FUNCTION R_EDGE : BOOL\nVAR_INPUT\n    x : BOOL;\nEND_VAR";

    /// <summary>The project around the bodies: two GVLs, a DUT, and a FUNCTION named like an edge word.</summary>
    static readonly Dictionary<string, string> Items = new(StringComparer.OrdinalIgnoreCase)
    {
        ["GVL_Main"] = Gvl,
        ["Machine"] = Machine,
        ["ST_Timers"] = Timers,
        ["R_EDGE"] = REdge,
    };

    static NetworkScope ScopeOf(string? declaration, bool withEdgeFunction = false) =>
        NetworkScope.FromDeclarations(declaration,
            name => (withEdgeFunction || !string.Equals(name, "R_EDGE", StringComparison.OrdinalIgnoreCase))
                    && Items.TryGetValue(name, out var d) ? d : null,
            () => Items.Values.Where(d => d.StartsWith("VAR_GLOBAL", StringComparison.Ordinal)));

    /// <summary>A method's body sees its own declarations, then its FB's.</summary>
    static NetworkScope InMethod => ScopeOf(SourceScopes.Scope(Method, Owner));

    /// <summary>An action has no declarations of its own and sees its FB's.</summary>
    static NetworkScope InAction => ScopeOf(SourceScopes.Scope(null, Owner));

    static NetworkGateResult Gate(string text, NetworkScope scope) => NetworkTextGate.Validate(text, BodyLanguage.Fbd, scope);

    static void RefusedAsDuplicate(string text, NetworkScope scope)
    {
        var r = Gate(text, scope);
        Assert.False(r.Ok);
        Assert.Equal("NETWORK_DUPLICATE_NAME", Assert.Single(r.Diagnostics).Code);
    }

    // ── a wire named like a name in scope, case-insensitively ───────────────────────────────────

    public static TheoryData<string> Bodies() => new() { "method", "action" };

    static NetworkScope In(string where) => where == "method" ? InMethod : InAction;

    /// <summary>Spec, "a wire that differs from a variable only in case", for a GLOBAL: <c>G7</c> is declared in a GVL,
    /// not in the POU, and a wire <c>g7</c> read in a method or an action names it.</summary>
    [Theory]
    [MemberData(nameof(Bodies))]
    public void A_wire_named_like_a_GVL_global_is_a_duplicate_name(string where) =>
        RefusedAsDuplicate(Src("VAR_TEMP g7 : BOOL; END_VAR", "g7 := TRUE;", "out := g7;"), In(where));

    /// <summary>…and for the OWNING FB's member, seen from its method or action: <c>G3</c> is the FB's.</summary>
    [Theory]
    [MemberData(nameof(Bodies))]
    public void A_wire_named_like_the_owning_FBs_member_is_a_duplicate_name(string where) =>
        RefusedAsDuplicate(Src("VAR_TEMP g3 : BOOL; END_VAR", "g3 := TRUE;", "out := g3;"), In(where));

    /// <summary>Spec, "the writer avoids a collision": a Demux whose VarId names a global or the owner's member is
    /// written as the lowest free <c>g&lt;n&gt;</c>, and the reader accepts that text against the SAME built scope.</summary>
    [Theory]
    [MemberData(nameof(Bodies))]
    public void The_writer_renames_around_a_global_and_the_owners_member_and_the_reader_accepts_it(string where)
    {
        var scope = In(where);
        var model = Body(Net(Def(3, L("TRUE")), Def(7, Op("AND", Ref(3), L("a"))), Set(Ref(7), T("out"))));

        var text = NetworkTextWriter.Write(model, scope);

        // g3 is the owner's member G3 and g7 the global G7: each takes the lowest g<n> nothing holds, in item order.
        Assert.Contains("  VAR_TEMP g0, g1 : BOOL; END_VAR\n  g0 := TRUE;\n  g1 := (g0 AND a);\n  out := g1;\n", text);
        var r = Gate(text, scope);
        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => d.Code + " " + d.Message)));
    }

    /// <summary>A wire-shaped name the scope DOES hold — here a global — is that variable, bare; the undeclared-wire
    /// refusal is only for a name in no scope (spec, "an undeclared wire-shaped name").</summary>
    [Fact]
    public void A_wire_shaped_global_is_the_variable_not_an_undeclared_wire()
    {
        var r = Gate(Src("out := g7;"), InMethod);

        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => d.Code + " " + d.Message)));
        Assert.Equal("g7", Assert.IsType<Leaf>(Assert.IsType<Assign>(r.Body!.Networks[0].Trees[0]).Value).Operand.Text);
    }

    // ── FB instances, from the declarations ─────────────────────────────────────────────────────

    /// <summary>The call head's FB type comes from the declaration that makes the instance: the owner's member in a
    /// method, a GVL's bare global, and a qualified path through a GVL and a struct.</summary>
    [Theory]
    [InlineData("t1(IN := a);", "t1", "TON")]
    [InlineData("fbGlobal(IN := a);", "fbGlobal", "TOF")]
    [InlineData("Machine.timers.offDelay(IN := a);", "Machine.timers.offDelay", "TOF")]
    public void An_FB_instance_takes_its_type_from_its_declaration(string statement, string instance, string type)
    {
        var r = Gate(Src(statement), InMethod);

        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => d.Code + " " + d.Message)));
        var box = Assert.IsType<Box>(r.Body!.Networks[0].Trees[0]);
        Assert.Equal((instance, type), (box.Instance!.Text, box.Type));
    }

    /// <summary>A head no declaration names is a FUNCTION of that name (spec, "FB type from the declaration").</summary>
    [Fact]
    public void A_head_no_declaration_names_is_a_function()
    {
        var r = Gate(Src("LIMIT(0, x, 10);"), InMethod);

        Assert.True(r.Ok);
        var box = Assert.IsType<Box>(r.Body!.Networks[0].Trees[0]);
        Assert.Null(box.Instance);
        Assert.Equal("LIMIT", box.Type);
    }

    // ── a POU named like a construct (task 3.6) ─────────────────────────────────────────────────

    /// <summary>Spec, "a POU named like an edge word": with a FUNCTION named <c>R_EDGE</c> in the project, both the
    /// bare call and the backticked head are refused at the call — the text reads <c>R_EDGE(x)</c> as the edge.</summary>
    [Theory]
    [InlineData("out := R_EDGE(x);")]
    [InlineData("out := `R_EDGE`(x);")]
    public void A_project_function_named_R_EDGE_makes_its_call_unspellable(string statement)
    {
        var r = Gate(Src(statement), ScopeOf(SourceScopes.Scope(Method, Owner), withEdgeFunction: true));

        Assert.False(r.Ok);
        Assert.Equal("NETWORK_UNSUPPORTED", Assert.Single(r.Diagnostics).Code);
    }

    /// <summary>…and the same text is the edge flag when no POU takes the name.</summary>
    [Fact]
    public void Without_such_a_POU_R_EDGE_is_the_edge()
    {
        var r = Gate(Src("out := R_EDGE(x);"), InMethod);

        Assert.True(r.Ok);
        Assert.True(Assert.IsType<Leaf>(Assert.IsType<Assign>(r.Body!.Networks[0].Trees[0]).Value).Flags.Rising);
    }
}
