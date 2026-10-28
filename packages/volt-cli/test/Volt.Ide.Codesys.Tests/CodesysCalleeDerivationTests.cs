using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Network;
using Volt.Engine.Item;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// openspec <c>ld-fbd-coverage</c> 2R.4 (B7 D), on CODESYS: a call box Volt builds carries the <c>CallType</c> and input
/// names the editor gives a drawn one, derived from the callee's declaration (<see cref="NetworkScope.Callee"/>).
/// Measured live (SP21 3.5.21.40, simulation, design "2R.4"): without them a FUNCTION's box and a METHOD's box do not
/// compile ("The assignment source is incorrect."), with them they run as drawn — while an FB call, a PROGRAM call and a
/// conversion run the same with the fresh <c>None</c>, so those are left to the vendor. Through
/// <c>CodesysNetworkWriter.Write</c>, the production entry.
/// </summary>
public class CodesysCalleeDerivationTests
{
    sealed class Holder
    {
        public Holder(object implementation) => Implementation = implementation;
        public object Implementation { get; }
    }

    static readonly Dictionary<string, string> Items = new(StringComparer.OrdinalIgnoreCase)
    {
        ["AwF"] = "FUNCTION AwF : INT\nVAR_INPUT\n\ti : INT;\nEND_VAR",
        ["F_split"] = "FUNCTION F_split : INT\nVAR_INPUT\n\tsource : INT;\nEND_VAR\nVAR_OUTPUT\n\tdoubled : INT;\nEND_VAR",
        ["FB_M"] = "FUNCTION_BLOCK FB_M\nVAR_INPUT\n\trun : BOOL;\nEND_VAR",
        ["P_Sub"] = "PROGRAM P_Sub\nVAR_INPUT\n\tgo : BOOL;\nEND_VAR",
    };

    const string Own = "PROGRAM P\nVAR\n\tv : INT;\n\ty : INT;\n\ttwice : INT;\n\tgo : BOOL;\n\tx : BOOL;\n\tfbm : FB_M;\n\ttxt : STRING;\nEND_VAR";

    /// <summary>Standard's LEN as the driver reads its signature (the result a self-named output).</summary>
    static readonly Volt.Engine.Library.LibSignature[] Libraries =
    {
        new("LEN", "standard, 3.5.18.0 (system)", "Function", new[] { new Volt.Engine.Library.LibVar("STR", "STRING(255)") },
            new[] { new Volt.Engine.Library.LibVar("LEN", "INT") }, Array.Empty<Volt.Engine.Library.LibVar>(),
            Array.Empty<Volt.Engine.Library.LibVar>(), null, null),
    };

    static Nwl.BoxTreeBox Built(string statement)
    {
        var scope = NetworkScope.FromDeclarations(Own, n => Items.TryGetValue(n, out var d) ? d : null,
            () => Array.Empty<string>(), n => Items.ContainsKey(n) ? ItemKind.Kinds.Pou : null, Scopes.RefusedPouName,
            n => Volt.Engine.Library.LibraryFunctions.Of(Libraries, n));
        // As the push validates it (StNetworkGate: the input names are derived there, for either driver).
        var read = StNetworkGate.Validate($"%LANGUAGE FBD\n%NETWORK\n{statement}\n", scope);
        Assert.True(read.Ok, string.Join("\n", read.Diagnostics.Select(d => d.Message)));
        var impl = new Nwl.NWLImplementationObject { DefaultViewMode = "Fbd" };
        CodesysNetworkWriter.Write(new Holder(impl), read.Body!, scope);
        var tree = ((Nwl.Network)impl.NetworkList.Single()).GetTree(0);
        return tree switch
        {
            Nwl.BoxTreeAssign a => (Nwl.BoxTreeBox)a.RValue!,
            Nwl.BoxTreeBox b => b,
            _ => throw new InvalidOperationException(tree?.GetType().Name),
        };
    }

    static string[] InputNames(Nwl.BoxTreeBox b) => ((Nwl.ParamList)b.InputParams!).Names;
    static string[] OutputNames(Nwl.BoxTreeBox b) => ((Nwl.ParamList)b.OutputParams!).Names;

    [Fact]
    public void A_positional_function_call_is_built_with_the_function_call_type_and_its_input_names()
    {
        var box = Built("y := AwF(v);");
        Assert.Equal(Nwl.Operator.Function, box.CallType);
        Assert.Equal(new[] { "i" }, InputNames(box));
        Assert.Equal(new[] { "   " }, OutputNames(box));   // the result pin, as drawn
    }

    /// <summary>A FUNCTION with a named output pin beside its result (the `ng_box_output_arrow` shape, which the build
    /// refused while the box carried neither).</summary>
    [Fact]
    public void A_function_call_with_an_output_pin_gets_them_too()
    {
        var box = Built("twice := F_split(v, doubled => y).OUT;");
        Assert.Equal(Nwl.Operator.Function, box.CallType);
        Assert.Equal(new[] { "source" }, InputNames(box));
        Assert.Equal(new[] { "   ", "doubled" }, OutputNames(box));
        var slots = box.Outputs.List;
        Assert.Null(slots[0]);                                        // the result: the vendor's null, read by the coil
        Assert.Equal("y", ((Nwl.Operand)slots[1]!).OperandExpr);      // the named pin in its own slot
    }

    /// <summary>An unwired VAR_OUTPUT is drawn too: the editor lists every one (RuntimeGuard, 4 of 4).</summary>
    [Fact]
    public void An_unwired_output_is_listed_too() =>
        Assert.Equal(new[] { "   ", "doubled" }, OutputNames(Built("twice := F_split(v).OUT;")));

    /// <summary>ld-fbd-coverage 2R.4b: a LIBRARY function's box, positional or named, is built as the editor draws it —
    /// CallType Function, its input named, the result pin — from the IDE's library signature. Without it CODESYS answers
    /// "The assignment source is incorrect." (`ng_m_library_function`, `…_named`; bakon-nano's REPLACE/DELETE).</summary>
    [Theory]
    [InlineData("y := LEN(txt);")]
    [InlineData("y := LEN(STR := txt);")]
    public void A_library_function_call_is_built_with_the_function_call_type_and_its_input_names(string statement)
    {
        var box = Built(statement);
        Assert.Equal(Nwl.Operator.Function, box.CallType);
        Assert.Equal(new[] { "STR" }, InputNames(box));
        Assert.Equal(new[] { "   " }, OutputNames(box));
    }

    [Fact]
    public void A_method_call_is_built_with_the_method_call_type()
    {
        var box = Built("x := fbm.Start(run := go);");
        Assert.Equal(Nwl.Operator.Method, box.CallType);
        Assert.Equal(new[] { "run" }, InputNames(box));
    }

    /// <summary>An FB call, a PROGRAM call and a conversion run as drawn with the fresh value (measured): the writer
    /// leaves them to the vendor.</summary>
    [Theory]
    [InlineData("FB_M(FB := fbm, run := go);")]
    [InlineData("P_Sub(go := go);")]
    [InlineData("y := TO_INT(v);")]
    public void Every_other_call_keeps_the_fresh_call_type(string statement) =>
        Assert.False(Built(statement).CallTypeSet);
}
