using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Volt.Engine.Format.Network.Next;

/// <summary>
/// The spelling rules network text v2's writer and reader must agree on, in ONE place. Each rule here is decided
/// on one side and relied on by the other: a token the writer leaves bare must lex as one token, a word the writer
/// backticks must be refused bare, and a box the writer writes infix must be the box the reader builds from a
/// group. Two private copies would drift the first time one side learns a new literal form — and the drift would
/// show up only as a body the gate refuses as not canonical, far from the rule that moved.
/// </summary>
internal static class NextSpelling
{
    public static readonly Regex Identifier = new(@"^[A-Za-z_][A-Za-z0-9_]*$", RegexOptions.Compiled);
    public static readonly Regex Path = new(@"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$", RegexOptions.Compiled);
    public static readonly Regex Number = new(@"^[0-9][0-9_]*(\.[0-9][0-9_]*)?([eE][+-]?[0-9]+)?$", RegexOptions.Compiled);
    // T#1S, TIME#1h2m, 16#FF, INT#5, DT#2020-01-01-12:00:00 — one ST literal token, no whitespace.
    public static readonly Regex Typed = new(@"^[A-Za-z0-9_]+#[A-Za-z0-9_.:+\-]+$", RegexOptions.Compiled);
    public static readonly Regex Address = new(@"^%[IQM][XBWDL]?[0-9]+(\.[0-9]+)*$", RegexOptions.Compiled);

    /// <summary>A wire's name: <c>g</c> plus the vendor VarId. Matched case-insensitively, as IEC names are.</summary>
    public static readonly Regex WireName = new(@"^[gG][0-9]+$", RegexOptions.Compiled);

    /// <summary>Words the text's own grammar gives a meaning at operand position; an operand spelled like one is
    /// backticked so it cannot be read as the construct.</summary>
    public static readonly HashSet<string> TextWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "NOT", "AND", "OR", "XOR", "MOD", "R_EDGE", "F_EDGE", "PARALLEL", "EXECUTE", "END_EXECUTE",
        "IF", "THEN", "END_IF", "JMP", "RETURN", "NETWORK", "END_NETWORK", "VAR_TEMP", "END_VAR",
    };

    /// <summary>The names a POU or FB instance may not carry, because the text spells a construct with them.</summary>
    public static readonly HashSet<string> ConstructWords = new(StringComparer.OrdinalIgnoreCase)
        { "R_EDGE", "F_EDGE", "PARALLEL" };

    /// <summary>Whether <paramref name="t"/> is exactly one token of the text, so it may stand bare.</summary>
    public static bool IsToken(string t) =>
        t == Box.UnnamedInstance ||
        (!TextWords.Contains(t) &&
         (Identifier.IsMatch(t) || Path.IsMatch(t) || Number.IsMatch(t) || Typed.IsMatch(t) || Address.IsMatch(t)));

    /// <summary>Operator boxes whose output is BOOL by themselves — the one fact a wire's type may be read off
    /// without a declaration (spec: "a wire's type is read off its producer").</summary>
    public static readonly HashSet<string> BooleanBoxes = new(StringComparer.OrdinalIgnoreCase)
        { "AND", "OR", "XOR", "NOT", "GT", "GE", "LT", "LE", "EQ", "NE" };

    public const string Bool = "BOOL";

    /// <summary>Infix is decided by the box's own fields alone: an operator in the table, no EN, no instance,
    /// no output pin, formals absent or the operator's defaults, and at least two inputs — with fewer, the
    /// group's parentheses would be a pair that is no box.</summary>
    public static bool IsInfix(Box b) =>
        b.Enable is null && b.Instance is null && b.Outputs.Count == 0 && b.StCode is null &&
        FbdOperators.TypeToSymbol.ContainsKey(b.Type) && b.Inputs.Count >= 2 &&
        b.Inputs.Select((p, i) => p.Formal is null ||
                                  string.Equals(p.Formal, "IN" + (i + 1), StringComparison.OrdinalIgnoreCase)).All(x => x);

    /// <summary>The box's <see cref="CallKind"/> as the TEXT determines it. The text does not carry the vendor's
    /// <c>CallType</c> (a MOVE the IDE resolved reads <c>Operator</c>, the same box freshly built reads
    /// <c>None</c> — <see cref="CallKinds"/>), so this is the reader's reading and the oracle's normalisation, one
    /// rule for both; the push takes the IDE's own value.</summary>
    public static CallKind KindOf(string type, bool hasInstance) =>
        hasInstance ? CallKind.FunctionBlock
        : FbdOperators.TypeToSymbol.ContainsKey(type) || string.Equals(type, "NOT", StringComparison.OrdinalIgnoreCase)
            ? CallKind.Operator
            : CallKind.Function;

    /// <summary>The type the Execute box's model carries; the ST is what distinguishes it.</summary>
    public const string ExecuteType = "EXECUTE";
}
