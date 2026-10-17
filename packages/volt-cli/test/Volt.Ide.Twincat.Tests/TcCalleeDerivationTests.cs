using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Volt.Engine.Format.Network;
using Volt.Engine.Item;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// openspec <c>ld-fbd-coverage</c> 2R.4 (B7 D), on TwinCAT: a call box the native builder builds carries the members
/// CODESYS's writer derives from the callee's declaration (<see cref="NetworkScope.Callee"/>) — a FUNCTION's
/// <c>CallType Function</c>, its input names and its drawn output list (the result pin <c>'   '</c> and every
/// <c>VAR_OUTPUT</c>), a METHOD's <c>CallType Method</c>. The two vendors ship one NWL model (DIALECT N1), so the box
/// Volt builds is the same box on both (CodesysCalleeDerivationTests is the CODESYS half). Through
/// <see cref="TcArchiveBuilder.Body"/>, the create's entry.
/// </summary>
public class TcCalleeDerivationTests
{
    static readonly Dictionary<string, string> Items = new(StringComparer.OrdinalIgnoreCase)
    {
        ["AwF"] = "FUNCTION AwF : INT\nVAR_INPUT\n\ti : INT;\nEND_VAR",
        ["F_split"] = "FUNCTION F_split : INT\nVAR_INPUT\n\tsource : INT;\nEND_VAR\nVAR_OUTPUT\n\tdoubled : INT;\nEND_VAR",
        ["FB_M"] = "FUNCTION_BLOCK FB_M\nVAR_INPUT\n\trun : BOOL;\nEND_VAR",
    };

    const string Own = "PROGRAM P\nVAR\n\tv : INT;\n\ty : INT;\n\ttwice : INT;\n\tgo : BOOL;\n\tx : BOOL;\n\tfbm : FB_M;\nEND_VAR";

    static XElement Built(string statement)
    {
        var scope = NetworkScope.FromDeclarations(Own, n => Items.TryGetValue(n, out var d) ? d : null,
            () => Array.Empty<string>(), n => Items.ContainsKey(n) ? ItemKind.Kinds.Pou : null, Scopes.RefusedPouName);
        // As the push validates it (NetworkTextGate: the input names are derived there, for either driver).
        var read = NetworkTextGate.Validate($"IMPLEMENTATION FBD\nNETWORK\n  {statement}\nEND_NETWORK\n", scope);
        Assert.True(read.Ok, string.Join("\n", read.Diagnostics.Select(d => d.Message)));
        var impl = TcArchive.Root(TcArchiveBuilder.Body(read.Body!, scope))!;
        return impl.Descendants("o").First(o => TcArchive.Str(o, "BoxType") is not null);
    }

    static string CallType(XElement box) =>
        box.Elements("v").Single(v => (string?)v.Attribute("n") == "CallType").Value;

    static IReadOnlyList<string> Names(XElement box, string param) => TcArchive.Strings(TcArchive.Obj(box, param)!, "Names");

    [Fact]
    public void A_positional_function_call_is_built_with_the_function_call_type_and_its_input_names()
    {
        var box = Built("y := AwF(v);");
        Assert.Equal("Function", CallType(box));
        Assert.Equal(new[] { "i" }, Names(box, "InputParam"));
        Assert.Equal(new[] { "   " }, Names(box, "OutputParam"));   // the result pin, as drawn
    }

    [Fact]
    public void A_function_call_with_an_output_pin_gets_them_too()
    {
        var box = Built("twice := F_split(v, doubled => y);");
        Assert.Equal("Function", CallType(box));
        Assert.Equal(new[] { "source" }, Names(box, "InputParam"));
        Assert.Equal(new[] { "   ", "doubled" }, Names(box, "OutputParam"));
        var slots = TcArchive.Slots(TcArchive.Obj(box, "OutputItems"), "OutputItems");
        Assert.Null(slots[0]);                                   // the result: the vendor's null, read by the coil
        Assert.Equal("y", TcArchive.Str(slots[1]!, "Operand"));  // the named pin in its own slot
    }

    [Fact]
    public void An_unwired_output_is_listed_too() =>
        Assert.Equal(new[] { "   ", "doubled" }, Names(Built("twice := F_split(v);"), "OutputParam"));

    [Fact]
    public void A_method_call_is_built_with_the_method_call_type()
    {
        var box = Built("x := fbm.Start(run := go);");
        Assert.Equal("Method", CallType(box));
        Assert.Equal(new[] { "run" }, Names(box, "InputParam"));
    }

    /// <summary>A call the scope names no callee for keeps the CallType TwinCAT's own import stored for it (the native
    /// corpus, <see cref="TcArchiveBuilder.Operators"/>).</summary>
    [Theory]
    [InlineData("fbm(run := go);", "FunctionBlock")]
    [InlineData("y := TO_INT(v);", "Conversion")]
    [InlineData("y := v ADD 1;", "Add")]
    public void Every_other_call_keeps_the_call_type_TwinCAT_stores(string statement, string callType) =>
        Assert.Equal(callType, CallType(Built(statement)));
}
