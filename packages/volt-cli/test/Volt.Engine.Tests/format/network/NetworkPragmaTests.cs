using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;
using static Volt.Engine.Tests.NetworkModels;

namespace Volt.Engine.Tests;

/// <summary>
/// openspec <c>ld-fbd-coverage</c> 2.3 (design "One pragma, member ↔ text one to one"): a stored member the text does not
/// imply is spelled <c>{Member := value}</c> directly after its node, and read back into the model as stored. S1 is its
/// first user: a bit operator connected by a stored output slot is the box storing an output — one output slot per
/// stored name — <c>(a AND b){OutputParam.Names := ['']}</c>.
/// </summary>
public class NetworkPragmaTests
{
    static readonly NetworkScope Scope = new(new[] { "a", "b", "c", "out", "go" }, Array.Empty<string>(),
        new Dictionary<string, string> { ["t1"] = "TON" });

    // ── the literal ─────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("{OutputParam.Names := ['']}", "OutputParam.Names")]
    [InlineData("{OutputParam.Names := ['Q', 'ET']}", "OutputParam.Names")]
    [InlineData("{CallType := FunctionBlock}", "CallType")]
    [InlineData("{EN := FALSE}", "EN")]
    [InlineData("{BranchCounter := 328}", "BranchCounter")]
    [InlineData("{SymbolComment := 'it$'s $$5$N$R$T$01'}", "SymbolComment")]
    [InlineData("{OutputParam.Names := []}", "OutputParam.Names")]
    public void A_pragma_reads_back_as_it_is_spelled(string spelled, string member)
    {
        var p = NetworkPragma.Parse(spelled.Substring(1, spelled.Length - 2), out var error);
        Assert.True(p is not null, error);
        Assert.Equal(member, p!.Value.Member);
        Assert.Equal(spelled, NetworkPragma.Spell(p.Value.Member, p.Value.Value));
    }

    [Fact]
    public void A_string_keeps_every_character()
    {
        var text = "it's $5\n\r\t\u0001 é";
        var spelled = NetworkPragma.Spell("SymbolComment", PragmaValue.Text(text));
        Assert.DoesNotContain('\n', spelled);
        Assert.Equal(text, NetworkPragma.Parse(spelled.Substring(1, spelled.Length - 2), out _)!.Value.Value.AsText);
    }

    [Theory]
    [InlineData("OutputParam.Names ['']", "no `:=`")]
    [InlineData("1x := 2", "no member name")]
    [InlineData("A := ", "no value")]
    [InlineData("A := 'open", "unclosed string")]
    [InlineData("A := [1, [2]]", "a list inside a list")]
    [InlineData("A := 1 2", "one member and one value")]
    // A `$hh` escape is two hex digits, exactly as the LSP's port reads it: int.TryParse's HexNumber took a space beside
    // one digit, so `'$A '` decoded to a line feed on push while the editor refused it (gate 2-3 review).
    [InlineData("A := ['$A ']", "the escape '$A'")]
    [InlineData("A := ['$ A']", "the escape '$ '")]
    [InlineData("A := ['$+1']", "the escape '$+'")]
    public void A_malformed_pragma_is_refused_by_name(string inner, string why)
    {
        Assert.Null(NetworkPragma.Parse(inner, out var error));
        Assert.Contains(why, error);
    }

    // ── S1: a bit operator connected by a stored output slot ─────────────────────────────────────

    /// <summary>The editor's AND (census 0.1, 7 networks + the S4 network): <c>OutputParam.Names = ['']</c>,
    /// <c>Types = ['BOOL']</c>, main output 0, its consumer connected by slot 0.</summary>
    static Box StoredAnd(params Node[] inputs) =>
        Op("AND", inputs) with
        {
            MainOutputIndex = 0, ConnectedSlot = 0, OutputTypes = new[] { "BOOL" }, HasEnoOutput = false,
            Members = NwlMembers.Of((NetworkMembers.OutputNames, PragmaValue.Texts(new[] { "" }))),
        };

    [Fact]
    public void S1_a_bit_operator_storing_an_output_is_spelled_by_its_names_and_types()
    {
        var model = Fbd1(Set(StoredAnd(L("a"), L("b")), T("out")));
        Assert.Equal(Src("out := (a AND b){OutputParam.Names := ['']}{OutputParam.Types := ['BOOL']};"),
            NetworkTextWriter.Write(model, Scope));
    }

    [Fact]
    public void S1_reads_back_connected_by_the_stored_slot()
    {
        var read = NetworkTextReader.Read(Src("out := (a AND b){OutputParam.Names := ['']}{OutputParam.Types := ['BOOL']};"), Scope);
        Assert.True(read.Ok, string.Join("\n", read.Diagnostics.Select(d => d.Message)));
        var box = Assert.IsType<Box>(Assert.IsType<Assign>(read.Body!.Networks[0].Trees[0]).Value);
        Assert.Equal((0, 0), (box.ConnectedSlot, box.MainOutputIndex));
        Assert.Equal(new[] { "" }, box.Members![NetworkMembers.OutputNames]!.AsTexts);
        Assert.Equal(new[] { "BOOL" }, box.OutputTypes);
        Assert.Null(NetworkModelOracle.Check("S1", Fbd1(Set(StoredAnd(L("a"), L("b")), T("out")))).Reason);
    }

    [Fact]
    public void S1_in_call_form_and_on_the_NOT_box()
    {
        var not = Call("NOT", new[] { In(L("a")) }, main: 0, connected: 0, types: new[] { "BOOL" }, eno: false) with
        {
            Members = NwlMembers.Of((NetworkMembers.OutputNames, PragmaValue.Texts(new[] { "" }))),
        };
        Assert.Equal(Src("out := NOT(a){OutputParam.Names := ['']}{OutputParam.Types := ['BOOL']};"),
            NetworkTextWriter.Write(Fbd1(Set(not, T("out"))), Scope));
        Assert.Null(NetworkModelOracle.Check("S1 NOT", Fbd1(Set(not, T("out")))).Reason);
    }

    [Fact]
    public void A_plain_bit_operator_spells_no_pragma()
    {
        var model = Fbd1(Set(Op("AND", L("a"), L("b")) with { Members = NwlMembers.Of((NetworkMembers.OutputNames, PragmaValue.Texts(Array.Empty<string>()))) }, T("out")));
        Assert.Equal(Src("out := (a AND b);"), NetworkTextWriter.Write(model, Scope));
    }

    [Fact]
    public void A_stored_slot_the_names_do_not_give_is_refused_by_name()
    {
        // Connected by slot 0 and storing no output: the text reads it connected by none.
        var model = Fbd1(Set(Op("AND", L("a"), L("b")) with { ConnectedSlot = 0, MainOutputIndex = 0, HasEnoOutput = false }, T("out")));
        Assert.Equal("a bit operator box connected by an unspellable output slot",
            Assert.ThrowsAny<UnrepresentableBodyException>(() => NetworkTextWriter.Write(model, Scope)).Reason);
    }

    // ── a call's whole output list ───────────────────────────────────────────────────────────────

    [Fact]
    public void A_call_keeps_its_unconnected_output_pins()
    {
        var ton = Fb("t1", new[] { In(L("go"), "IN") }, type: "TON") with
        {
            OutputTypes = new[] { "BOOL", "TIME" },
            Members = NwlMembers.Of((NetworkMembers.OutputNames, PragmaValue.Texts(new[] { "Q", "ET" }))),
        };
        var text = NetworkTextWriter.Write(Fbd1(ton), Scope);
        Assert.Equal(Src("t1(IN := go){OutputParam.Names := ['Q', 'ET']}{OutputParam.Types := ['BOOL', 'TIME']};"), text);
        Assert.Null(NetworkModelOracle.Check("TON outputs", Fbd1(ton)).Reason);
    }

    // ── refusals ─────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("out := (a AND b){Nonsense := 1};", ConflictCodes.NetworkUnsupported, "no member of a box")]
    [InlineData("out := (a AND b){OutputParam.Names := 1};", ConflictCodes.NetworkBadExpression, "takes a list of strings")]
    [InlineData("out := (a AND b){OutputParam.Names := [1]};", ConflictCodes.NetworkBadExpression, "takes a list of strings")]
    [InlineData("out := (a AND b){OutputParam.Names := ['']}{OutputParam.Names := ['']};", ConflictCodes.NetworkDuplicateName, "twice")]
    [InlineData("out := (a AND b){OutputParam.Names ['']};", ConflictCodes.NetworkParse, "no `:=`")]
    [InlineData("out := (a AND b){OutputParam.Names := [''];", ConflictCodes.NetworkParse, "unclosed pragma")]
    public void A_pragma_the_table_does_not_hold_is_refused_by_name(string statement, string code, string why)
    {
        var read = NetworkTextReader.Read(Src(statement), Scope);
        Assert.False(read.Ok);
        var d = read.Diagnostics.First();
        Assert.Equal(code, d.Code);
        Assert.Contains(why, d.Message);
    }
}
