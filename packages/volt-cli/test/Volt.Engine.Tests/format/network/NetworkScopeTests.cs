using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Network;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Tests.Shared;
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

    /// <summary>Each item's WIRE KIND — what the push's wire name or the IDE's class says it is (D3).</summary>
    static readonly Dictionary<string, string> Kinds = new(StringComparer.OrdinalIgnoreCase)
    {
        ["GVL_Main"] = ItemKind.Kinds.Gvl,
        ["Machine"] = ItemKind.Kinds.Gvl,
        ["ST_Timers"] = ItemKind.Kinds.Dut,
        ["R_EDGE"] = ItemKind.Kinds.Pou,
    };

    static NetworkScope ScopeOf(string? declaration, bool withEdgeFunction = false)
    {
        bool InProject(string name) =>
            withEdgeFunction || !string.Equals(name, "R_EDGE", StringComparison.OrdinalIgnoreCase);
        return NetworkScope.FromDeclarations(declaration,
            name => InProject(name) && Items.TryGetValue(name, out var d) ? d : null,
            () => Items.Where(kv => Kinds[kv.Key] == ItemKind.Kinds.Gvl).Select(kv => kv.Value),
            name => InProject(name) && Kinds.TryGetValue(name, out var k) ? k : null,
            Scopes.RefusedPouName);
    }

    /// <summary>A method's body sees its own declarations, then its FB's.</summary>
    static NetworkScope InMethod => ScopeOf(SourceScopes.Scope(Method, Owner));

    /// <summary>An action has no declarations of its own and sees its FB's.</summary>
    static NetworkScope InAction => ScopeOf(SourceScopes.Scope(null, Owner));

    static NetworkGateResult Gate(string text, NetworkScope scope) => NetworkTextGate.Validate(text, scope);

    /// <summary>The text reads, and the wire-shaped name is the network's WIRE — not the variable in scope it shares a
    /// name with (openspec <c>bridge-refusal-review</c> 2.10: wires resolve first, and which name the writer picks is its
    /// own choice on the next pull). The READER's answer; the gate stops refusing a non-canonical spelling with 2.12.</summary>
    static void ReadAsTheWire(string text, NetworkScope scope)
    {
        var r = NetworkTextReader.Read(text, scope);
        Assert.True(r.Ok, string.Join("\n", r.Diagnostics.Select(d => d.Code + " " + d.Message)));
        var trees = Assert.Single(r.Body!.Networks).Trees;
        var wire = Assert.IsType<Demux>(trees[0]).VarId;
        Assert.Equal(wire, Assert.IsType<Demux>(Assert.IsType<Assign>(trees[^1]).Value).VarId);
    }

    // ── a wire named like a name in scope, case-insensitively ───────────────────────────────────

    public static TheoryData<string> Bodies() => new() { "method", "action" };

    static NetworkScope In(string where) => where == "method" ? InMethod : InAction;

    /// <summary>A wire spelled like a GLOBAL (<c>G7</c>, declared in a GVL, not in the POU), read in a method or an
    /// action, is the network's wire. It used to be refused as a duplicate name (spec "a wire that differs from a
    /// variable only in case"); that rule is gone (2.10).</summary>
    [Theory]
    [MemberData(nameof(Bodies))]
    public void A_wire_named_like_a_GVL_global_is_the_wire(string where) =>
        ReadAsTheWire(Src("VAR_TEMP g7 : BOOL; END_VAR", "g7 := TRUE;", "out := g7;"), In(where));

    /// <summary>…and so is one spelled like the OWNING FB's member, seen from its method or action: <c>G3</c> is the FB's.</summary>
    [Theory]
    [MemberData(nameof(Bodies))]
    public void A_wire_named_like_the_owning_FBs_member_is_the_wire(string where) =>
        ReadAsTheWire(Src("VAR_TEMP g3 : BOOL; END_VAR", "g3 := TRUE;", "out := g3;"), In(where));

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

    /// <summary>The engine's scopes take the PRODUCTION fact — every word both vendors refuse as a POU name — not a
    /// stand-in (review of <c>bridge-refusal-review</c> 4a): types the 25-word stand-in lacked and both drivers refuse
    /// are common in the corpus declarations (counts beside each), and a variable of one is no FB instance on either
    /// vendor, so it is none in the corpus oracle either.</summary>
    [Theory]
    [InlineData("DATE_AND_TIME")]   // 164
    [InlineData("__XWORD")]         // 981
    [InlineData("BIT")]             // 396
    [InlineData("__SYSTEM")]        // 272
    [InlineData("__UXINT")]         // 121
    [InlineData("TIME_OF_DAY")]     // 59
    [InlineData("__XINT")]          // 51
    [InlineData("ANY_INT")]         // 7
    public void A_variable_of_a_type_both_vendors_refuse_is_no_instance(string type) =>
        Assert.Null(Scopes.Of($"VAR\n    x : {type};\nEND_VAR").InstanceType("x"));

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

    // ── review of section 3: the declarations a scope is built from ─────────────────────────────

    const string Derived = "FUNCTION_BLOCK FB_Derived\nVAR\n    a : BOOL;\n    t2 : Standard.TON;\nEND_VAR";

    static string Diagnostics(NetworkGateResult r) => string.Join("\n", r.Diagnostics.Select(d => d.Code + " " + d.Message));

    /// <summary>A type named through its library namespace (<c>t2 : Standard.TON;</c> — lenze-mid, bakon-nano and
    /// pro2193 hold <c>Standard.TON</c>, TwinCAT projects <c>Tc2_Standard.TON</c>) is that whole name. Read as its
    /// first identifier it was the namespace, <c>Standard</c>, and the push built a box of type <c>Standard</c>.</summary>
    [Fact]
    public void An_instance_declared_through_its_library_namespace_has_the_qualified_type()
    {
        var scope = ScopeOf(Derived);
        Assert.Equal("Standard.TON", scope.InstanceType("t2"));

        var r = NetworkTextGate.Validate(LdSrc("t2(IN := a);"), scope);

        Assert.True(r.Ok, Diagnostics(r));
        var box = Assert.IsType<Box>(r.Body!.Networks[0].Trees[0]);
        Assert.Equal(("t2", "Standard.TON"), (box.Instance!.Text, box.Type));
    }

    /// <summary>…and a pulled box of that instance is written, whether the vendor stores the type bare (<c>TON</c>)
    /// or as declared: a declaration naming a type through its namespace names the type the box calls. It went to
    /// the marker as "an FB instance declared with another type". The written text reads back as the same model
    /// (spec, <c>Read(Write(m)) ≅ m</c>): the reader takes the type in the declaration's spelling, and that spelling
    /// is a fact the text does not carry (<see cref="NetworkTextFacts"/>).</summary>
    [Theory]
    [InlineData("TON", Derived)]
    [InlineData("Standard.TON", Derived)]
    [InlineData("Standard.TON", "FUNCTION_BLOCK FB\nVAR\n    a : BOOL;\n    t2 : TON;\nEND_VAR")]
    public void A_pulled_box_of_a_namespace_qualified_instance_is_written(string storedType, string declaration) =>
        RoundTrips(Ld1(Fb("t2", new[] { NetworkModels.In(L("a"), "IN") }, type: storedType)), ScopeOf(declaration),
                   LdSrc("t2(IN := a);"));

    /// <summary>Write, compare the text, read it back against the same scope, and compare the model as the oracle
    /// does — so a test of what the writer accepts also proves what the reader rebuilds from it.</summary>
    static void RoundTrips(NetworkBody m, NetworkScope scope, string expected)
    {
        var text = NetworkTextWriter.Write(m, scope);
        Assert.Equal(expected, text);
        var back = NetworkTextReader.Read(text, scope);
        Assert.True(back.Ok, string.Join("\n", back.Diagnostics.Select(d => d.Code + " " + d.Message)));
        Assert.Null(NetworkModelEquality.FirstDifference(NetworkTextFacts.Carried(m), NetworkTextFacts.Carried(back.Body!)));
    }

    /// <summary>A namespace is part of a type's name: two libraries' <c>TON</c> are two types.</summary>
    [Fact]
    public void Two_namespaces_are_two_types()
    {
        var e = Assert.Throws<NetworkUnrepresentableException>(() =>
            NetworkTextWriter.Write(Ld1(Fb("t2", new[] { NetworkModels.In(L("a"), "IN") }, type: "Other.TON")), ScopeOf(Derived)));
        Assert.Equal("an FB instance declared with another type", e.Reason);
    }

    /// <summary>IEC names are case-insensitive, a declared type too: <c>t1 : Ton;</c> and a vendor box of type
    /// <c>TON</c> are one type. Compared ordinally, the body went to the marker for a difference that is none.</summary>
    [Fact]
    public void An_instance_type_differing_only_in_case_is_the_same_type() =>
        RoundTrips(Ld1(Fb("T1", new[] { NetworkModels.In(L("a"), "IN") }, type: "TON")),
            ScopeOf("PROGRAM P\nVAR\n    a : BOOL;\n    t1 : Ton;\nEND_VAR"), LdSrc("T1(IN := a);"));

    const string Base = "FUNCTION_BLOCK FB_Base\nVAR\n    tBase : TON;\n    G3 : BOOL;\nEND_VAR";
    const string Child = "FUNCTION_BLOCK FB_Child EXTENDS FB_Base\nVAR\n    a : BOOL;\nEND_VAR";

    static NetworkScope Inheriting(string? declaration) =>
        NetworkScope.FromDeclarations(declaration,
            n => string.Equals(n, "FB_Base", StringComparison.OrdinalIgnoreCase) ? Base : null,
            () => Array.Empty<string>(),
            n => string.Equals(n, "FB_Base", StringComparison.OrdinalIgnoreCase) ? ItemKind.Kinds.Pou : null,
            Scopes.RefusedPouName);

    public static TheoryData<string> InheritingBodies() => new() { "body", "method" };

    static NetworkScope InChild(string where) => Inheriting(where == "body" ? Child : SourceScopes.Scope(Method, Child));

    /// <summary>An FB's members include its base's (<c>EXTENDS</c>), in its own body and in its methods: a call to an
    /// inherited instance is that instance. Without them the push read <c>tBase(IN := a)</c> as a FUNCTION named
    /// <c>tBase</c> — a different program, accepted silently.</summary>
    [Theory]
    [MemberData(nameof(InheritingBodies))]
    public void An_inherited_instance_is_that_instance(string where)
    {
        var scope = InChild(where);
        Assert.Equal("TON", scope.InstanceType("tBase"));

        var r = NetworkTextGate.Validate(LdSrc("tBase(IN := a);"), scope);

        Assert.True(r.Ok, Diagnostics(r));
        var box = Assert.IsType<Box>(r.Body!.Networks[0].Trees[0]);
        Assert.Equal(("tBase", "TON", CallKind.FunctionBlock), (box.Instance!.Text, box.Type, box.Kind));
    }

    /// <summary>…and the pull writes it, rather than going to the marker as "an FB instance the declarations do not
    /// name".</summary>
    [Theory]
    [MemberData(nameof(InheritingBodies))]
    public void A_pulled_call_of_an_inherited_instance_is_written(string where) =>
        Assert.Equal(LdSrc("tBase(IN := a);"),
            NetworkTextWriter.Write(Ld1(Fb("tBase", new[] { NetworkModels.In(L("a"), "IN") }, type: "TON")), InChild(where)));

    /// <summary>Spec, "reserved names are one case-insensitive set" — for the WRITER: every name in scope, an inherited
    /// member too. A wire <c>g3</c> beside the base's <c>G3</c> reads as the wire (2.10) and is renamed on write.</summary>
    [Theory]
    [MemberData(nameof(InheritingBodies))]
    public void A_wire_named_like_an_inherited_member_is_the_wire_and_renamed_on_write(string where)
    {
        var scope = InChild(where);
        Assert.True(scope.Contains("G3"));
        ReadAsTheWire(Src("VAR_TEMP g3 : BOOL; END_VAR", "g3 := TRUE;", "out := g3;"), scope);
        Assert.Contains("VAR_TEMP g0 : BOOL; END_VAR",
            NetworkTextWriter.Write(Body(Net(Def(3, L("TRUE")), Set(Ref(3), T("out")))), scope));
    }

    /// <summary>A base that extends in turn is followed to the root (a header may wrap <c>EXTENDS</c> onto its own
    /// line, as CODESYS stores it), and a cycle — an invalid project, but text an IDE can hold — ends.</summary>
    [Fact]
    public void Inheritance_is_followed_to_the_root_and_a_cycle_ends()
    {
        var items = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["FB_Mid"] = "FUNCTION_BLOCK FB_Mid\nEXTENDS FB_Root\nVAR\n    mid : BOOL;\nEND_VAR",
            ["FB_Root"] = "FUNCTION_BLOCK FB_Root EXTENDS FB_Mid\nVAR\n    tRoot : TOF;\nEND_VAR",
        };
        var scope = NetworkScope.FromDeclarations("FUNCTION_BLOCK FB_Leaf EXTENDS FB_Mid\nVAR\nEND_VAR",
            n => items.TryGetValue(n, out var d) ? d : null, () => Array.Empty<string>(), Scopes.NoItem, Scopes.RefusedPouName);

        Assert.True(scope.Contains("mid"));
        Assert.Equal("TOF", scope.InstanceType("tRoot"));
    }

    /// <summary>A pushed GVL opening with a multi-line block comment is a global list. The push's scope once lost every
    /// name it declared (the comment's second line was taken for the first code line), while the pull found the same
    /// GVL by its tree kind — the writer's and the reader's scopes apart again. Since openspec
    /// <c>push-without-header-check</c> 5.Q.7 a pushed GVL is one by its WIRE KIND, as a pulled one is by its class,
    /// and its text is not read for that at all (<c>GlobalsByWireKindTests</c>).</summary>
    [Fact]
    public void A_pushed_GVL_opening_with_a_block_comment_is_a_global_list()
    {
        var pushed = Volt.Engine.Ide.PushedDeclarations.FromWire(new[]
        {
            ("GVL_Timers", (string?)Volt.Engine.Item.ItemKind.Kinds.Gvl, "(* shared\n   timers *)\nVAR_GLOBAL\n  t1 : TON;\nEND_VAR"),
        });

        var scope = new FakeIde().NetworkScopeFor("PROGRAM P\nVAR\n  go : BOOL;\nEND_VAR", pushed);

        Assert.Equal("TON", scope.InstanceType("t1"));
    }

    // ── an FB instance is a variable whose type is a FUNCTION BLOCK, not any variable ────────────

    /// <summary>A variable whose type is elementary, or a project item that is no function block (a DUT), is no
    /// FB instance: the scope that said otherwise read <c>k(x)</c>, <c>k : INT</c>, as a box of an FB named
    /// <c>INT</c> and let it through, where the LSP reads the same head as no instance (<c>instanceFb</c>). A library
    /// type the project holds no declaration of (<c>TON</c>) is one, and so is a project FUNCTION_BLOCK.</summary>
    [Theory]
    [InlineData("k : INT;", "k", null)]
    [InlineData("k : Bool;", "k", null)]
    [InlineData("k : STRING(80);", "k", null)]
    [InlineData("k : ARRAY[1..3] OF TON;", "k", null)]
    [InlineData("k : POINTER TO TON;", "k", null)]
    [InlineData("s : ST_Timers;", "s", null)]
    [InlineData("t : TON;", "t", "TON")]
    [InlineData("f : FB_Motor;", "f", "FB_Motor")]
    public void Only_a_variable_of_a_function_block_type_is_an_instance(string line, string name, string? expected)
    {
        Assert.Equal(expected, InProgram(line).InstanceType(name));
    }

    /// <summary>A program declaring <paramref name="line"/>, in a project holding a DUT <c>ST_Timers</c>, a function
    /// block <c>FB_Motor</c>, a FUNCTION <c>F_Calc</c>, and <c>FB_Broken</c> — a function block whose declaration opens
    /// a comment it never closes, so its text declares nothing and has no header to read.</summary>
    static NetworkScope InProgram(string line)
    {
        var items = new Dictionary<string, (string Kind, string Declaration)>(StringComparer.OrdinalIgnoreCase)
        {
            ["ST_Timers"] = (ItemKind.Kinds.Dut, Timers),
            ["FB_Motor"] = (ItemKind.Kinds.Pou, "FUNCTION_BLOCK FB_Motor\nVAR_INPUT\n    x : INT;\nEND_VAR"),
            ["F_Calc"] = (ItemKind.Kinds.Pou, "FUNCTION F_Calc : INT\nVAR_INPUT\n    x : INT;\nEND_VAR"),
            ["FB_Broken"] = (ItemKind.Kinds.Pou, "(* doc\nFUNCTION_BLOCK FB_Broken\nVAR_INPUT\n    IN : BOOL;\nEND_VAR"),
        };
        return NetworkScope.FromDeclarations("PROGRAM P\nVAR\n    " + line + "\n    a : BOOL;\n    o : INT;\nEND_VAR",
            n => items.TryGetValue(n, out var d) ? d.Declaration : null, () => Array.Empty<string>(),
            n => items.TryGetValue(n, out var d) ? d.Kind : null, Scopes.RefusedPouName);
    }

    // ── D3 (openspec bridge-refusal-review 4.3): FB or FUNCTION by KIND, never by the callee's header ──────

    /// <summary>The D3 bug: an FB instance whose FB's declaration does not parse (it opens a comment it never closes)
    /// was read as a FUNCTION call named <c>t1</c> — the callee's header did not read as FUNCTION_BLOCK — and the
    /// wrong NWL body was WRITTEN. The FB is a POU by its KIND, so <c>t1</c> is its instance whatever its text says,
    /// and no callee header is read (spec, "callee whose header does not parse").</summary>
    [Fact]
    public void An_instance_of_an_FB_whose_declaration_does_not_parse_is_an_instance()
    {
        var scope = InProgram("t1 : FB_Broken;");
        Assert.Equal("FB_Broken", scope.InstanceType("t1"));

        var r = NetworkTextGate.Validate(LdSrc("t1(IN := a);"), scope);

        Assert.True(r.Ok, Diagnostics(r));
        var box = Assert.IsType<Box>(r.Body!.Networks[0].Trees[0]);
        Assert.Equal(("t1", "FB_Broken", CallKind.FunctionBlock), (box.Instance!.Text, box.Type, box.Kind));
    }

    /// <summary>A variable typed by a project FUNCTION is an instance box of that type: the box is what the text says
    /// (a call of the variable), neither shape compiles, and the build reports it — no refusal, no guess (design
    /// D3, the one answer that changes; 0 occurrences in the six corpora).</summary>
    [Fact]
    public void A_variable_typed_by_a_project_function_is_an_instance_box_the_build_judges() =>
        Assert.Equal("F_Calc", InProgram("f : F_Calc;").InstanceType("f"));

    /// <summary>A POU is one by its KIND: a project item of kind <c>pou</c> named like an edge word makes the edge
    /// unspellable whatever its text, and an item of another kind of that name (a DUT) does not.</summary>
    [Theory]
    [InlineData("pou", true)]
    [InlineData("dut", false)]
    public void A_POU_is_one_by_its_kind_not_its_header(string kind, bool callable)
    {
        var scope = NetworkScope.FromDeclarations("FUNCTION_BLOCK FB\nVAR\n    x : BOOL;\n    out : BOOL;\nEND_VAR",
            n => n == "R_EDGE" ? "(* unreadable" : null, () => Array.Empty<string>(),
            n => n == "R_EDGE" ? kind : null, Scopes.RefusedPouName);

        Assert.Equal(callable, scope.IsCallable("R_EDGE"));
    }

    /// <summary>…so a call headed by such a variable is read as the LSP reads it — a call of that name, no instance —
    /// never as an instance box whose FB is <c>INT</c>, which the push would have built.</summary>
    [Fact]
    public void A_call_headed_by_a_variable_of_an_elementary_type_is_no_instance_box()
    {
        var scope = NetworkScope.FromDeclarations("FUNCTION_BLOCK FB\nVAR\n    k : INT;\n    x : INT;\n    out : INT;\nEND_VAR",
            _ => null, () => Array.Empty<string>(), Scopes.NoItem, Scopes.RefusedPouName);

        var r = NetworkTextGate.Validate(Src("out := k(x);"), scope);

        var box = Assert.IsType<Box>(Assert.IsType<Assign>(Assert.Single(r.Body!.Networks[0].Trees)).Value);
        Assert.Null(box.Instance);
        Assert.Equal("k", box.Type);
    }

    /// <summary>Spec, "a variable named like a construct does not block it", through the scope a driver BUILDS: a
    /// BOOL named <c>R_EDGE</c> is no POU and no instance, so an ordinary rising edge in its POU is read and written.
    /// Built by hand the scope held no instance of that name and the rule passed; built from the declaration it
    /// called the BOOL an instance, refused every edge on push and sent the pulled body to the marker.</summary>
    [Theory]
    [InlineData("R_EDGE")]
    [InlineData("F_EDGE")]
    [InlineData("PARALLEL")]
    public void A_variable_named_like_a_construct_does_not_block_it_in_a_built_scope(string word)
    {
        var scope = NetworkScope.FromDeclarations(
            $"FUNCTION_BLOCK FB\nVAR\n    {word} : BOOL;\n    x : BOOL;\n    out : BOOL;\nEND_VAR",
            _ => null, () => Array.Empty<string>(), Scopes.NoItem, Scopes.RefusedPouName);

        Assert.False(scope.IsCallable(word));
        var r = NetworkTextGate.Validate(Src("out := R_EDGE(x);"), scope);
        Assert.True(r.Ok, Diagnostics(r));
        Assert.Equal(Src("out := R_EDGE(x);"), NetworkTextWriter.Write(r.Body!, scope));
    }
}
