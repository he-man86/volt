using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Volt.Engine.Library;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// ld-fbd-coverage 2R.4, B7: a call box's <c>CallType</c> and its input formal names are DERIVED on push from the
/// callee's declaration, as the editor does when it draws the box. Measured live (CODESYS SP21 3.5.21.40, simulation,
/// openspec design "2R.4"): a project FUNCTION's box compiles only with <c>CallType Function</c> AND its input names —
/// with neither, or with the names alone, the build answers "The assignment source is incorrect."; with the CallType
/// alone, "Function 'AwF' requires exactly '1' inputs". Every other call kind Volt builds without a CallType compiles
/// and runs as drawn (an FB call, a conversion), so the derivation answers for a FUNCTION only.
/// </summary>
public class CalleeDerivationTests
{
    const string AwF = "FUNCTION AwF : INT\nVAR_INPUT\n\ti : INT;\nEND_VAR";
    const string Split = "FUNCTION F_split : INT\nVAR_INPUT\n\tsource : INT;\nEND_VAR\nVAR_IN_OUT\n\tacc : INT;\nEND_VAR\n" +
                         "VAR_INPUT\n\tscale : INT;\nEND_VAR\nVAR_OUTPUT\n\tdoubled : INT;\nEND_VAR\nVAR\n\tlocal : INT;\nEND_VAR";
    const string Block = "FUNCTION_BLOCK FB_Motor\nVAR_INPUT\n\trun : BOOL;\nEND_VAR";
    const string Prog = "PROGRAM P_Main\nVAR_INPUT\n\tgo : BOOL;\nEND_VAR";
    const string Commented = "(* FUNCTION_BLOCK no *)\n// PROGRAM no\nFUNCTION {attribute 'x'} F_c : BOOL\nVAR_INPUT\n\ta, b : BOOL; // c : BOOL;\nEND_VAR";

    static readonly Dictionary<string, string> Items = new(StringComparer.OrdinalIgnoreCase)
    {
        ["AwF"] = AwF, ["F_split"] = Split, ["FB_Motor"] = Block, ["P_Main"] = Prog, ["F_c"] = Commented,
    };

    static NetworkScope Scope(string? own = "VAR\n\tm : FB_Motor;\n\ty : INT;\nEND_VAR") =>
        NetworkScope.FromDeclarations(own, n => Items.TryGetValue(n, out var d) ? d : null, () => Array.Empty<string>(),
            n => Items.ContainsKey(n) ? ItemKind.Kinds.Pou : null, Scopes.RefusedPouName, Scopes.NoLibrary);

    [Theory]
    [InlineData(AwF, true)]
    [InlineData(Commented, true)]
    [InlineData(Block, false)]
    [InlineData(Prog, false)]
    [InlineData("METHOD Run : BOOL\nVAR_INPUT\n\tx : BOOL;\nEND_VAR", false)]
    [InlineData("", false)]
    public void A_declaration_is_a_functions_by_its_header(string declaration, bool function) =>
        Assert.Equal(function, StDeclaration.IsFunction(declaration));

    /// <summary>The order a positional call fills: every VAR_INPUT and VAR_IN_OUT name as declared, across blocks;
    /// outputs and locals are no inputs.</summary>
    [Fact]
    public void The_inputs_are_the_input_and_in_out_names_in_declaration_order() =>
        Assert.Equal(new[] { "source", "acc", "scale" }, StDeclaration.InputNames(Split));

    [Fact]
    public void The_outputs_are_the_output_names_in_declaration_order() =>
        Assert.Equal(new[] { "doubled" }, StDeclaration.OutputNames(Split));

    /// <summary>A FUNCTION's box as the editor draws it (corpus census, design "2R.4"): the result pin '   ' then every
    /// VAR_OUTPUT; with EN the ENO echo then the outputs. A METHOD's output list is not derived.</summary>
    [Fact]
    public void A_functions_output_list_is_its_result_pin_or_eno_then_its_outputs()
    {
        var f = Scope().Callee("F_split")!;
        var box = Call("F_split", (null, "a"));
        Assert.Equal(new[] { "   ", "doubled" }, NetworkDerivation.OutputNames(box, f, eno: false));
        Assert.Equal(new[] { "ENO", "doubled" }, NetworkDerivation.OutputNames(box, f, eno: true));
        Assert.Null(NetworkDerivation.OutputNames(box, Scope().Callee("m.Start")!, eno: false));
    }

    /// <summary>A positional output pin is placed by the text's own slot order, which no drawn function box was measured
    /// holding: no output list is derived for it.</summary>
    [Fact]
    public void A_box_with_a_positional_output_pin_derives_no_output_list()
    {
        var box = Call("F_split", (null, "a")) with { Outputs = new[] { new Output(null, new Operand("y"), Slot: 0) } };
        Assert.Null(NetworkDerivation.OutputNames(box, Scope().Callee("F_split")!, eno: false));
    }

    /// <summary>A section's qualifier opens its block with it (<c>VAR_IN_OUT CONSTANT</c>, <c>VAR_INPUT RETAIN</c>): the
    /// word is no part of the first statement. Read as one, that variable was dropped, and every later positional pin
    /// took the wrong formal name.</summary>
    [Theory]
    [InlineData("VAR_IN_OUT CONSTANT")]
    [InlineData("VAR_IN_OUT\nCONSTANT")]
    [InlineData("VAR_INPUT CONSTANT")]
    [InlineData("VAR_INPUT RETAIN")]
    [InlineData("VAR_INPUT PERSISTENT")]
    [InlineData("VAR_INPUT NON_RETAIN")]
    public void A_qualified_block_keeps_its_first_variable(string opener) =>
        Assert.Equal(new[] { "c", "i" },
            StDeclaration.InputNames($"FUNCTION F : INT\n{opener}\n\tc : INT;\nEND_VAR\nVAR_INPUT\n\ti : INT;\nEND_VAR\n"));

    [Fact]
    public void A_commented_variable_is_no_input() =>
        Assert.Equal(new[] { "a", "b" }, StDeclaration.InputNames(Commented));

    [Fact]
    public void A_project_function_is_a_callee_with_its_call_type_and_inputs()
    {
        var callee = Scope().Callee("AwF");
        Assert.NotNull(callee);
        Assert.Equal("Function", callee!.CallType);
        Assert.Equal(new[] { "i" }, callee.Inputs);
    }

    /// <summary>Only a FUNCTION: an FB, a PROGRAM (Volt's box without a CallType compiles and runs as drawn), a name the
    /// project does not hold (a library's — no declaration to read; L) and an instance answer nothing.</summary>
    [Theory]
    [InlineData("FB_Motor")]
    [InlineData("P_Main")]
    [InlineData("CONCAT")]
    [InlineData("m")]
    public void Nothing_else_is_a_derived_callee(string type) => Assert.Null(Scope().Callee(type));

    // ── ld-fbd-coverage 2R.4b: a referenced LIBRARY's function, from the IDE's library signatures ─────────────────────

    /// <summary>The signatures as the CODESYS driver reads them (<c>AllPrecompiledSignatures</c>): the result is a
    /// self-named output, the POU type the enum member's full name; `DELETE` is both Standard's function and CAA File's
    /// FB (bakon-nano holds both), `F_ambig` two libraries' functions with different pins.</summary>
    static readonly LibSignature[] Libraries =
    {
        Lib("LEN", "Function", new[] { "STR" }, new[] { "LEN" }),
        Lib("REPLACE", "Function", new[] { "STR1", "STR2", "L", "P" }, new[] { "REPLACE" }),
        Lib("DELETE", "_3S.CoDeSys.Core.Objects.POUType.Function", new[] { "STR", "LEN", "POS" }, new[] { "DELETE" }),
        Lib("DELETE", "FunctionBlock", new[] { "SFILENAME" }, new[] { "EERROR" }),
        Lib("F_out", "Function", new[] { "a" }, new[] { "F_out", "done" }),
        Lib("F_ambig", "Function", new[] { "a" }, new[] { "F_ambig" }),
        Lib("F_ambig", "Function", new[] { "b" }, new[] { "F_ambig" }),
        Lib("TON", "FunctionBlock", new[] { "IN", "PT" }, new[] { "Q", "ET" }),
        Lib("F_ref", "Function", new[] { "a" }, new[] { "F_ref" }, inOuts: new[] { "acc" }),
    };

    static LibSignature Lib(string name, string pouType, string[] inputs, string[] outputs, string[]? inOuts = null) =>
        new(name, "standard, 3.5.18.0 (system)", pouType, inputs.Select(n => new LibVar(n, "INT")).ToList(),
            outputs.Select(n => new LibVar(n, "INT")).ToList(), (inOuts ?? Array.Empty<string>()).Select(n => new LibVar(n, "INT")).ToList(),
            Array.Empty<LibVar>(), null, null);

    /// <summary>A scope whose project holds <see cref="Items"/> and whose IDE references <see cref="Libraries"/> —
    /// counting how often the libraries are asked.</summary>
    static NetworkScope WithLibraries(out Func<int> asked, string? own = "VAR\n\tm : FB_Motor;\n\ty : INT;\n\tLENGTH : INT;\nEND_VAR")
    {
        var calls = 0;
        asked = () => calls;
        return NetworkScope.FromDeclarations(own, n => Items.TryGetValue(n, out var d) ? d : null, () => Array.Empty<string>(),
            n => Items.ContainsKey(n) ? ItemKind.Kinds.Pou : null, Scopes.RefusedPouName,
            n => { calls++; return LibraryFunctions.Of(Libraries, n); });
    }

    /// <summary>A library FUNCTION's box carries <c>CallType Function</c>, its inputs as the signature lists them and its
    /// VAR_OUTPUTs without the self-named result — what the editor draws (bakon-nano's REPLACE/DELETE).</summary>
    [Theory]
    [InlineData("LEN", new[] { "STR" }, new string[0])]
    [InlineData("len", new[] { "STR" }, new string[0])]
    [InlineData("REPLACE", new[] { "STR1", "STR2", "L", "P" }, new string[0])]
    [InlineData("DELETE", new[] { "STR", "LEN", "POS" }, new string[0])]
    [InlineData("F_out", new[] { "a" }, new[] { "done" })]
    public void A_library_function_is_a_callee_from_its_signature(string type, string[] inputs, string[] outputs)
    {
        var callee = WithLibraries(out _).Callee(type);
        Assert.NotNull(callee);
        Assert.Equal("Function", callee!.CallType);
        Assert.Equal(inputs, callee.Inputs);
        Assert.Equal(outputs, callee.Outputs);
    }

    /// <summary>A library FB (no box of it without an instance is a function), two libraries' functions with different
    /// pins (which one the build picks is not Volt's to guess) and a name no library declares: nothing derived.</summary>
    [Theory]
    [InlineData("TON")]
    [InlineData("F_ambig")]
    [InlineData("F_none")]
    public void A_name_no_library_declares_one_function_of_is_no_callee(string type) =>
        Assert.Null(WithLibraries(out _).Callee(type));

    /// <summary>A library function with a VAR_IN_OUT: the signature lists inputs and in-outs apart, so the declaration
    /// order a positional call fills is not known — its CallType is derived, its input order is not.</summary>
    [Fact]
    public void A_library_function_with_an_in_out_derives_no_input_order()
    {
        var callee = WithLibraries(out _).Callee("F_ref")!;
        Assert.Equal("Function", callee.CallType);
        Assert.Empty(callee.Inputs);
    }

    /// <summary>The libraries are asked only for a head nothing else names: an operator or a conversion (a word the vendor
    /// reserves), a project POU, an instance, a variable, a method — never; a read is a build on CODESYS.</summary>
    [Theory]
    [InlineData("ADD")]
    [InlineData("MOVE")]
    [InlineData("INT_TO_REAL")]
    [InlineData("AwF")]
    [InlineData("FB_Motor")]
    [InlineData("m")]
    [InlineData("LENGTH")]
    [InlineData("m.Start")]
    [InlineData("Standard.LEN")]
    public void The_libraries_are_not_asked_for_a_head_something_else_names(string type)
    {
        var scope = WithLibraries(out var asked);
        scope.Callee(type);
        Assert.Equal(0, asked());
    }

    /// <summary>The push's gate names a positional library call's pin as the drawn box holds it: `LEN(txt)` is pushed as
    /// `LEN(STR := txt)` — the form the next pull shows.</summary>
    [Fact]
    public void The_gate_names_a_library_functions_positional_pin()
    {
        var gate = NetworkTextGate.Validate(Body("y := LEN(txt);"), WithLibraries(out _, "VAR\n\ty : INT;\n\ttxt : STRING;\nEND_VAR"));
        Assert.True(gate.Ok, string.Join("\n", gate.Diagnostics.Select(d => d.Message)));
        Assert.Contains("y := LEN(STR := txt);", gate.Canonical);
    }

    /// <summary>A METHOD call box, `inst.M(…)` with `inst` an FB instance in scope: measured live, Volt's box compiles only
    /// with <c>CallType Method</c> ("The assignment source is incorrect." without it) and then runs as the drawn one. Its
    /// inputs are the method's, which no top-level declaration holds: none derived.</summary>
    [Fact]
    public void A_method_of_an_instance_is_a_callee_with_the_method_call_type()
    {
        var callee = Scope().Callee("m.Start");
        Assert.NotNull(callee);
        Assert.Equal("Method", callee!.CallType);
        Assert.Empty(callee.Inputs);
    }

    /// <summary>A METHOD called through an INTERFACE variable (`itf.M(…)`, local or global): a method's box all the same,
    /// so it carries <c>CallType Method</c> — the interface is no block, so the instance rule alone left it without one.</summary>
    [Theory]
    [InlineData("itf.M")]
    [InlineData("gItf.M")]
    public void A_method_of_an_interface_variable_is_a_callee_with_the_method_call_type(string type)
    {
        var scope = NetworkScope.FromDeclarations("VAR\n\titf : I_X;\nEND_VAR",
            n => n.Equals("I_X", StringComparison.OrdinalIgnoreCase) ? "INTERFACE I_X" : null,
            () => new[] { "VAR_GLOBAL\n\tgItf : I_X;\nEND_VAR" },
            n => n.Equals("I_X", StringComparison.OrdinalIgnoreCase) ? ItemKind.Kinds.Interface : null, Scopes.RefusedPouName, Scopes.NoLibrary);
        Assert.Equal("Method", scope.Callee(type)?.CallType);
        Assert.Null(scope.Callee("I_X.M"));
    }

    /// <summary>A dotted name whose head is no instance — a namespace (`Standard.CONCAT`), a GVL — is no method.</summary>
    [Theory]
    [InlineData("Standard.CONCAT")]
    [InlineData("y.Start")]
    public void A_dotted_name_off_no_instance_is_no_callee(string type) => Assert.Null(Scope().Callee(type));

    [Fact]
    public void A_positional_pin_takes_the_callees_formal_in_order()
    {
        var box = Call("F_split", (null, "a"), (null, "b"));
        var derived = Derived(box);
        Assert.Equal(new[] { "source", "acc" }, derived.Inputs.Select(i => i.Formal));
    }

    /// <summary>A spelled formal stays as written; the positional pins before it take the declaration's.</summary>
    [Fact]
    public void A_named_pin_keeps_its_name()
    {
        var box = Call("F_split", (null, "a"), ("scale", "b"));
        var derived = Derived(box);
        Assert.Equal(new[] { "source", "scale" }, derived.Inputs.Select(i => i.Formal));
    }

    /// <summary>More positional values than the callee declares inputs: nothing is derived (no guess at a name the
    /// declaration lacks) — the box is written as the text says, and the build names the arity.</summary>
    [Fact]
    public void Too_many_positional_pins_derive_nothing()
    {
        var box = Call("AwF", (null, "a"), (null, "b"));
        Assert.Same(box, Derived(box));
    }

    const string Own2 = "VAR\n\tv : INT;\n\ty : INT;\nEND_VAR";
    static string Body(string statement) => $"%LANGUAGE FBD\nNETWORK\n  {statement}\nEND_NETWORK\n";

    /// <summary>The push's gate derives the names once, for either driver, and its canonical text (the next pull's)
    /// spells them: `AwF(v)` is pushed as the box `AwF(i := v)` the IDE then holds.</summary>
    [Fact]
    public void The_gate_derives_the_names_and_its_canonical_text_spells_them()
    {
        var gate = NetworkTextGate.Validate(Body("y := AwF(v);"), Scope(Own2));
        Assert.True(gate.Ok);
        Assert.Contains("y := AwF(i := v);", gate.Canonical);
        var box = (Box)((Assign)gate.Body!.Networks[0].Trees[0]).Value;
        Assert.Equal(new[] { "i" }, box.Inputs.Select(i => i.Formal));
    }

    /// <summary>A body with no callee to derive is the body read, the same object.</summary>
    [Fact]
    public void A_body_with_nothing_to_derive_is_returned_as_read()
    {
        var read = NetworkTextReader.Read(Body("y := v;"), Scope(Own2));
        Assert.Same(read.Body, NetworkDerivation.Derive(read.Body!, Scope(Own2), out var origin));
        Assert.Empty(origin);
    }

    /// <summary><paramref name="box"/> as the push's derivation leaves it, alone in a network.</summary>
    static Box Derived(Box box) =>
        (Box)NetworkDerivation.Derive(new NetworkBody(BodyLanguage.Fbd, new[] { new Network(0, null, null, null, false, new Node[] { box }) }),
            Scope(), out _).Networks[0].Trees[0];

    static Box Call(string type, params (string? Formal, string Value)[] pins) =>
        new(type, null, CallKind.Function,
            pins.Select(p => new Input(p.Formal, new Leaf(new Operand(p.Value), Flags.None), Flags.None)).ToList(),
            Array.Empty<Output>(), null, null, Flags.None);
}
