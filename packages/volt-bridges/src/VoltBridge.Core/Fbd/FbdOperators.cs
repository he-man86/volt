using System;
using System.Collections.Generic;
using System.Linq;

namespace VoltBridge.Core.Fbd;

/// <summary>
/// The single canonical table of FBD/LD operator boxes and their infix ST/VG symbols, shared by
/// every reader/writer/transpiler so a new operator is added in exactly one place. The box
/// <see cref="TypeName"/> is the PLCopen/CODESYS operator type (OR, ADD, GT…); the
/// <see cref="Symbol"/> is how it renders infix in ST/VG (OR, +, &gt;…).
/// </summary>
public static class FbdOperators
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
