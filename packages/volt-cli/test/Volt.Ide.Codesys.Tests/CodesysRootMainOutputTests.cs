using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Engine.Item;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// A ROOT BOX'S MAIN OUTPUT (openspec <c>network-text-one-to-one</c> F3): the index of the first null in its output list. A
/// root with no closer is slot 0, <c>.NAME</c> names any other, and an FB box a push builds stores its declared output list
/// with the null at that slot, as the 43 corpus root FB boxes with an output list do (the 10 with none declare no output).
/// </summary>
public class CodesysRootMainOutputTests
{
    sealed class Holder
    {
        public Holder(object implementation) => Implementation = implementation;
        public object Implementation { get; }
    }

    static readonly Dictionary<string, string> Items = new(StringComparer.OrdinalIgnoreCase)
    {
        ["FB_C"] = "FUNCTION_BLOCK FB_C\nVAR_INPUT\n\tCU : BOOL;\n\tPV : INT;\nEND_VAR\nVAR_OUTPUT\n\tQ : BOOL;\n\tCV : INT;\nEND_VAR",
        ["FB_N"] = "FUNCTION_BLOCK FB_N\nVAR_INPUT\n\tCU : BOOL;\nEND_VAR",
    };

    const string Own = "PROGRAM P\nVAR\n\ta : BOOL;\n\te : BOOL;\n\tx : BOOL;\n\tn : INT;\n\tc2 : FB_C;\n\tn1 : FB_N;\n\tun : Unknown_FB;\nEND_VAR";

    static NetworkScope Scope() => NetworkScope.FromDeclarations(Own, n => Items.TryGetValue(n, out var d) ? d : null,
        () => Array.Empty<string>(), n => Items.ContainsKey(n) ? ItemKind.Kinds.Pou : null, Scopes.RefusedPouName, _ => null);

    static string Text(string statement) => $"%LANGUAGE FBD\n%NETWORK\n{statement}\n";

    static Nwl.NWLImplementationObject Pushed(string statement)
    {
        var scope = Scope();
        var read = StNetworkGate.Validate(Text(statement), scope);
        Assert.True(read.Ok, string.Join("\n", read.Diagnostics.Select(d => d.Message)));
        var impl = new Nwl.NWLImplementationObject { DefaultViewMode = "Fbd" };
        CodesysNetworkWriter.Write(new Holder(impl), read.Body!, scope);
        return impl;
    }

    static Nwl.BoxTreeBox Root(Nwl.NWLImplementationObject impl) => (Nwl.BoxTreeBox)((Nwl.Network)impl.NetworkList.Single()).GetTree(0)!;

    static string[] Names(Nwl.BoxTreeBox b) => ((Nwl.ParamList)b.OutputParams!).Names;

    /// <summary>Each stored slot: <c>null</c> the vendor's null, else the operand's text ("" an unwired pin).</summary>
    static string?[] Slots(Nwl.BoxTreeBox b) => b.Outputs.List.Cast<object?>().Select(o => o is null ? null : ((Nwl.Operand)o).OperandExpr).ToArray();

    [Fact]
    public void A_root_with_no_closer_stores_its_output_list_with_the_null_at_slot_0()
    {
        var box = Root(Pushed("c2(CU := a, PV := 5);"));
        Assert.Equal(new[] { "Q", "CV" }, Names(box));
        Assert.Equal(new[] { null, "" }, Slots(box));
    }

    [Fact]
    public void A_root_closed_by_a_name_stores_the_null_at_that_slot()
    {
        var box = Root(Pushed("c2(CU := a, PV := 5).CV;"));
        Assert.Equal(new[] { "Q", "CV" }, Names(box));
        Assert.Equal(new[] { "", null }, Slots(box));
    }

    [Fact]
    public void A_root_closed_by_a_name_keeps_a_pin_wired_beside_it()
    {
        var box = Root(Pushed("c2(CU := a, PV := 5, Q => x).CV;"));
        Assert.Equal(new[] { "x", null }, Slots(box));
    }

    [Fact]
    public void A_wired_pin_past_the_main_slot_stands_in_its_own_slot()
    {
        var box = Root(Pushed("c2(CU := a, PV := 5, CV => n);"));
        Assert.Equal(new[] { "Q", "CV" }, Names(box));
        Assert.Equal(new[] { null, "n" }, Slots(box));
    }

    [Fact]
    public void A_root_showing_ENO_stores_the_ENO_and_every_declared_output()
    {
        var box = Root(Pushed("c2(EN := e, CU := a, PV := 5).ENO;"));
        Assert.Equal(new[] { "ENO", "Q", "CV" }, Names(box));
        Assert.Equal(new[] { null, "", "" }, Slots(box));
    }

    /// <summary>The 10 corpus root boxes with no output list: their FB declares no output.</summary>
    [Fact]
    public void An_FB_declaring_no_output_stores_no_list()
    {
        var box = Root(Pushed("n1(CU := a);"));
        Assert.Empty(Slots(box));
    }

    /// <summary>A callee no declaration states: no list is guessed.</summary>
    [Fact]
    public void An_FB_no_declaration_states_stores_no_guessed_list()
    {
        var box = Root(Pushed("un(CU := a);"));
        Assert.Empty(Slots(box));
    }

    static Nwl.NWLImplementationObject Stored(int index, params string[] names)
    {
        var box = new Nwl.BoxTreeBox
        {
            BoxType = "FB_C",
            Instance = new Nwl.Operand { OperandExpr = "c2", IsInstance = true, Type = "FB_C" },
            InputItemList = new object[] { Nwl.Leaf("a") },
            InputParams = new Nwl.ParamList { Names = new[] { "CU" }, Types = new[] { "BOOL" } },
            OutputParams = new Nwl.ParamList { Names = names, Types = names.Select(_ => "").ToArray() },
            MainOutputIndex = index,
        };
        for (var i = 0; i < names.Length; i++)
            box.Outputs.List.Add(i == index ? null! : new Nwl.Operand { OperandExpr = "", IsLValue = true });
        var impl = new Nwl.NWLImplementationObject { DefaultViewMode = "Fbd" };
        impl.NetworkList.Add(new Nwl.Network().With(box));
        return impl;
    }

    /// <summary>The drop this finding names: the stored index pulled as a text with no closer.</summary>
    [Fact]
    public void A_stored_main_slot_past_the_first_pulls_as_its_name()
    {
        var text = StNetworkWriter.WritePulled(CodesysNetworkReader.ReadShown(Stored(1, "Q", "CV"), BodyLanguage.Fbd), Scope());
        Assert.Contains("c2(CU := a).CV;\n", text);
    }

    [Fact]
    public void A_stored_main_slot_0_pulls_with_no_closer()
    {
        var text = StNetworkWriter.WritePulled(CodesysNetworkReader.ReadShown(Stored(0, "Q", "CV"), BodyLanguage.Fbd), Scope());
        Assert.Contains("c2(CU := a);\n", text);
    }

    /// <summary>The reader and a text read hold one model: an unchanged pull is no change for the push.</summary>
    [Fact]
    public void A_stored_main_slot_and_its_text_hold_one_model()
    {
        var scope = Scope();
        var shown = CodesysNetworkReader.ReadShown(Stored(1, "Q", "CV"), BodyLanguage.Fbd);
        var read = StNetworkGate.Validate(StNetworkWriter.WritePulled(shown, scope), scope);
        Assert.True(read.Ok, string.Join("\n", read.Diagnostics.Select(d => d.Message)));
        var pushed = (Box)read.Body!.Networks[0].Trees[0];
        var held = (Box)shown.Networks[0].Trees[0];
        Assert.Equal(held.ConnectedSlot, pushed.ConnectedSlot);
        Assert.Equal(held.MainOutputName, pushed.MainOutputName);
    }

    /// <summary>A box showing ENO is closed by <c>.ENO</c>, so a main slot past it has no second closer: named, never dropped.</summary>
    [Fact]
    public void A_stored_main_slot_past_a_shown_ENO_is_unsupported_by_name()
    {
        var impl = Stored(1, "ENO", "Q");
        Root(impl).Eno = true;
        var text = StNetworkWriter.WritePulled(CodesysNetworkReader.ReadShown(impl, BodyLanguage.Fbd), Scope());
        Assert.Contains("%UNSUPPORTED \"a box showing ENO read by another output\"", text);
    }
}
