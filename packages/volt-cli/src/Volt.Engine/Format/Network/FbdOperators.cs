using System;
using System.Collections.Generic;
using System.Linq;

namespace Volt.Engine.Format.Network;

/// <summary>
/// The single canonical table of FBD/LD operator boxes and their infix ST/network text symbols, shared by the
/// network-text parser and writer (the two ends of the infix rendering) so a new operator is added in exactly
/// one place. (GraphReader/Writer carry <c>typeName</c> verbatim and never consult it.) The box
/// <see cref="TypeName"/> is the PLCopen/CODESYS operator type (OR, ADD, GT…); the
/// <see cref="Symbol"/> is how it renders infix in ST/network text (OR, +, &gt;…).
/// </summary>
internal static class FbdOperators
{
    private static readonly (string TypeName, string Symbol)[] Table =
    {
        ("OR", "OR"), ("AND", "AND"), ("XOR", "XOR"),
        ("ADD", "+"), ("SUB", "-"), ("MUL", "*"), ("DIV", "/"), ("MOD", "MOD"),
        ("GT", ">"), ("LT", "<"), ("GE", ">="), ("LE", "<="), ("EQ", "="), ("NE", "<>"),
    };

    /// <summary>Operator box type → infix symbol (e.g. <c>ADD</c> → <c>+</c>). Case-insensitive.</summary>
    public static readonly IReadOnlyDictionary<string, string> TypeToSymbol =
        Table.ToDictionary(t => t.TypeName, t => t.Symbol, StringComparer.OrdinalIgnoreCase);

    /// <summary>Infix symbol → operator box type (e.g. <c>+</c> → <c>ADD</c>). Case-insensitive.</summary>
    public static readonly IReadOnlyDictionary<string, string> SymbolToType =
        Table.ToDictionary(t => t.Symbol, t => t.TypeName, StringComparer.OrdinalIgnoreCase);
}
