using System;
using System.Collections.Generic;

namespace VoltBridge.Core.Fbd;

/// <summary>
/// The TwinCAT graphical (FBD/LD) body model, parsed from the <c>.TcPOU</c>
/// <c>&lt;NWL&gt;&lt;XmlArchive&gt;</c> serialization (a recursive "BoxTree"). It feeds the one-way
/// read-only <see cref="FbdTranspiler"/> (NWL → ST). (CODESYS uses a different serialization —
/// the flat PLCopenXML <c>localId</c> graph — and its own lossless <c>GraphBody</c>/VG path, so
/// this model is TwinCAT-only.)
///
/// A body is a list of networks; a network is a list of top-level boxes; a box is a
/// function-block / function / operator call whose inputs are operands or NESTED boxes
/// (the box "tree"). Pin names the IDE serialized on each box (<see cref="FbdBox.InputPins"/>/
/// <see cref="FbdBox.OutputPins"/>) are authoritative; the transpiler uses them directly.
/// </summary>
public sealed record FbdBody(string Language, IReadOnlyList<FbdNetwork> Networks);

/// <summary>One FBD/LD network. <paramref name="Boxes"/> are the top-level (sink)
/// boxes in evaluation order; each renders to one ST statement.</summary>
public sealed record FbdNetwork(
    string? Label,
    string? Comment,
    bool Disabled,
    IReadOnlyList<FbdBox> Boxes);

/// <summary>
/// A box: a function-block instance, a function, or an operator call.
///   • As a top-level network item → an ST statement (its outputs assigned).
///   • As a nested input → a value sub-expression.
/// Inputs and outputs are POSITIONAL (pin order); formal parameter names are resolved
/// at transpile time from the box type's interface. Operators (OR, ADD, …) have no
/// instance and render infix.
/// </summary>
public sealed record FbdBox(
    string Type,                         // "CM_Carrier", "OR", "ADD", "EXECUTE", …
    string? Instance,                    // FB instance variable, or null for functions/operators
    IReadOnlyList<FbdSource> Inputs,     // pin order; FbdOperand("") == an unconnected pin
    IReadOnlyList<string> Outputs)       // pin order; "" == an unconnected output pin
{
    /// <summary>Formal input pin names the IDE serialized for this box (authoritative — e.g. a
    /// library TON carries <c>IN</c>, <c>PT</c>). Empty for operators and for boxes that didn't
    /// carry names; the transpiler then renders positionally.</summary>
    public IReadOnlyList<string> InputPins { get; init; } = Array.Empty<string>();

    /// <summary>Formal output pin names the IDE serialized for this box (authoritative — e.g. TON
    /// carries <c>Q</c>, <c>ET</c>). Empty for operators / unnamed boxes.</summary>
    public IReadOnlyList<string> OutputPins { get; init; } = Array.Empty<string>();
}

/// <summary>What is wired to a box input pin: a plain operand, or a nested box.</summary>
public abstract record FbdSource;

/// <summary>A variable, literal, or expression text wired to a pin. "" = unconnected.</summary>
public sealed record FbdOperand(string Text) : FbdSource;

/// <summary>A box whose output feeds this pin — renders as a sub-expression
/// (e.g. an OR box → <c>(a OR b OR c)</c>).</summary>
public sealed record FbdNestedBox(FbdBox Box) : FbdSource;
