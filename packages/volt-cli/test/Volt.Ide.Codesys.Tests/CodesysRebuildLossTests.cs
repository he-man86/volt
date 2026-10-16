using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.Network;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// openspec <c>ld-fbd-coverage</c> 2.2, design "The interim loss window, made visible", on CODESYS: a push that REBUILDS
/// a changed network (every changed network is torn down and built again from its text) names, in one bridge warning,
/// each member the IDE stored that the rebuilt items do not hold — <c>Flags.Fixed</c>, <c>Operand.Boolean</c>, the
/// <c>Address</c> archive sentinel — and how many of its stored values each lost; judged against what the rebuild BUILT
/// (gate 2-2), so a negated contact's <c>Fixed</c>, which the vendor sets with the negation (vendor-facts
/// <c>nwl-flags-fixed</c>), is no loss. A network whose text did not change is kept and says nothing. Through
/// <c>CodesysNetworkWriter.Write</c>, the production entry.
/// </summary>
public class CodesysRebuildLossTests
{
    sealed class Holder
    {
        public Holder(object implementation) => Implementation = implementation;
        public object Implementation { get; }
    }

    /// <summary>A rung as an IDE draws it: <c>target := (a AND b)</c> with the editor's stored values — the box and both
    /// contacts <c>Fixed</c>, the target and contacts <c>Boolean</c>, one contact holding the address sentinel, every
    /// item an id.</summary>
    static Nwl.BoxTreeAssign DrawnRung(string target, long firstId, bool negateB = false)
    {
        var id = firstId;
        Nwl.BoxTreeOperand Contact(string name, bool sentinel, bool negated = false) => new()
        {
            Id = id++,
            Operand = new Nwl.Operand
            {
                OperandExpr = name, Boolean = true, Id = id++, Flags = new Nwl.Flags { Negation = negated, Fixed = true },
                StoredAddress = sentinel ? RebuildLoss.AddressSentinel : "",
            },
        };
        var and = new Nwl.BoxTreeBox
        {
            Id = id++, BoxType = "AND", Flags = new Nwl.Flags { Fixed = true },
            InputItemList = new object[] { Contact("a", sentinel: true), Contact("b", sentinel: false, negated: negateB) },
        };
        var rung = new Nwl.BoxTreeAssign { Id = id++, RValue = and };
        rung.Outputs.List.Add(new Nwl.Operand { OperandExpr = target, IsLValue = true, Boolean = true, Id = id });
        return rung;
    }

    static string CaptureStdErr(Action act)
    {
        var original = Console.Error;
        var buffer = new StringWriter();
        Console.SetError(buffer);
        try { act(); } finally { Console.SetError(original); }
        return buffer.ToString();
    }

    static string Push(Nwl.NWLImplementationObject impl, Func<string, string> edit)
    {
        var shown = CodesysNetworkReader.ReadShown(impl, BodyLanguage.Ld);
        var scope = new NetworkScope(new[] { "a", "b", "c", "x1", "x2", "x3", "x4", "x5", "x6", "x7" },
            Array.Empty<string>(), new Dictionary<string, string>());
        var text = edit(NetworkTextWriter.WritePulled(shown, scope));
        var read = NetworkTextReader.Read(text, scope);
        Assert.True(read.Ok, string.Join("\n", read.Diagnostics.Select(d => d.Message)) + "\n\n" + text);
        return CaptureStdErr(() => CodesysNetworkWriter.Write(new Holder(impl), read.Body!, scope));
    }

    static Nwl.NWLImplementationObject Body(params Nwl.BoxTreeAssign[] rungs)
    {
        var impl = new Nwl.NWLImplementationObject { DefaultViewMode = "Ld" };
        impl.NetworkList.AddRange(rungs.Select(r => new Nwl.Network().With(r)));
        return impl;
    }

    /// <summary>The sixth network changes (an operand swapped), so it is rebuilt: its stored values are named, counted —
    /// 3 Fixed (the box, both contacts), 3 Boolean (both contacts, the target), 1 address sentinel. The items' Ids are not named: the IDE mints them itself (vendor-facts nwl-item-id, DIALECT N29).</summary>
    [Fact]
    public void A_rebuilt_network_names_each_stored_value_the_rebuild_resets()
    {
        var impl = Body(DrawnRung("x1", 10), DrawnRung("x2", 20), DrawnRung("x3", 30), DrawnRung("x4", 40),
            DrawnRung("x5", 50), DrawnRung("x6", 60));

        var said = Push(impl, t => t.Replace("x6 := a AND b;", "x6 := a AND c;"));

        Assert.Contains(
            "CODESYS: network 6 is rebuilt from its text, which does not carry these stored values, and the rebuilt network " +
            "does not hold them: Flags.Fixed ×3 (vendor-facts row nwl-flags-fixed), Operand.Boolean ×3 " +
            "(vendor-facts row nwl-operand-boolean), Operand.Address ×1 (vendor-facts row nwl-address-sentinel) (openspec", said);
    }

    /// <summary>A NEGATED contact's <c>Fixed</c> comes back: the vendor sets it with the negation the writer sets
    /// (vendor-facts <c>nwl-flags-fixed</c>, CODESYS nwl@built) — so of the three stored <c>true</c>s only the box's and
    /// the plain contact's are named (gate 2-2: a vendor-neutral "non-default" test named it as lost).</summary>
    [Fact]
    public void A_negated_contacts_fixed_the_vendor_sets_again_is_not_named()
    {
        var impl = Body(DrawnRung("x1", 10), DrawnRung("x2", 20), DrawnRung("x3", 30), DrawnRung("x4", 40),
            DrawnRung("x5", 50), DrawnRung("x6", 60, negateB: true));

        var said = Push(impl, t => t.Replace("x6 := a AND NOT b;", "x6 := c AND NOT b;"));

        Assert.Contains("does not hold them: Flags.Fixed ×2 (vendor-facts row nwl-flags-fixed), Operand.Boolean ×3", said);
    }

    /// <summary>AN ENABLED PROGRAM CALL'S SECOND NULL OUTPUT SLOT (gate 2-3 review): the IDE draws one with two null
    /// slots for its one output name <c>['ENO']</c> (10 corpus boxes, DIALECT N37), and a rebuild lays out one slot per
    /// name — so the second slot went with every rebuild of its network, and nothing named it.</summary>
    [Fact]
    public void A_rebuilt_enabled_program_call_names_the_output_slot_it_drops()
    {
        static Nwl.BoxTreeAssign Rung(string target)
        {
            var call = new Nwl.BoxTreeBox
            {
                BoxType = "Prg", En = true, Eno = true,
                InputParams = new Nwl.ParamList { Names = new[] { "EN" }, Types = new[] { "BOOL" } },
                InputItemList = new object[] { new Nwl.BoxTreeOperand { Operand = new Nwl.Operand { OperandExpr = "a", Boolean = true } } },
                OutputParams = new Nwl.ParamList { Names = new[] { "ENO" }, Types = new[] { "BOOL" } },
            };
            call.Outputs.List.Add(null!);
            call.Outputs.List.Add(null!);
            var rung = new Nwl.BoxTreeAssign { RValue = call };
            rung.Outputs.List.Add(new Nwl.Operand { OperandExpr = target, IsLValue = true, Boolean = true });
            return rung;
        }
        var impl = Body(DrawnRung("x1", 10), DrawnRung("x2", 20), DrawnRung("x3", 30), DrawnRung("x4", 40),
            DrawnRung("x5", 50), Rung("x6"));

        var said = Push(impl, t => t.Replace("x6 :=", "x7 :="));

        Assert.Contains("OutputItemList.OutputItems ×1 (vendor-facts row nwl-output-param-names)", said);
    }

    /// <summary>A CALL'S STORED OUTPUT LIST (2R.3 B7, design "2R.3, as built": "lost on rebuild (named by RebuildLoss),
    /// never guessed"): a TON storing <c>['Q', 'ET']</c> / <c>['BOOL', 'TIME']</c> with only Q wired is rebuilt from the
    /// text's own pins, so its ET slot and both stored types go — and the warning says so. Before, the candidates held
    /// only the function result <c>'   '</c>, and this rebuild said nothing.</summary>
    [Fact]
    public void A_rebuilt_call_names_its_stored_output_list_and_types()
    {
        static Nwl.BoxTreeBox Call(string input)
        {
            var call = new Nwl.BoxTreeBox
            {
                BoxType = "TON",
                Instance = new Nwl.Operand { OperandExpr = "t1", IsInstance = true, Type = "TON" },
                InputItemList = new object[] { Nwl.Leaf(input), Nwl.Leaf("b") },
                InputParams = new Nwl.ParamList { Names = new[] { "IN", "PT" }, Types = new[] { "BOOL", "TIME" } },
                OutputParams = new Nwl.ParamList { Names = new[] { "Q", "ET" }, Types = new[] { "BOOL", "TIME" } },
            };
            call.Outputs.List.Add(new Nwl.Operand { OperandExpr = "x6", IsLValue = true });
            call.Outputs.List.Add(null!);
            return call;
        }
        var impl = new Nwl.NWLImplementationObject { DefaultViewMode = "Fbd" };
        impl.NetworkList.Add(new Nwl.Network().With(Call("a")));
        var shown = CodesysNetworkReader.ReadShown(impl, BodyLanguage.Fbd);
        var scope = new NetworkScope(new[] { "a", "b", "c", "x6", "t1" }, Array.Empty<string>(),
            new Dictionary<string, string> { ["t1"] = "TON" });
        var pulled = NetworkTextWriter.WritePulled(shown, scope);
        var edited = pulled.Replace("IN := a", "IN := c");
        Assert.NotEqual(pulled, edited);
        var read = NetworkTextReader.Read(edited, scope);
        Assert.True(read.Ok, string.Join("\n", read.Diagnostics.Select(d => d.Message)) + "\n\n" + edited);

        var said = CaptureStdErr(() => CodesysNetworkWriter.Write(new Holder(impl), read.Body!, scope));

        Assert.Contains("OutputParam.Names ×1 (vendor-facts row nwl-output-param-names)", said);
        Assert.Contains("OutputParam.Types ×1 (vendor-facts row nwl-param-types)", said);
    }

    /// <summary>An unchanged network is kept — nothing is rebuilt and nothing is said about it; a header-only edit is
    /// written in place, its items untouched, and says nothing either.</summary>
    [Fact]
    public void A_kept_or_retitled_network_says_nothing()
    {
        var impl = Body(DrawnRung("x1", 10), DrawnRung("x2", 20), DrawnRung("x3", 30), DrawnRung("x4", 40),
            DrawnRung("x5", 50), DrawnRung("x7", 70));

        var said = Push(impl, t => t.Replace("NETWORK\n  x7 :=", "NETWORK TITLE: \"seven\"\n  x7 :="));

        Assert.DoesNotContain("is rebuilt from its text", said);
        Assert.Equal("seven", ((Nwl.Network)impl.NetworkList[5]).Title);
        Assert.Empty(((Nwl.Network)impl.NetworkList[5]).Calls);
    }
}
