using System.Collections.Generic;

namespace VoltBridge.Core.Fbd;

/// <summary>
/// Vendor-neutral model of a graphical (FBD/LD) POU body — the shared CODESYS /
/// TwinCAT "NWL" (NetWork Language) shape. Both IDEs store the IDENTICAL model
/// because TwinCAT 3 is built on the CODESYS runtime:
///   • CODESYS  — read live from the scripting object model (INWLImplementationObject).
///   • TwinCAT  — parsed from the .TcPOU <NWL><XmlArchive> serialization.
///
/// A body is a list of networks; a network is a list of top-level boxes; a box is a
/// function-block / function / operator call whose inputs are operands or NESTED boxes
/// (the box "tree"). <see cref="FbdTranspiler"/> renders this to ST. The model is pure
/// data — no pin names, no ST: naming is resolved at transpile time from each box
/// type's interface, so the model stays vendor- and language-neutral.
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
    IReadOnlyList<string> Outputs);      // pin order; "" == an unconnected output pin

/// <summary>What is wired to a box input pin: a plain operand, or a nested box.</summary>
public abstract record FbdSource;

/// <summary>A variable, literal, or expression text wired to a pin. "" = unconnected.</summary>
public sealed record FbdOperand(string Text) : FbdSource;

/// <summary>A box whose output feeds this pin — renders as a sub-expression
/// (e.g. an OR box → <c>(a OR b OR c)</c>).</summary>
public sealed record FbdNestedBox(FbdBox Box) : FbdSource;
